import type { KodaXExtensionAPI, LocalToolDefinition } from './kodax';
import { formatResult } from './format-result';
import { createSidecarDeps, runSidecar, type SidecarDeps } from './sidecar-client';
import { KNOWN_ENGINES, validateInput } from './validate';

const DESCRIPTION =
  'Use this tool for PDF files (.pdf): read, summarize, extract, translate, search, ' +
  'or answer questions about PDF content. Prefer read_pdf over the built-in read tool ' +
  'for PDF paths; read handles text/image files, while read_pdf extracts PDF text and ' +
  'can OCR scanned/image-only pages when the sidecar has OCR available. It extracts the ' +
  'embedded text layer first, then uses OCR/heavy parsing only when needed or requested. ' +
  'Returns compact page-marked text plus engine, backend, and warning metadata.';

const INPUT_SCHEMA: LocalToolDefinition['input_schema'] = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute or working-directory-relative PDF file path.' },
    pages: {
      type: 'string',
      description: 'Optional 1-based page range, e.g. "1-3,7". Omit for the whole PDF.',
    },
    force_ocr: {
      type: 'boolean',
      description: 'Set true only when the user asks for OCR or the text layer is insufficient.',
    },
    max_pages: {
      type: 'number',
      description: 'Optional safety cap for large PDFs; use a page range when the user asks for specific pages.',
    },
    engine: {
      type: 'string',
      description:
        `Optional sidecar engine hint: ${KNOWN_ENGINES.join(', ')}, ` +
        `or any OCR backend registered in the sidecar.`,
    },
  },
  required: ['path'],
};

/**
 * Build the read_pdf tool definition. `deps` is injectable for testing; in
 * production it is derived from the KodaX api and extension directory.
 */
export function createReadPdfTool(deps: SidecarDeps): LocalToolDefinition {
  return {
    name: 'read_pdf',
    description: DESCRIPTION,
    sideEffect: 'readonly',
    planModeAllowed: true,
    interruptBehavior: 'cancel',
    input_schema: INPUT_SCHEMA,
    toClassifierInput: () => '',
    handler: async (input) => {
      const validation = validateInput(input);
      if (!validation.ok) {
        return `[Tool Error] read_pdf: ${validation.error}`;
      }

      const outcome = await runSidecar(deps, validation.value);
      switch (outcome.kind) {
        case 'ok':
          return formatResult(outcome.result, validation.value);
        case 'unavailable':
        case 'error':
          return `[Tool Error] read_pdf: ${outcome.message}`;
      }
    },
  };
}

/** Register the read_pdf tool with KodaX. `extDir` is the extension root directory. */
export function registerReadPdfTool(api: KodaXExtensionAPI, extDir: string): () => void {
  const deps = createSidecarDeps(api, extDir);
  return api.registerTool(createReadPdfTool(deps));
}
