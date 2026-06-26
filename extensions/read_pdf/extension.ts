import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KodaXExtensionAPI } from './src/kodax';
import { activateReadPdf } from './src/activate';

/**
 * KodaX extension entrypoint. Develop against this `.ts` file; ship the
 * esbuild-bundled `extension.mjs` at the extension root (see scripts/build-extension.mjs)
 * because KodaX's compiled binary cannot load `.ts` extensions. The built `.mjs` sits next
 * to this file and is picked first by KodaX's directory resolver.
 */
export default function activate(api: KodaXExtensionAPI): () => void {
  const extDir = dirname(fileURLToPath(import.meta.url));
  return activateReadPdf(api, extDir);
}

export { activate };
