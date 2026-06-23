import { describe, expect, it } from 'vitest';

import { formatResult } from '../src/format-result';
import type { ReadPdfRequest, SidecarResult } from '../src/types';

import textLayer from './fixtures/text-layer.json';
import needsOcr from './fixtures/needs-ocr.json';
import mineru from './fixtures/mineru.json';

const request: ReadPdfRequest = { path: 'C:/docs/sample.pdf' };

describe('formatResult', () => {
  it('formats a text-layer result into page-marked markdown', () => {
    const md = formatResult(textLayer as SidecarResult, request);
    expect(md).toContain('[PDF] sample.pdf');
    expect(md).toContain('engine: read_pdf/pymupdf');
    expect(md).toContain('backend: text-layer');
    expect(md).toContain('pages: 1-2 of 8');
    expect(md).toContain('--- page 1 | text-layer ---');
    expect(md).toContain('Hello from page one.');
    expect(md).toContain('--- page 2 | text-layer ---');
    expect(md).toContain('Second page content.');
  });

  it('surfaces needs_ocr guidance and per-page warnings', () => {
    const md = formatResult(needsOcr as SidecarResult, { path: 'C:/docs/scanned.pdf' });
    expect(md).toContain('needs_ocr: pages 1, 2');
    expect(md).toContain('no OCR backend');
    expect(md).toContain('[page 1 warning] OCR requested but no OCR backend is available.');
    // Empty page text is shown explicitly, not dropped.
    expect(md).toContain('(no text extracted)');
  });

  it('formats a MinerU-shaped result, passing through source labels and warnings', () => {
    const md = formatResult(mineru as SidecarResult, { path: 'C:/docs/complex.pdf' });
    expect(md).toContain('engine: read_pdf/mineru');
    expect(md).toContain('backend: mineru');
    expect(md).toContain('--- page 1 | mineru ---');
    expect(md).toContain('$E=mc^2$');
    expect(md).toContain('Warnings:');
    expect(md).toContain('- mineru backend is experimental');
  });
});
