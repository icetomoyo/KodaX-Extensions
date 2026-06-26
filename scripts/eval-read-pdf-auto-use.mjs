import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kodaxRepo = path.resolve(process.env.KODAX_REPO ?? path.join(repoRoot, '..', 'KodaX'));
const extensionDir = path.join(repoRoot, 'extensions', 'read_pdf');
const dumpRoot = path.join(
  process.env.KODAX_EVAL_DUMP_DIR ? path.resolve(process.env.KODAX_EVAL_DUMP_DIR) : os.tmpdir(),
  'kodax-eval-dumps',
  'read-pdf-auto-use',
);
const timeoutMs = Number.parseInt(process.env.KODAX_EVAL_TIMEOUT_MS ?? '180000', 10);
const sentinel = 'AUTO USE PDF SENTINEL 78291';

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function pdfEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function buildTinyPdf(text) {
  const stream = `BT /F1 22 Tf 72 720 Td (${pdfEscape(text)}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return body;
}

async function run(command, args, options = {}) {
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...options.env,
      },
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function main() {
  await mkdir(dumpRoot, { recursive: true });

  const caseDir = process.platform === 'win32'
    ? path.join('C:\\tmp', 'kodax-read-pdf-auto-use')
    : path.join(os.tmpdir(), 'kodax-read-pdf-auto-use');
  await mkdir(caseDir, { recursive: true });
  const pdfPath = path.join(caseDir, 'auto-use-sentinel.pdf');
  const promptPdfPath = pdfPath.split(path.sep).join('/');
  await writeFile(pdfPath, buildTinyPdf(sentinel), 'utf8');

  const npmCli = process.env.npm_execpath;
  const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmPrefixArgs = npmCli ? [npmCli] : [];

  const build = await run(npmCommand, [
    ...npmPrefixArgs,
    'run',
    'build',
    '-w',
    '@kodax-extensions/read_pdf',
  ], {
    cwd: repoRoot,
  });
  if (build.code !== 0) {
    throw new Error(`Failed to build read_pdf extension:\n${build.stdout}\n${build.stderr}`);
  }

  const prompt = [
    'Read this PDF file and answer with the unique sentinel phrase written inside it.',
    'Output only the phrase itself, with no explanation.',
    `PDF path: ${promptPdfPath}`,
  ].join(' ');

  const args = [
    ...npmPrefixArgs,
    'run',
    'dev',
    '--',
    '--extension',
    extensionDir,
    '--repo-intelligence',
    'off',
    '--reasoning',
    'off',
    '--no-session',
    '--max-iter',
    process.env.KODAX_EVAL_MAX_ITER ?? '8',
  ];
  if (process.env.KODAX_EVAL_PROVIDER?.trim()) {
    args.push('--provider', process.env.KODAX_EVAL_PROVIDER.trim());
  }
  args.push('-p', prompt);

  const result = await run(npmCommand, args, { cwd: kodaxRepo });
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  const gotSentinel = output.includes(sentinel);
  const usedReadFallback = output.includes('PDF files are not parsed by the built-in read tool');
  const hasPdfToolResult = output.includes('[PDF]') || output.includes('--- page 1 |');
  const passed = result.code === 0 && gotSentinel && hasPdfToolResult && !usedReadFallback;

  const dump = {
    case: 'read_pdf_auto_use_text_layer_pdf',
    stage: 'manual-real-llm-smoke',
    prompt,
    pdfPath,
    promptPdfPath,
    extensionDir,
    kodaxRepo,
    command: [npmCommand, ...args],
    result: {
      exitCode: result.code,
      signal: result.signal,
      durationMs: result.durationMs,
      passed,
      gotSentinel,
      hasPdfToolResult,
      usedReadFallback,
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
  const dumpPath = path.join(dumpRoot, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(dumpPath, JSON.stringify(dump, null, 2), 'utf8');

  console.log(`[read_pdf auto-use eval] dump: ${dumpPath}`);
  console.log(`[read_pdf auto-use eval] exit=${result.code} durationMs=${result.durationMs}`);
  console.log(`[read_pdf auto-use eval] gotSentinel=${gotSentinel} hasPdfToolResult=${hasPdfToolResult} usedReadFallback=${usedReadFallback}`);
  if (!passed) {
    console.error('[read_pdf auto-use eval] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[read_pdf auto-use eval] PASS');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
