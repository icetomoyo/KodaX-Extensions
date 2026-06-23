# Building the air-gapped read_pdf bundle

Target customers have **no Node, no Python, no internet**. The delivery is a
self-contained folder built once on a connected machine and carried into the
intranet. KodaX.exe runs `extension.mjs` with its embedded Bun runtime; the
PyInstaller bundle runs the sidecar with its embedded Python interpreter.

> PyInstaller is **not** a cross-compiler. Build on the **same OS/arch** as the
> target (e.g. build the Windows bundle on a connected Windows machine).

## Prerequisites (connected build machine)

- Node 20+ (`node --version`)
- [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv` or the official installer)
- Repo dependencies installed: `npm install` at the repo root.

## Steps

```bash
# 1. Bundle the TypeScript extension into a self-contained extension.mjs
node scripts/build-extension.mjs

# 2. Build the sidecar binary (own interpreter + pymupdf + rapidocr + OCR models)
node scripts/build-sidecar.mjs

# 3. Stage the offline bundle + checksums
node scripts/pack-offline.mjs
```

This produces `extensions/read_pdf/dist/offline/read_pdf/`:

```
read_pdf/
  extension.mjs              # compiled bridge (Bun-compatible, no node_modules)
  package.json
  README.md
  sidecar/bin/read_pdf/      # PyInstaller --onedir: interpreter + deps + models
  manifest.sha256            # integrity checksums
```

## Deliver to the intranet

1. Zip `dist/offline/read_pdf/`.
2. Carry the zip into the intranet by your approved transfer process.
3. Unzip to `~/.kodax/extensions/read_pdf` (or load via
   `kodax --extension <path-to-unzipped-folder>`).
4. Verify integrity: `sha256sum -c manifest.sha256` (or PowerShell `Get-FileHash`).
5. Verify the sidecar runs offline:
   `sidecar/bin/read_pdf/read_pdf inspect <some.pdf>`

The extension's resolution ladder finds `sidecar/bin/read_pdf/read_pdf[.exe]`
automatically — no uv, no Python, no network calls at runtime.

## Notes

- OCR models are bundled by `--collect-all rapidocr_onnxruntime`, so OCR works
  fully offline. Pure text-layer PDFs never load the OCR engine.
- None of these artifacts are committed to git (see root `.gitignore`); rebuild
  them per release and distribute as release assets / internal file share.
