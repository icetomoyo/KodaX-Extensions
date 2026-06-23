/** Types describing the JSON contract returned by the read_pdf sidecar. */

export interface SidecarPage {
  /** 1-based page number. */
  readonly page: number;
  /** Where the text came from, e.g. "text-layer" or "ocr". */
  readonly source: string;
  /** Extracted text for the page. */
  readonly text: string;
  /** Per-page warnings (e.g. OCR confidence unavailable). */
  readonly warnings?: readonly string[];
}

export interface SidecarResult {
  readonly ok: boolean;
  readonly file: string;
  readonly page_count: number;
  /** Engine label, e.g. "read_pdf/pymupdf". */
  readonly engine: string;
  /** Selected backend, e.g. "text-layer", "ocr", "mineru". */
  readonly selected_backend: string;
  /** Overall mode, e.g. "text", "ocr", "mixed". */
  readonly mode: string;
  readonly pages: readonly SidecarPage[];
  /** Pages that need OCR but had no backend available. */
  readonly needs_ocr?: readonly number[];
  /** Document-level warnings. */
  readonly warnings?: readonly string[];
  /** Present when ok is false. */
  readonly error?: string | null;
}

/** Validated, normalized tool input passed to the sidecar. */
export interface ReadPdfRequest {
  readonly path: string;
  readonly pages?: string;
  readonly force_ocr?: boolean;
  readonly max_pages?: number;
  readonly engine?: string;
}
