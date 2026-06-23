// Assemble an air-gapped offline bundle of the read_pdf extension.
//
// Prerequisites (run on a CONNECTED machine, in order):
//   1. node scripts/build-extension.mjs   -> extensions/read_pdf/dist/extension.mjs
//   2. node scripts/build-sidecar.mjs      -> extensions/read_pdf/sidecar/bin/read_pdf/
//
// This script stages those artifacts into a folder ready to copy onto the
// intranet machine under ~/.kodax/extensions/read_pdf, and writes a manifest with
// SHA-256 checksums. The target then needs nothing else: KodaX.exe runs
// extension.mjs (embedded Bun runtime) and the bundled binary runs the sidecar.
//
// Usage: node scripts/pack-offline.mjs
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(repoRoot, 'extensions', 'read_pdf');
const stage = join(extDir, 'dist', 'offline', 'read_pdf');

const extensionMjs = join(extDir, 'dist', 'extension.mjs');
const sidecarBin = join(extDir, 'sidecar', 'bin', 'read_pdf');

for (const [label, path] of [
  ['extension.mjs (run: node scripts/build-extension.mjs)', extensionMjs],
  ['sidecar binary (run: node scripts/build-sidecar.mjs)', sidecarBin],
]) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}\n  expected at: ${path}`);
    process.exit(1);
  }
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

cpSync(extensionMjs, join(stage, 'extension.mjs'));
cpSync(join(extDir, 'package.json'), join(stage, 'package.json'));
cpSync(join(extDir, 'README.md'), join(stage, 'README.md'));
mkdirSync(join(stage, 'sidecar', 'bin'), { recursive: true });
cpSync(sidecarBin, join(stage, 'sidecar', 'bin', 'read_pdf'), { recursive: true });

// A focused, self-contained install guide that ships inside the bundle.
const installGuide = `# read_pdf — offline install (air-gapped)

This bundle is fully self-contained. The target machine needs only KodaX itself
(no Node, no Python, no internet).

## Install

1. Unzip this folder to: ~/.kodax/extensions/read_pdf
   (or load it from anywhere with: kodax --extension <this-folder>)

   Expected layout:
     read_pdf/
       extension.mjs
       package.json
       sidecar/bin/read_pdf/read_pdf(.exe)

2. Verify integrity:
     sha256sum -c manifest.sha256          # Linux/macOS/Git Bash
     # PowerShell: compare Get-FileHash against manifest.sha256

3. (Optional) Confirm the sidecar runs offline:
     sidecar/bin/read_pdf/read_pdf inspect <any.pdf>

## Use

Ask KodaX to read a PDF, e.g.:
  kodax "Read pages 1-3 of C:/docs/report.pdf and summarize it."

The agent calls the read_pdf tool automatically. Parameters:
  path (required), pages ("1-3,7"), force_ocr, max_pages, engine (auto|text|ocr).

## Troubleshooting

- "sidecar is not available": ensure sidecar/bin/read_pdf/ is present,
  or set READ_PDF_BIN to the executable's absolute path.
- needs_ocr warning on a scanned page: pass engine="ocr" (OCR is bundled).

Full docs: see README.md in this folder.
`;
writeFileSync(join(stage, 'INSTALL.md'), installGuide);

// Checksums for integrity verification after transfer.
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(stage);
const manifest = files
  .filter((f) => !f.endsWith('manifest.sha256'))
  .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(stage, f)}`)
  .join('\n');
writeFileSync(join(stage, 'manifest.sha256'), `${manifest}\n`);

console.log(`Staged offline bundle at: ${stage}`);
console.log('Zip this folder, carry it into the intranet, and unzip to ~/.kodax/extensions/read_pdf');
