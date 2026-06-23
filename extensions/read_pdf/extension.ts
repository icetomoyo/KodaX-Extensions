import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KodaXExtensionAPI } from './src/kodax';
import { registerReadPdfTool } from './src/tool';

/**
 * KodaX extension entrypoint. Develop against this `.ts` file; ship the
 * esbuild-bundled `dist/extension.mjs` (see scripts/build-extension.mjs) because
 * KodaX's compiled binary cannot load `.ts` extensions.
 */
export default function activate(api: KodaXExtensionAPI): void {
  const extDir = dirname(fileURLToPath(import.meta.url));
  registerReadPdfTool(api, extDir);
  api.logger?.info?.('read_pdf extension activated');
}

export { activate };
