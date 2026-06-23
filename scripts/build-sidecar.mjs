// Build the self-contained PyInstaller --onedir bundle for the read_pdf sidecar.
//
// Run this on a CONNECTED machine matching the TARGET OS/arch (PyInstaller is not
// a cross-compiler). The output carries its own Python interpreter, dependencies,
// and OCR models, so the air-gapped target needs no Python, no uv, no internet.
//
// Output: extensions/read_pdf/sidecar/bin/read_pdf/read_pdf[.exe]
//   (this is the path the extension's resolution ladder looks for)
//
// Usage: node scripts/build-sidecar.mjs
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sidecarDir = join(repoRoot, 'extensions', 'read_pdf', 'sidecar');
const distRoot = join(sidecarDir, 'build');
const binRoot = join(sidecarDir, 'bin');

// We drive PyInstaller through uv so deps + a known-good interpreter are provisioned
// reproducibly from pyproject.toml / uv.lock. `--collect-all rapidocr_onnxruntime`
// pulls in RapidOCR's bundled ONNX models so OCR works fully offline.
const args = [
  'run',
  '--project',
  sidecarDir,
  '--with',
  'pyinstaller',
  'pyinstaller',
  '--noconfirm',
  '--onedir',
  '--name',
  'read_pdf',
  '--distpath',
  binRoot,
  '--workpath',
  distRoot,
  '--specpath',
  distRoot,
  '--collect-all',
  'rapidocr_onnxruntime',
  '--collect-submodules',
  'fitz',
  // Make the `read_pdf` package importable so the launcher's absolute import resolves.
  '--paths',
  sidecarDir,
  // Entry is a launcher that imports the package (relative imports break if PyInstaller
  // runs cli.py directly as __main__).
  join(sidecarDir, 'main.py'),
];

console.log(`Running: uv ${args.join(' ')}`);
const result = spawnSync('uv', args, { stdio: 'inherit', cwd: sidecarDir });

if (result.error) {
  console.error('Failed to launch uv. Install uv first: https://docs.astral.sh/uv/');
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('Built sidecar bundle at extensions/read_pdf/sidecar/bin/read_pdf/');
console.log('Validate by running: extensions/read_pdf/sidecar/bin/read_pdf/read_pdf inspect <some.pdf>');
