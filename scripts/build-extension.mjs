// Bundle the read_pdf extension into a self-contained dist/extension.mjs.
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
  outfile: join(extDir, 'dist', 'extension.mjs'),
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

console.log('Built extensions/read_pdf/dist/extension.mjs');
