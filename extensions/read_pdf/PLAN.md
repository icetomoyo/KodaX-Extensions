# read_pdf Implementation Plan

Status: **active implementation**. This document is the source of truth for how `read_pdf`
is built. It supersedes the open questions in [README.md](README.md) and
[HANDOFF.md](HANDOFF.md), which describe the original design brief.

## 1. Goal

Give KodaX agents a provider-neutral `read_pdf` tool that returns model-friendly text from
PDFs — including scanned/image-only PDFs — without putting any heavy PDF/OCR dependency into
KodaX core. The KodaX-facing piece is a thin TypeScript bridge; all heavy work lives in a
separate Python **sidecar** process.

```
KodaX runtime (Bun-compiled exe)
  -> read_pdf extension (extension.mjs, thin bridge)   [self-contained, no node_modules]
  -> read_pdf sidecar (Python, own interpreter)        [self-contained, no system Python]
  -> model-friendly page-marked text
```

## 2. Locked Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Extension mechanism | KodaX directory extension, root `extension.*` entrypoint, `api.registerTool` | Matches current KodaX runtime; no new plugin runtime |
| Distribution format | **`extension.mjs`** (esbuild bundle); `extension.ts` is dev source only | KodaX ships as a `bun build --compile` exe; `.ts` needs `tsx` which is **not** available in the binary, so `.ts` extensions fail with `ERR_MODULE_NOT_FOUND`. `.mjs` uses native `import()` and works in dev / npm / binary modes. `extension.mjs` is also probed first in discovery. |
| Sidecar location | In-repo `extensions/read_pdf/sidecar/`, flat Python package | Fast to dogfood; whole `sidecar/` folder is extractable later |
| v1 engines | PyMuPDF text-layer + **RapidOCR** (`rapidocr-onnxruntime`) | Pure-pip, no system binary, no large model, strong CJK, CPU-friendly. VLM/MinerU/NoteEditor-lite deferred to v2 behind the pluggable backend protocol. |
| Online provisioning | **uv** (`uv run --project sidecar read_pdf ...`) auto-creates a cached isolated env | Declarative deps (`pyproject.toml` + `uv.lock`); git only stores text |
| Air-gapped delivery | **PyInstaller `--onedir`** self-contained bundle (own interpreter + deps + OCR models), built on a connected machine, carried into the intranet | Customers have *nothing* — no Node, no Python, no internet. KodaX exe brings its own JS runtime (Bun); the onedir brings its own Python. True zero dependency. |
| Tool result | Plain `string` (page-marked markdown) | Universally compatible across Claude / OpenAI-compatible / local / text-only gateways |
| Error convention | Return `[Tool Error] ...` strings, never throw | Matches KodaX built-in tools; registry wraps thrown errors anyway |

## 3. Why `.mjs` works on an intranet with no Node

KodaX is compiled with `bun build --compile`, embedding the Bun JS runtime inside the exe.
When KodaX loads an external `extension.mjs` it uses that **embedded Bun runtime** — the
target machine needs no system Node. The only constraint: `extension.mjs` must be
**self-contained** (no runtime `import` of external npm packages, because there is no
`node_modules/` next to the exe). We guarantee this by:

- bundling with esbuild (`bundle: true`, `format: 'esm'`, `platform: 'node'`),
- using only Node/Bun built-ins (`node:fs`, `node:path`, `node:url`) plus the injected `api`,
- importing KodaX types as **type-only** (erased at compile time).

## 4. Directory Layout

```
extensions/read_pdf/
  extension.ts              # dev entrypoint: export default activate(api)
  package.json
  src/
    kodax.ts                # minimal local type shims for the KodaX extension API (type-only)
    types.ts                # sidecar JSON contract types
    validate.ts             # input validation (path required, pages "1-3,7", engine, max_pages)
    format-result.ts        # sidecar JSON -> page-marked markdown
    sidecar-client.ts       # resolution ladder: endpoint -> bundled bin -> uv -> setup guidance
    tool.ts                 # registerReadPdfTool(api)
  tests/
    validate.test.ts
    format-result.test.ts
    sidecar-client.test.ts
    extension.test.ts
    fixtures/
      text-layer.json
      needs-ocr.json
      mineru.json
  sidecar/
    pyproject.toml          # deps: pymupdf, rapidocr-onnxruntime ; console_script read_pdf
    read_pdf/
      __init__.py
      cli.py                # argparse: read / inspect ; --format agent-json
      pipeline.py           # validate -> text layer -> density check -> OCR fallback -> assemble
      models.py             # dataclasses + JSON serialization (the contract)
      engines/
        __init__.py
        text_layer.py       # PyMuPDF get_text
        ocr.py              # RapidOCR backend behind a pluggable OCRBackend protocol
    BUILD_OFFLINE.md        # how to build & ship the air-gapped bundle
  extension.mjs             # built entrypoint at root (gitignored; KodaX loads this on a binary)
  dist/                     # other build artifacts (gitignored): offline staging, etc.
  PLAN.md / README.md / HANDOFF.md
```

Repo root adds shared tooling: `package.json` (workspaces), `tsconfig.json`,
`vitest.config.ts`, `.gitignore`, and `scripts/` (build-extension, build-sidecar, pack-offline).

## 5. Tool Schema

```
read_pdf(
  path: string (required),     // PDF path
  pages?: string,              // "1-3,7"
  force_ocr?: boolean,         // OCR even if a text layer exists
  max_pages?: number,          // safety cap
  engine?: string              // auto | text | ocr | mineru | noteeditor-lite
)
```

