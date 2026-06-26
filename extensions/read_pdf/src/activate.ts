import type { KodaXExtensionAPI } from './kodax';
import { registerReadPdfTool } from './tool';

export const READ_PDF_PROMPT_HINT = [
  '## read_pdf Extension Routing',
  '- A `read_pdf` tool is available for PDF files.',
  '- When the user asks to read, summarize, extract, translate, search, or answer questions about a `.pdf` file, call `read_pdf` with the PDF path.',
  '- If the user supplied an explicit absolute or relative PDF path, use that exact path with `read_pdf`; do not search the workspace with `glob` first.',
  '- Use `glob` only when the user asks you to find a PDF but did not provide a path.',
  '- The built-in `read` tool is for text and image files; it does not parse PDF content.',
].join('\n');

function registerReadPdfPromptHint(api: KodaXExtensionAPI): (() => void) | undefined {
  return api.hook?.('provider:before', (context) => {
    if (context.systemPrompt.includes('## read_pdf Extension Routing')) {
      return;
    }
    context.replaceSystemPrompt(`${context.systemPrompt}\n\n${READ_PDF_PROMPT_HINT}`);
  });
}

export function activateReadPdf(api: KodaXExtensionAPI, extDir: string): () => void {
  const disposables = [
    registerReadPdfTool(api, extDir),
    registerReadPdfPromptHint(api),
  ].filter((dispose): dispose is () => void => typeof dispose === 'function');
  api.logger?.info?.('read_pdf extension activated');
  return () => {
    for (const dispose of disposables.reverse()) {
      dispose();
    }
  };
}
