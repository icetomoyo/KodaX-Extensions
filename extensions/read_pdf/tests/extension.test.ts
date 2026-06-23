import { describe, expect, it, vi } from 'vitest';

import activate from '../extension';
import type { KodaXExtensionAPI, LocalToolDefinition } from '../src/kodax';
import { createReadPdfTool } from '../src/tool';
import type { SidecarDeps } from '../src/sidecar-client';

import textLayer from './fixtures/text-layer.json';

const OK_STDOUT = JSON.stringify(textLayer);

function makeApi(): { api: KodaXExtensionAPI; registered: LocalToolDefinition[] } {
  const registered: LocalToolDefinition[] = [];
  const api: KodaXExtensionAPI = {
    registerTool: (def) => {
      registered.push(def);
      return () => {};
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {},
    exec: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' })),
    webhook: vi.fn(async () => ({ ok: false, status: 500 })),
  };
  return { api, registered };
}

function depsWith(overrides: Partial<SidecarDeps>): SidecarDeps {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' })),
    webhook: vi.fn(async () => ({ ok: true, status: 200, body: OK_STDOUT })),
    exists: () => false,
    env: {},
    extDir: '/ext/read_pdf',
    platform: 'linux',
    ...overrides,
  };
}

describe('activate', () => {
  it('registers a read_pdf tool with the expected metadata', () => {
    const { api, registered } = makeApi();
    activate(api);
    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('read_pdf');
    expect(tool.sideEffect).toBe('readonly');
    expect(tool.planModeAllowed).toBe(true);
    expect(tool.input_schema.required).toContain('path');
    // read-only tool skips the classifier
    expect(tool.toClassifierInput({})).toBe('');
  });
});

describe('read_pdf handler', () => {
  it('formats a text-layer sidecar result into page-marked markdown', async () => {
    const tool = createReadPdfTool(depsWith({ exists: (p) => p.includes('bin') }));
    const out = await tool.handler({ path: 'C:/docs/sample.pdf' });
    expect(out).toContain('[PDF] sample.pdf');
    expect(out).toContain('--- page 1 | text-layer ---');
    expect(out).not.toMatch(/^\[Tool Error\]/);
  });

  it('returns actionable setup guidance (not a generic failure) when the sidecar is missing', async () => {
    const tool = createReadPdfTool(
      depsWith({ exec: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' })) }),
    );
    const out = await tool.handler({ path: 'C:/docs/sample.pdf' });
    expect(out).toMatch(/^\[Tool Error\] read_pdf:/);
    expect(out).toMatch(/sidecar is not available/);
    expect(out).toMatch(/uv/);
  });

  it('rejects missing path before touching the sidecar', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    const tool = createReadPdfTool(depsWith({ exec }));
    const out = await tool.handler({});
    expect(out).toMatch(/missing required "path"/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects a bad pages spec before touching the sidecar', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    const tool = createReadPdfTool(depsWith({ exec }));
    const out = await tool.handler({ path: 'a.pdf', pages: 'not-a-range' });
    expect(out).toMatch(/invalid "pages"/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes the engine hint through to the sidecar command', async () => {
    const exec = vi.fn(async (_cmd: string) => ({ exitCode: 0, stdout: OK_STDOUT, stderr: '' }));
    const tool = createReadPdfTool(depsWith({ exec, exists: (p) => p.includes('bin') }));
    await tool.handler({ path: 'a.pdf', engine: 'mineru' });
    const command = exec.mock.calls[0]?.[0] as string;
    expect(command).toContain('--engine mineru');
  });
});
