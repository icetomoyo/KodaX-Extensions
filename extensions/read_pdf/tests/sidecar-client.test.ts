import { describe, expect, it, vi } from 'vitest';

import {
  buildReadArgs,
  parseSidecarStdout,
  runSidecar,
  type SidecarDeps,
} from '../src/sidecar-client';
import type { ReadPdfRequest } from '../src/types';

import textLayer from './fixtures/text-layer.json';

const EXT_DIR = '/ext/read_pdf';
const OK_STDOUT = JSON.stringify(textLayer);

function makeDeps(overrides: Partial<SidecarDeps> = {}): SidecarDeps {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' })),
    webhook: vi.fn(async () => ({ ok: true, status: 200, body: OK_STDOUT })),
    exists: () => false,
    env: {},
    extDir: EXT_DIR,
    platform: 'linux',
    ...overrides,
  };
}

describe('buildReadArgs', () => {
  it('always includes read, the quoted path, and agent-json format', () => {
    const args = buildReadArgs({ path: 'C:/d/a.pdf' }, 'linux');
    expect(args).toBe("read 'C:/d/a.pdf' --format agent-json");
  });

  it('passes the engine hint through unchanged (unquoted, enum-validated)', () => {
    const args = buildReadArgs({ path: 'a.pdf', engine: 'mineru' }, 'linux');
    expect(args).toContain('--engine mineru');
  });

  it('includes pages, max_pages and force_ocr when present', () => {
    const req: ReadPdfRequest = { path: 'a.pdf', pages: '1-3,7', max_pages: 5, force_ocr: true };
    const args = buildReadArgs(req, 'linux');
    expect(args).toContain("--pages '1-3,7'");
    expect(args).toContain('--max-pages 5');
    expect(args).toContain('--force-ocr');
  });

  it('neutralizes shell metacharacters in the path via single-quoting (POSIX)', () => {
    const args = buildReadArgs({ path: '/tmp/$(id).pdf' }, 'linux');
    expect(args).toContain("read '/tmp/$(id).pdf'");
    // a literal single quote in the path is escaped, not left to break out
    const tricky = buildReadArgs({ path: "/tmp/a'b.pdf" }, 'linux');
    expect(tricky).toContain("'/tmp/a'\\''b.pdf'");
  });
});

describe('parseSidecarStdout', () => {
  it('parses a valid ok result', () => {
    const outcome = parseSidecarStdout(OK_STDOUT);
    expect(outcome.kind).toBe('ok');
  });

  it('maps ok:false to an error outcome with the sidecar message', () => {
    const outcome = parseSidecarStdout(JSON.stringify({ ok: false, error: 'file not found: x' }));
    expect(outcome).toEqual({ kind: 'error', message: 'file not found: x' });
  });

  it('reports invalid JSON as an error', () => {
    expect(parseSidecarStdout('not json').kind).toBe('error');
  });

  it('reports empty output as an error', () => {
    expect(parseSidecarStdout('   ').kind).toBe('error');
  });
});

describe('runSidecar resolution ladder', () => {
  it('uses the HTTP endpoint when one is configured', async () => {
    const webhook = vi.fn(async (_url: string) => ({ ok: true, status: 200, body: OK_STDOUT }));
    const deps = makeDeps({ endpoint: 'http://127.0.0.1:8765', webhook });
    const outcome = await runSidecar(deps, { path: 'a.pdf' });
    expect(outcome.kind).toBe('ok');
    expect(webhook).toHaveBeenCalledOnce();
    expect(webhook.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8765/v1/read_pdf');
  });

  it('uses the bundled binary when it exists, passing engine through', async () => {
    const exec = vi.fn(async (_cmd: string) => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    const deps = makeDeps({ exec, exists: (p) => p.includes('bin') });
    const outcome = await runSidecar(deps, { path: 'a.pdf', engine: 'mineru' });
    expect(outcome.kind).toBe('ok');
    const command = exec.mock.calls[0]?.[0] as string;
    expect(command).toContain("read 'a.pdf'");
    expect(command).toContain('--engine mineru');
    expect(command).not.toContain('uv run');
  });

  it('prefixes the PowerShell call operator when running the binary on Windows', async () => {
    const exec = vi.fn(async (_cmd: string) => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    const deps = makeDeps({ exec, exists: (p) => p.includes('bin'), platform: 'win32' });
    await runSidecar(deps, { path: 'a.pdf' });
    const command = exec.mock.calls[0]?.[0] as string;
    expect(command.startsWith("& '")).toBe(true);
  });

  it('resolves the sidecar from the parent dir when loaded from dist/ (extDir=.../dist)', async () => {
    const exec = vi.fn(async (_cmd: string) => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    // sidecar lives at /ext/read_pdf/sidecar, but extension.mjs was loaded from /ext/read_pdf/dist
    const deps = makeDeps({
      exec,
      extDir: '/ext/read_pdf/dist',
      // binary exists only under the parent's sidecar dir, not under dist/sidecar
      exists: (p) => p.includes('sidecar') && p.includes('bin') && !p.includes('dist'),
    });
    const outcome = await runSidecar(deps, { path: 'a.pdf' });
    expect(outcome.kind).toBe('ok');
    const command = exec.mock.calls[0]?.[0] as string;
    expect(command).not.toContain('dist');
    expect(command).toContain('sidecar');
  });

  it('falls back to uv when no binary but uv and the project are present', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd.startsWith('uv --version')) return { exitCode: 0, stdout: 'uv 0.5.0', stderr: '' };
      return { exitCode: 0, stdout: OK_STDOUT, stderr: '' };
    });
    const deps = makeDeps({ exec, exists: (p) => p.includes('pyproject.toml') });
    const outcome = await runSidecar(deps, { path: 'a.pdf' });
    expect(outcome.kind).toBe('ok');
    const lastCmd = exec.mock.calls.at(-1)?.[0] as string;
    expect(lastCmd).toContain('uv run --project');
    expect(lastCmd).toContain("read_pdf read 'a.pdf'");
  });

  it('returns actionable setup guidance when nothing is available', async () => {
    const exec = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }));
    const deps = makeDeps({ exec, exists: () => false });
    const outcome = await runSidecar(deps, { path: 'a.pdf' });
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') {
      expect(outcome.message).toMatch(/sidecar is not available/);
      expect(outcome.message).toMatch(/uv/);
      expect(outcome.message).toMatch(/READ_PDF_ENDPOINT/);
    }
  });

  it('surfaces a non-zero exit code as an error', async () => {
    const exec = vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: 'boom' }));
    const deps = makeDeps({ exec, exists: (p) => p.includes('bin') });
    const outcome = await runSidecar(deps, { path: 'a.pdf' });
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain('boom');
    }
  });
});
