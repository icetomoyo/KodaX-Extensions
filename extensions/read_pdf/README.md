# read_pdf KodaX Extension

Status: **in implementation**. See [PLAN.md](PLAN.md) for the authoritative, finalized build
plan. This README captures the design rationale; where it lists open questions, PLAN.md has the
resolved decisions.

## Finalized Decisions (see PLAN.md for detail)

- **Distribution format is `extension.mjs`**, not `extension.ts`. KodaX ships as a
  `bun build --compile` exe, and `.ts` extensions fail there because `tsx` is not available in
  the binary. `extension.ts` stays as dev source; esbuild bundles it to a self-contained
  `extension.mjs`. KodaX's embedded Bun runtime executes it, so the target needs no Node.
- **OCR engine for v1 is RapidOCR** (`rapidocr-onnxruntime`): pure-pip, no system binary, no
  large model, strong CJK, CPU-friendly. VLM/MinerU/NoteEditor-lite are deferred to v2 behind a
  pluggable backend protocol.
- **Online provisioning uses `uv`**; **air-gapped delivery uses a PyInstaller `--onedir` bundle**
  that carries its own Python interpreter, dependencies, and OCR models. Built on a connected
  machine, carried into the intranet, zero dependency at runtime.
- **Sidecar lives in-repo** at `extensions/read_pdf/sidecar/` as a flat Python package.

## Summary

`read_pdf` is the first extension planned for the KodaX extension ecosystem. It gives KodaX agents a provider-neutral way to read PDFs, including scanned/image-only PDFs, without putting OCR engines, layout models, PyMuPDF, ONNX Runtime, OpenCV, Torch, MinerU, or cloud OCR SDKs into KodaX core.

The extension should be a thin KodaX bridge. The heavy document pipeline should live in a separate sidecar process or CLI that can also be reused by other agent clients.

```text
KodaX runtime
  -> read_pdf extension: read_pdf tool
  -> read_pdf sidecar: text-layer extraction / engine routing / OCR / cache
  -> model-friendly text result
```

## Installation & Usage

There are two ways to run `read_pdf`. Pick the one that matches the target machine.

### A. Connected machine (developers, internet available)