- `sideEffect: 'readonly'`, `planModeAllowed: true`, `interruptBehavior: 'cancel'`,
  `toClassifierInput: () => ''` (read-only → skip classifier).

## 6. Sidecar Resolution Ladder (offline-first)

`sidecar-client.ts` picks the transport, never assuming internet:

1. `READ_PDF_ENDPOINT` (env or config) → HTTP via `api.webhook` (daemon, future)
2. `READ_PDF_BIN` or `sidecar/bin/read_pdf[.exe]` exists → run directly via `api.exec` ← **air-gapped path**
3. `uv` available and `sidecar/pyproject.toml` present → `uv run --project sidecar read_pdf ...` ← dev / connected
4. none → return one-line actionable setup guidance (no generic failure)

## 7. Engine Routing (v1)

- `text` — text layer only, no OCR.
- `ocr` — OCR all requested pages (needs RapidOCR).
- `auto` — text layer first; pages with low text density (or `force_ocr`) fall back to RapidOCR;
  if no OCR backend is available those pages return a `needs_ocr` warning (partial success, not failure).
- `mineru` / `noteeditor-lite` — not configured in v1 → `ok:false` with an actionable error.
  KodaX code never imports these.

## 8. Sidecar JSON Contract

```json
{
  "ok": true,
  "file": "C:/docs/sample.pdf",
  "page_count": 8,
  "engine": "read_pdf/pymupdf",
  "selected_backend": "text-layer",
  "mode": "mixed",
  "pages": [
    { "page": 1, "source": "text-layer", "text": "...", "warnings": [] },
    { "page": 2, "source": "ocr", "text": "...", "warnings": ["OCR confidence unavailable"] }
  ],
  "needs_ocr": [],
  "warnings": [],
  "error": null
}
```

Rendered to markdown:

```
[PDF] sample.pdf
engine: read_pdf/pymupdf
backend: text-layer
pages: 1-2 of 8

--- page 1 | text-layer ---
...

--- page 2 | ocr ---
...

Warnings:
- OCR confidence unavailable
```

## 9. Git Hygiene

| Committed (text, reproducible) | Ignored (build artifacts / large / platform) |
|--------------------------------|----------------------------------------------|
| `extension.ts`, `src/*.ts`, `package.json`, `tsconfig.json` | `extension.mjs` (esbuild output, at extension root) |
| sidecar `*.py`, `pyproject.toml`, `uv.lock` | `dist/sidecar/bin/` (PyInstaller onedir + interpreter + models) |
| `scripts/*`, `BUILD_OFFLINE.md`, bundle manifest + checksums | offline `.zip`, `node_modules/`, `.venv/`, `__pycache__/`, `*.onnx` |
| tests + fixtures | uv cache |

Lockfiles (`uv.lock`, `package-lock.json`) **are** committed for reproducibility.

## 10. Phases

- **Phase 0** — scaffolding (root config, extension package.json, .gitignore).
- **Phase 1** — TS bridge: validate, format-result, sidecar-client, tool, extension entry.
- **Phase 2** — Python sidecar: text_layer first, then RapidOCR, contract JSON output.
- **Phase 3** — vitest tests + fixtures (the 7 cases from HANDOFF §5).
- **Phase 4** — dogfood: `kodax --extension <path> "Read pages 1-2 of C:/tmp/sample.pdf"`. ✅ done
- **Phase 5** — offline build: `build-extension.mjs` → `extension.mjs`; PyInstaller onedir;
  `pack-offline` → versioned zip + checksum (run on a connected build machine). ✅ done
- **Phase 6 (optional)** — tiny KodaX core patch so built-in `read` returns a `.pdf` hint.

## Validation status (all green)

- `npm test`: 31/31 vitest cases pass; `tsc --noEmit` clean.
- Real sidecar via uv: text-layer extraction returns the correct contract JSON.
- Standalone sidecar binary (PyInstaller onedir): `inspect`, text-layer, and forced OCR all work
  with no uv/Python/network (RapidOCR models embedded).
- Dogfood through KodaX dev (`.ts`, tsx) and through the compiled `kodax.exe` (`.mjs`, Bun).
- Full zero-dependency chain (`kodax.exe` + `extension.mjs` + `read_pdf.exe`) and the packed
  `pack-offline` bundle both validated end-to-end.
- Windows/PowerShell note: bundled-binary invocation uses the `&` call operator (see
  `src/sidecar-client.ts: executableInvocation`).

## 10b. OCR backend extensibility (v0.1.1)

OCR backends are pluggable via a registry in `sidecar/read_pdf/engines/ocr.py`
(`register_backend` / `create_backend` / `registered_engines`). Adding a backend =
implement the `OCRBackend` protocol + one `register_backend(...)` call + an import line
in `engines/__init__.py`. The `engine` argument is forwarded verbatim from the tool to
the sidecar, so new backends are selectable with `engine=<name>` without changing the TS
layer (TS validation now accepts any safe engine token, not a fixed enum). Unknown engines
return an actionable error listing available ones. Full guide:
`sidecar/read_pdf/engines/README.md`.

## 11. Out of Scope (v1)

PPTX assembly/font/background/fidelity work, VLM/MinerU/cloud OCR backends, overriding the
built-in `read` tool, and daemon `serve` mode (HTTP client code is stubbed; server deferred to v3).
