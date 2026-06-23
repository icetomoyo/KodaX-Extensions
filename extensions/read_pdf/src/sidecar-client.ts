import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExecOptions, ExecResult, KodaXExtensionAPI, WebhookOptions, WebhookResult } from './kodax';
import type { ReadPdfRequest, SidecarResult } from './types';

/** Generous cap: whole-page OCR on large PDFs can be slow. */
const SIDECAR_TIMEOUT_MS = 300_000;

export type SidecarOutcome =
  | { readonly kind: 'ok'; readonly result: SidecarResult }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string };

/** Injectable dependencies so the resolution ladder is fully testable. */
export interface SidecarDeps {
  readonly exec: (command: string, options?: ExecOptions) => Promise<ExecResult>;
  readonly webhook: (url: string, payload: unknown, options?: WebhookOptions) => Promise<WebhookResult>;
  readonly exists: (path: string) => boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Extension root directory (where `sidecar/` lives). */
  readonly extDir: string;
  /** Optional endpoint from extension config (overrides env if set). */
  readonly endpoint?: string;
  /** Host platform; controls shell-specific command construction. */
  readonly platform: NodeJS.Platform;
}

/** Build production deps from the KodaX api and the resolved extension directory. */
export function createSidecarDeps(api: KodaXExtensionAPI, extDir: string): SidecarDeps {
  const configuredEndpoint = api.config?.['endpoint'];
  return {
    exec: api.exec,
    webhook: api.webhook,
    exists: existsSync,
    env: process.env,
    extDir,
    platform: process.platform,
    ...(typeof configuredEndpoint === 'string' ? { endpoint: configuredEndpoint } : {}),
  };
}

/**
 * Invoke a local executable through whatever shell api.exec uses. On Windows the
 * shell is PowerShell, where a command starting with a quoted path is a string
 * literal — the `&` call operator is required to execute it. POSIX shells run it directly.
 */
function executableInvocation(executablePath: string, args: string, platform: NodeJS.Platform): string {
  const quoted = quoteArg(executablePath, platform);
  return platform === 'win32' ? `& ${quoted} ${args}` : `${quoted} ${args}`;
}

export function defaultBinPath(extDir: string, platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'read_pdf.exe' : 'read_pdf';
  return join(extDir, 'sidecar', 'bin', 'read_pdf', name);
}

export function defaultSidecarDir(extDir: string): string {
  return join(extDir, 'sidecar');
}

/**
 * Quote a single argument as a literal string for the shell api.exec uses.
 * Single quotes prevent ALL substitution ($(), backticks, $VAR), which matters
 * because `path` is an arbitrary LLM/user string. POSIX and PowerShell both treat
 * single-quoted strings as literal; only the escape for an embedded quote differs.
 */
export function quoteArg(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    // PowerShell single-quoted string: literal; escape ' by doubling it.
    return `'${value.replace(/'/g, "''")}'`;
  }
  // POSIX single-quoted string: literal; close-escape-reopen for an embedded '.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Build the argument string shared by every CLI transport (after the `read` subcommand). */
export function buildReadArgs(request: ReadPdfRequest, platform: NodeJS.Platform): string {
  const parts: string[] = ['read', quoteArg(request.path, platform), '--format', 'agent-json'];
  if (request.pages !== undefined) {
    parts.push('--pages', quoteArg(request.pages, platform));
  }
  if (request.engine !== undefined) {
    // engine is enum-validated upstream, so it needs no quoting.
    parts.push('--engine', request.engine);
  }
  if (request.max_pages !== undefined) {
    parts.push('--max-pages', String(request.max_pages));
  }
  if (request.force_ocr === true) {
    parts.push('--force-ocr');
  }
  return parts.join(' ');
}