Requires KodaX plus [uv](https://docs.astral.sh/uv/). uv provisions the Python sidecar
automatically on first use (cached afterward); no manual `pip install`.

1. Install uv once: `winget install astral-sh.uv` (Windows) or see the uv docs.
2. Point KodaX at the extension folder:
   ```bash
   kodax --extension /path/to/extensions/read_pdf "Read pages 1-2 of C:/tmp/sample.pdf"
   ```
   Or install it for auto-discovery by copying/symlinking the folder to `~/.kodax/extensions/read_pdf`.
3. First call downloads the Python dependencies; later calls are fast. OCR models download
   on first OCR use only (text-layer PDFs never download them).

### B. Air-gapped machine (no Node, no Python, no internet)

The target needs **nothing pre-installed** — just KodaX itself (the standalone `kodax`
binary brings its own JS runtime; the bundled sidecar brings its own Python + OCR models).

You receive a zip built on a connected machine (see [sidecar/BUILD_OFFLINE.md](sidecar/BUILD_OFFLINE.md)).
To install it:

1. Unzip to `~/.kodax/extensions/read_pdf` so the layout is:
   ```text
   ~/.kodax/extensions/read_pdf/
     extension.mjs            # the extension (loaded by KodaX)
     package.json
     sidecar/bin/read_pdf/    # self-contained sidecar: interpreter + deps + OCR models
       read_pdf.exe
   ```
   (Or load from anywhere with `kodax --extension <unzipped-folder>`.)
2. Verify integrity against the shipped manifest:
   ```bash
   # from inside the unzipped folder
   sha256sum -c manifest.sha256        # Linux/macOS / Git Bash
   # PowerShell: compare Get-FileHash output to manifest.sha256
   ```
3. Verify the sidecar runs offline (optional sanity check):
   ```bash
   sidecar/bin/read_pdf/read_pdf inspect C:/path/to/any.pdf
   ```
4. Use it through KodaX exactly as in mode A. The extension auto-detects the bundled binary —
   no uv, no Python, no network calls at runtime.

### Calling the tool

Once installed, the agent calls `read_pdf` on its own. You can also prompt it directly:

```text
Read pages 1-3 of C:/docs/report.pdf and summarize the key findings.
```

Tool parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` (required) | string | PDF file path. |
| `pages` | string | 1-based range, e.g. `"1-3,7"`. Omit for all pages. |
| `force_ocr` | boolean | OCR even if a text layer exists. |
| `max_pages` | number | Safety cap on pages processed in one call. |
| `engine` | string | `auto` (default), `text`, `ocr`, `mineru`, `noteeditor-lite`. |

### Optional configuration (environment variables)

| Variable | Effect |
|----------|--------|
| `READ_PDF_ENDPOINT` | If set (e.g. `http://127.0.0.1:8765`), the extension calls a running sidecar HTTP server instead of spawning a process. Highest priority. |
| `READ_PDF_BIN` | Absolute path to a sidecar executable, overriding the default `sidecar/bin/read_pdf/read_pdf[.exe]` lookup. |

The extension resolves transport in this order: `READ_PDF_ENDPOINT` → bundled binary →
`uv` (connected) → actionable setup guidance.

### Adding a stronger OCR backend

OCR backends are pluggable. You can add a new one (local VLM, cloud OCR, etc.) and select it
live with `engine=<name>` **without changing this extension** — the `engine` value is forwarded
to the sidecar's backend registry. See the step-by-step guide:
[sidecar/read_pdf/engines/README.md](sidecar/read_pdf/engines/README.md).

### Troubleshooting

- **"sidecar is not available"**: none of the transports were found. On a connected machine,
  install uv. On an air-gapped machine, ensure the offline bundle's `sidecar/bin/read_pdf/`
  is present, or set `READ_PDF_BIN`.
- **`needs_ocr` warning with empty text**: the page is scanned and the OCR backend was not
  available. Use the offline bundle (which embeds RapidOCR) or pass `engine="ocr"`.
- **`engine "mineru"/"noteeditor-lite" is not configured`**: these backends are planned for
  v2. Use `auto`, `text`, or `ocr` in v1.

## Why This Exists

KodaX currently reads text files and image files, but PDFs fall through as unsupported binary files. Some PDF documents can be handled by extracting the embedded text layer, while scanned PDFs need OCR. A model-specific approach such as sending a small `application/pdf` block to the model is not a stable baseline because many open-source and OpenAI-compatible backends only accept text and possibly images, not PDF document blocks inside tool results.

The baseline for KodaX should therefore be: extract or OCR the PDF into text, then return page-marked text to the model.

## Design Principles

- Keep KodaX core light. Do not add heavyweight OCR or document-layout dependencies to KodaX core.
- Return text as the primary result. This works across Claude, OpenAI-compatible models, local models, and text-only gateways.
- Do not upload documents by default. Cloud OCR must be explicit sidecar configuration.
- Make OCR optional. Text-layer extraction should work even when no OCR backend is installed.
- Fail locally and partially. Return usable pages plus warnings rather than failing the entire PDF whenever possible.
- Reuse the NoteEditor pipeline ideas, not the full PPTX conversion stack.
- Treat MinerU as an optional heavy backend, not as the default KodaX integration path.
- Keep the extension name literal and user-facing: `read_pdf`.

## Relationship To NoteEditor

This extension is inspired by `C:/Works/GitWorks/NoteEditor`, especially these ideas:

- `parser.py`: render PDF pages and preserve page metadata.
- `layout.py` and `text_detection.py`: use layout/text region detection to avoid blindly OCRing whole pages.
- `ocr.py`: crop text-like regions and call a backend per region.
- `infra/ocr_backend.py`: use a pluggable OCR backend abstraction for Ollama, vLLM, Transformers, and API backends.
- `pipeline.py`: isolate page/region failures and keep processing the rest of the document.

Important difference: NoteEditor targets high-fidelity PDF-to-PPTX conversion. `read_pdf` targets document understanding for agents. It should not include PPTX assembly, font matching, background inpainting, editable slide reconstruction, or visual-fidelity heuristics unless they directly improve text extraction.

## Relationship To MinerU

MinerU should be treated as an optional heavy document-parsing backend, not as a replacement for the NoteEditor-inspired controllable pipeline and not as a dependency of KodaX core.

The expected role split:

- KodaX core: no MinerU dependency.
- KodaX extension: register `read_pdf` and call the sidecar.
- `read_pdf` sidecar: choose the parsing engine.
- MinerU backend: used when installed locally or configured as a remote service.
- NoteEditor-lite backend: used when we need a smaller, more controllable layout/OCR pipeline.

MinerU is attractive because it is a broad document parser that can produce Markdown/JSON and has strong coverage for scanned pages, OCR, formulas, tables, reading order, and complex layouts. It is also heavy enough that it belongs behind the sidecar boundary. The extension should call it only through the sidecar, never directly from KodaX core.

Recommended engine policy:

```text
engine=auto:
  1. Try PDF text layer first.
  2. If text is good enough, return it without OCR.
  3. If layout is complex, formula/table-heavy, or OCR is needed and MinerU is available, prefer MinerU.
  4. If the document is slide-like, diagram-heavy, or needs controllable region OCR, prefer NoteEditor-lite.
  5. If no OCR backend is available, return partial text plus clear warnings.
```

The product decision is not MinerU vs NoteEditor. It is a router: let the sidecar pick the cheapest reliable extraction path for the current document and machine.

## KodaX Integration Model

KodaX's current mechanism is an extension runtime, not a marketplace plugin runtime. A KodaX extension is a local JavaScript or TypeScript module exporting a default activation function or named `activate(api)` function.

KodaX can now load either a module file or a package directory. That changes the recommended `read_pdf` shape: the extension folder should expose a root entrypoint such as `extension.ts`, and that entrypoint can import implementation modules from `src/`.

Current loading paths:

- Default discovery: KodaX scans `${KODAX_HOME}/extensions`, normally `~/.kodax/extensions`, for direct child extension modules, package directories, and symlinks to either.
- User config: `~/.kodax/config.json` can contain an `extensions` array. Relative paths resolve from the config file directory.
- CLI: `kodax --extension <path>` loads a module file or directory. Relative paths resolve from the current working directory.
- ACP/server hosts also load default discovery and config extensions, so desktop and IDE hosts see the same extension-provided tools.

Directory packages are resolved by root entrypoint filename. Prefer `extension.ts` for source development and `extension.mjs` for built distribution.

```text
extension.mjs
extension.js
extension.cjs
extension.mts
extension.ts
extension.cts
index.mjs
index.js
index.cjs
index.mts
index.ts
index.cts
```

Load order is default discovery, then config, then CLI. For duplicate tool names, later registrations shadow earlier ones and diagnostics retain the shadowed sources. `read_pdf` should not rely on shadowing; it should provide one clear `read_pdf` tool.

This extension should register one primary tool:

```text
read_pdf
```

Recommended tool definition:

```ts
api.registerTool({
  name: 'read_pdf',
  description: 'Read PDF pages as model-friendly text. OCR/heavy parsing is used only when configured by the read_pdf sidecar.',
  sideEffect: 'readonly',
  planModeAllowed: true,
  interruptBehavior: 'cancel',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'PDF file path to read.'
      },
      pages: {
        type: 'string',
        description: 'Optional 1-based page range, for example: 1-3,7.'
      },
      force_ocr: {
        type: 'boolean',
        description: 'When true, OCR pages even if a text layer exists.'
      },
      max_pages: {
        type: 'number',
        description: 'Optional safety cap for pages processed in this call.'
      },
      engine: {
        type: 'string',
        description: 'Optional sidecar engine hint: auto, text, mineru, noteeditor-lite, or ocr.'
      }
    },
    required: ['path']
  },
  toClassifierInput: () => '',
  handler: async (input, ctx) => {
    // Call read_pdf CLI or HTTP sidecar and return markdown text.
  }
});
```

Do not override the built-in `read` tool in the first version. A later tiny KodaX-core improvement can make `read` return a better PDF-specific hint when it sees `.pdf`.
## Sidecar Contract

The sidecar should expose both CLI and HTTP forms.

CLI sketch:

```bash
read_pdf inspect path/to/file.pdf --format json
read_pdf read path/to/file.pdf --pages 1-3,7 --engine auto --format agent-json
read_pdf serve --host 127.0.0.1 --port 8765
```

HTTP sketch:

```http
POST /v1/read_pdf
Content-Type: application/json

{
  "path": "C:/docs/sample.pdf",
  "pages": "1-3,7",
  "force_ocr": false,
  "max_pages": 20,
  "engine": "auto"
}
```

Sidecar JSON result:

```json
{
  "ok": true,
  "file": "C:/docs/sample.pdf",
  "page_count": 8,
  "engine": "read_pdf/pymupdf",
  "selected_backend": "text-layer",
  "mode": "mixed",
  "pages": [
    {
      "page": 1,
      "source": "text-layer",
      "text": "...",
      "warnings": []
    },
    {
      "page": 2,
      "source": "ocr",
      "text": "...",
      "warnings": ["OCR confidence unavailable for this backend"]
    }
  ],
  "needs_ocr": [],
  "warnings": []
}
```

The KodaX extension should convert this into compact markdown:

```text
[PDF] sample.pdf
engine: read_pdf/pymupdf
backend: text-layer
pages: 1-2 of 8

--- page 1 | text-layer ---
...

--- page 2 | ocr ---
...

Warnings:
- OCR confidence unavailable for this backend
```

## Sidecar Pipeline

Recommended sidecar pipeline:

1. Validate path, size, page count, and requested page range.
2. Extract embedded text layer first.
3. Detect low text density or empty pages.
4. If text is sufficient, return immediately.
5. If OCR or complex parsing is needed, route to the selected backend.
6. Prefer layout-aware OCR when a layout/text detector is available.
7. Fall back to whole-page OCR when no layout detector exists.
8. Return page-marked text, warnings, backend metadata, and partial failures.

Backend priority should be configurable in the sidecar, not in KodaX core:

```text
document parser: MinerU CLI / MinerU API
controllable pipeline: NoteEditor-lite
local service OCR/VLM: vLLM / Ollama
local library OCR: Transformers / Tesseract / OCRmyPDF
cloud API: Tencent / Zhipu / other OCR providers, explicit opt-in only
```

## Privacy And Resource Policy

Default behavior:

- Text-layer extraction is allowed locally.
- Local OCR is allowed only when a backend is installed or a local sidecar is running.
- MinerU is allowed only when installed locally or configured as an explicit remote service.
- Cloud OCR is disabled unless the sidecar has explicit cloud configuration.
- Large PDFs should require page ranges or enforce a page cap.
- The extension must surface clear warnings rather than silently uploading or silently skipping pages.

## Proposed Directory Shape

This folder is documentation-only for now. A future implementation should grow into a directory extension package that KodaX can load directly:

```text
extensions/read_pdf/
  README.md
  HANDOFF.md
  extension.ts
  src/
    tool.ts
    sidecar-client.ts
    format-result.ts
  tests/
    extension.test.ts
  package.json
```

`extension.ts` is the KodaX entrypoint. Keep it small and import the real implementation from `src/`. This lets all current loading paths work:

```bash
kodax --extension C:/Works/GitWorks/KodaX-author/KodaX-Extensions/extensions/read_pdf "Read C:/tmp/sample.pdf"
```

It also lets users install the folder under `~/.kodax/extensions/read_pdf` for default discovery.

The sidecar can live in a separate repository or in a sibling project, for example:

```text
read_pdf/
  src/read_pdf/
    cli.py
    server.py
    pipeline.py
    engines/
      text_layer.py
      mineru.py
      noteeditor_lite.py
      ocr.py
  integrations/kodax/extension.ts
  integrations/mcp/server.py
```
## Roadmap

Phase 1: extension-only MVP

- Implement `read_pdf` as a local KodaX directory extension package with a root `extension.ts` entrypoint.
- Call `read_pdf read ... --format agent-json` through a sidecar client.
- Support text-layer PDFs first.
- Return scanned-PDF warnings when OCR is unavailable.

Phase 2: backend routing

- Add `engine` passthrough and `engine=auto` routing.
- Add MinerU as an optional parser backend through CLI or API.
- Add NoteEditor-lite as the controllable fallback pipeline.
- Add local OCR/VLM adapters in the sidecar.
- Support explicit cloud OCR configuration.
- Add page caps, timeout handling, and useful backend diagnostics.

Phase 3: daemon mode

- Add `read_pdf serve` for warm models and cache reuse.
- Extension prefers HTTP when `READ_PDF_ENDPOINT` or config endpoint is available.
- CLI fallback remains available.

Phase 4: ecosystem bridge

- Optionally expose the sidecar as an MCP server for non-KodaX clients.
- Keep KodaX's direct `read_pdf` tool as the best first-party UX.

## Resolved Questions

These were the original open questions; resolutions are recorded in [PLAN.md](PLAN.md).

- **Sidecar location?** In-repo under `extensions/read_pdf/sidecar/` (flat Python package),
  extractable to its own repo later.
- **CLI vs daemon?** CLI first (via `uv run` or the bundled binary). A resolution ladder prefers
  an HTTP endpoint when `READ_PDF_ENDPOINT` is set; daemon `serve` mode is deferred to v3.
- **Page range format?** String (`1-3,7`) in the public tool schema; parsed in the sidecar.
- **NoteEditor layout detection in v1?** Deferred. v1 is text-layer-first with whole-page
  RapidOCR fallback. Layout-aware region OCR is a v2 (NoteEditor-lite) backend.
- **Default OCR on Windows without GPU?** RapidOCR (`rapidocr-onnxruntime`), CPU via onnxruntime.
- **First MinerU target?** Deferred to v2 as an optional sidecar backend (local CLI first),
  invoked only through the sidecar, never imported by KodaX code.
