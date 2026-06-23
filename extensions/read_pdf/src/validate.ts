import type { ReadPdfRequest } from './types';

/** Engines the public tool schema accepts. Routing/availability is decided by the sidecar. */
export const KNOWN_ENGINES = ['auto', 'text', 'ocr', 'mineru', 'noteeditor-lite'] as const;

/** Matches "1", "1-3", "1-3,7", with optional surrounding whitespace. */
const PAGES_PATTERN = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

export type ValidationResult =
  | { readonly ok: true; readonly value: ReadPdfRequest }
  | { readonly ok: false; readonly error: string };

/**
 * Validate raw tool input at the boundary. Returns a normalized request or a
 * human-friendly error message (without the `[Tool Error]` prefix).
 */
export function validateInput(input: Record<string, unknown>): ValidationResult {
  const { path, pages, force_ocr, max_pages, engine } = input;

  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, error: 'missing required "path" (a PDF file path).' };
  }

  if (pages !== undefined) {
    if (typeof pages !== 'string' || !PAGES_PATTERN.test(pages)) {
      return {
        ok: false,
        error: `invalid "pages": ${JSON.stringify(pages)}. Use a 1-based range like "1-3,7".`,
      };
    }
    const rangeError = validateRanges(pages);
    if (rangeError) {
      return { ok: false, error: rangeError };
    }
  }

  if (force_ocr !== undefined && typeof force_ocr !== 'boolean') {
    return { ok: false, error: '"force_ocr" must be a boolean.' };
  }

  if (max_pages !== undefined) {
    if (typeof max_pages !== 'number' || !Number.isInteger(max_pages) || max_pages <= 0) {
      return { ok: false, error: '"max_pages" must be a positive integer.' };
    }
  }

  if (engine !== undefined) {
    if (typeof engine !== 'string' || !(KNOWN_ENGINES as readonly string[]).includes(engine)) {
      return {
        ok: false,
        error: `invalid "engine": ${JSON.stringify(engine)}. Expected one of ${KNOWN_ENGINES.join(', ')}.`,
      };
    }
  }

  const value: ReadPdfRequest = {
    path: path.trim(),
    ...(pages !== undefined ? { pages: pages.trim() } : {}),
    ...(force_ocr !== undefined ? { force_ocr } : {}),
    ...(max_pages !== undefined ? { max_pages } : {}),
    ...(engine !== undefined ? { engine } : {}),
  };
  return { ok: true, value };
}

/** Ensure every range has start <= end. Assumes `pages` already matched PAGES_PATTERN. */
function validateRanges(pages: string): string | null {
  for (const part of pages.split(',')) {
    const bounds = part.split('-').map((n) => Number.parseInt(n.trim(), 10));
    if (bounds.length === 2) {
      const [start, end] = bounds as [number, number];
      if (start > end) {
        return `invalid "pages": range "${part.trim()}" has start greater than end.`;
      }
      if (start < 1) {
        return `invalid "pages": page numbers are 1-based and must be >= 1.`;
      }
    } else {
      const [single] = bounds as [number];
      if (single < 1) {
        return `invalid "pages": page numbers are 1-based and must be >= 1.`;
      }
    }
  }
  return null;
}
