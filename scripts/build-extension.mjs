// Bundle the read_pdf extension into a self-contained extension.mjs at the extension root.
//
// Why: KodaX ships as a `bun build --compile` binary that cannot load `.ts`
// extensions (no `tsx` at runtime). A single bundled `.mjs` using only Node/Bun
// built-ins loads via native import() in dev, npm, and binary modes.
//
// Usage: node scripts/build-extension.mjs
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(repoRoot, 'extensions', 'read_pdf');

await build({
  entryPoints: [join(extDir, 'extension.ts')],
  // Emit to the extension ROOT so KodaX's directory resolver picks extension.mjs
  // (it ranks above extension.ts and is the only form a compiled binary can load),
  // and so import.meta.url resolves extDir to the extension root where sidecar/ lives.
  outfile: join(extDir, 'extension.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // KodaX types are imported as type-only and erased; never bundle them.
  external: ['@kodax-ai/coding'],
  banner: {
    js: '// Generated from extension.ts by scripts/build-extension.mjs. Do not edit by hand.',
  },
  logLevel: 'info',
});

console.log('Built extensions/read_pdf/extension.mjs');
