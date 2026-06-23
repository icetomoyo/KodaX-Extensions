import type { ReadPdfRequest, SidecarResult } from './types';

/** Base name of a file path, handling both `/` and `\` separators. */
function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** Compact "min-max" label for the returned page numbers, or "none". */
function pageRangeLabel(result: SidecarResult): string {
  if (result.pages.length === 0) {
    return 'none';
  }
  const numbers = result.pages.map((p) => p.page);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return min === max ? `${min}` : `${min}-${max}`;
}

/**
 * Render a sidecar JSON result into compact, page-marked markdown for the model.
 * Keeps the output text-first and includes engine/backend/warning metadata.
 */
export function formatResult(result: SidecarResult, request: ReadPdfRequest): string {
  const lines: string[] = [];
  lines.push(`[PDF] ${baseName(result.file || request.path)}`);
  lines.push(`engine: ${result.engine}`);
  lines.push(`backend: ${result.selected_backend}`);
  lines.push(`pages: ${pageRangeLabel(result)} of ${result.page_count}`);

  for (const page of result.pages) {
    lines.push('');
    lines.push(`--- page ${page.page} | ${page.source} ---`);
    const text = (page.text ?? '').trim();
    lines.push(text.length > 0 ? text : '(no text extracted)');
    for (const warning of page.warnings ?? []) {
      lines.push(`[page ${page.page} warning] ${warning}`);
    }
  }

  const needsOcr = result.needs_ocr ?? [];
  if (needsOcr.length > 0) {
    // Summarize long lists so a heavily-scanned PDF doesn't flood the model context.
    const label =
      needsOcr.length > 10
        ? `${needsOcr.slice(0, 5).join(', ')} … (${needsOcr.length} pages total)`
        : needsOcr.join(', ');
    lines.push('');
    lines.push(
      `needs_ocr: pages ${label} have little or no text layer and no OCR backend ` +
        `was available. Configure the read_pdf sidecar OCR engine (RapidOCR) or pass engine="ocr".`,
    );
  }

  const warnings = result.warnings ?? [];
  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}