/** Parse sidecar stdout (a single JSON object) into an outcome. */
export function parseSidecarStdout(stdout: string): SidecarOutcome {
  const trimmed = stdout.trim();
  if (trimmed === '') {
    return { kind: 'error', message: 'sidecar returned empty output.' };
  }
  let parsed: SidecarResult;
  try {
    parsed = JSON.parse(trimmed) as SidecarResult;
  } catch {
    const preview = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
    return { kind: 'error', message: `could not parse sidecar JSON output: ${preview}` };
  }
  if (parsed.ok === false) {
    return { kind: 'error', message: parsed.error ?? 'sidecar reported an unspecified failure.' };
  }
  return { kind: 'ok', result: parsed };
}

async function runCliCommand(deps: SidecarDeps, command: string): Promise<SidecarOutcome> {
  let result: ExecResult;
  try {
    result = await deps.exec(command, { timeout: SIDECAR_TIMEOUT_MS, cwd: deps.extDir });
  } catch (err) {
    return { kind: 'error', message: `sidecar process failed to start: ${errorMessage(err)}` };
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      kind: 'error',
      message: `sidecar exited with code ${result.exitCode}${detail ? `: ${detail}` : ''}.`,
    };
  }
  return parseSidecarStdout(result.stdout);
}

async function runViaHttp(deps: SidecarDeps, endpoint: string, request: ReadPdfRequest): Promise<SidecarOutcome> {
  const url = `${endpoint.replace(/\/+$/, '')}/v1/read_pdf`;
  let response: WebhookResult;
  try {
    response = await deps.webhook(url, request, { method: 'POST', timeout: SIDECAR_TIMEOUT_MS });
  } catch (err) {
    return { kind: 'error', message: `sidecar HTTP request failed: ${errorMessage(err)}` };
  }
  if (!response.ok) {
    return { kind: 'error', message: `sidecar HTTP endpoint returned status ${response.status}.` };
  }
  return parseSidecarStdout(response.body ?? '');
}

async function uvAvailable(deps: SidecarDeps): Promise<boolean> {
  try {
    const result = await deps.exec('uv --version', { timeout: 15_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function setupGuidance(deps: SidecarDeps): string {
  const binPath = defaultBinPath(deps.extDir);
  const sidecarDir = defaultSidecarDir(deps.extDir);
  return [
    'read_pdf sidecar is not available. Set up one of the following, then retry:',
    `  1. Air-gapped / zero-dependency: place the prebuilt bundle at ${binPath} `,
    '     (build it on a connected machine — see sidecar/BUILD_OFFLINE.md).',
    `  2. Connected machine: install uv (e.g. "winget install astral-sh.uv"), then read_pdf will `,
    `     auto-provision from ${join(sidecarDir, 'pyproject.toml')} on first use.`,
    '  3. Daemon: start the sidecar HTTP server and set READ_PDF_ENDPOINT (e.g. http://127.0.0.1:8765).',
  ].join('\n');
}

/**
 * Resolve and run the sidecar, offline-first:
 *   endpoint -> bundled binary -> uv -> actionable setup guidance.
 */
export async function runSidecar(deps: SidecarDeps, request: ReadPdfRequest): Promise<SidecarOutcome> {
  const endpoint = deps.endpoint ?? deps.env['READ_PDF_ENDPOINT'];
  if (endpoint) {
    return runViaHttp(deps, endpoint, request);
  }

  const args = buildReadArgs(request, deps.platform);

  const binPath = deps.env['READ_PDF_BIN'] ?? defaultBinPath(deps.extDir, deps.platform);
  if (deps.exists(binPath)) {
    return runCliCommand(deps, executableInvocation(binPath, args, deps.platform));
  }

  const sidecarDir = defaultSidecarDir(deps.extDir);
  const hasProject = deps.exists(join(sidecarDir, 'pyproject.toml'));
  if (hasProject && (await uvAvailable(deps))) {
    return runCliCommand(deps, `uv run --project ${quoteArg(sidecarDir, deps.platform)} read_pdf ${args}`);
  }

  return { kind: 'unavailable', message: setupGuidance(deps) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
