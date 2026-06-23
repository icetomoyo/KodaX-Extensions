# read_pdf Extension Handoff

This handoff is for the thread that will implement the first KodaX extension in `C:/Works/GitWorks/KodaX-author/KodaX-Extensions`.

## Current Task

Build the first KodaX ecosystem extension: `read_pdf`.

Goal: let KodaX agents read PDFs, including image-only/scanned PDFs, by calling an optional sidecar that converts PDF content into model-friendly text.

## Naming Decision

Use `read_pdf` as the extension, folder, sidecar, and primary tool name. Keep the name literal in user-facing docs, tool schemas, and handoff material.

## Decisions Already Made

- Use KodaX's current `extension` mechanism, not a new plugin runtime.
- Register a direct `read_pdf` tool through `api.registerTool(...)`.
- Keep the KodaX extension thin.
- Put heavy PDF/OCR work in a sidecar CLI or HTTP service.
- Return text to the model as the baseline; do not rely on model-specific PDF document blocks.
- Do not put PyMuPDF, ONNX Runtime, OpenCV, Torch, MinerU, or OCR models into KodaX core.
- Do not override the built-in `read` tool in v1.
- Cloud OCR must be explicit sidecar configuration, never the default.
- MinerU should be an optional sidecar backend, not a KodaX dependency and not a replacement for NoteEditor-lite.
- The sidecar should own engine routing: text layer first, then MinerU / NoteEditor-lite / OCR backends as needed.

## Relevant KodaX References

KodaX extension runtime:

- `C:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/extensions/types.ts`
  - `KodaXExtensionAPI` exposes `registerTool`, `registerCommand`, `registerCapabilityProvider`, `registerSkillPath`, `registerAgent`, hooks, `exec`, and `webhook`.
- `C:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/extensions/runtime.ts`
  - loads `.js/.mjs/.cjs/.ts/.mts/.cts` extension modules.
  - resolves directory extension packages through `resolveExtensionEntrypoint(...)`.
  - expects a default function or named `activate(api)`.
- `C:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/extensions/discovery.ts`
  - discovers default extensions from `${KODAX_HOME}/extensions`, normally `~/.kodax/extensions`, including symlinks to module files or package directories.
  - resolves package directories via root `extension.*` or `index.*` entrypoints, with `extension.*` preferred.
- `C:/Works/GitWorks/KodaX-author/KodaX/src/kodax_cli.ts`
  - CLI supports `--extension <path>` for a module file or package directory.
  - config supports an `extensions` array.
  - load order is discovery, config, then CLI.
- `C:/Works/GitWorks/KodaX-author/KodaX/src/acp_server.ts`
  - ACP/server hosts load default discovery and config extensions.
- `C:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/tools/registry.ts`
  - extension tools enter the same registry as built-in tools.

KodaX PDF gap:

- `C:/Works/GitWorks/KodaX-author/KodaX/packages/coding/src/tools/read.ts`
  - current `read` handles text and image files.
  - PDFs currently fall through as unsupported binary files.

## Relevant NoteEditor References

Use NoteEditor for design inspiration, not for a direct copy.

- `C:/Works/GitWorks/NoteEditor/src/noteeditor/stages/parser.py`
  - PDF page rendering and embedded resource extraction.
- `C:/Works/GitWorks/NoteEditor/src/noteeditor/stages/layout.py`
  - layout detection and region labels.
- `C:/Works/GitWorks/NoteEditor/src/noteeditor/stages/text_detection.py`
  - supplemental text detection and merge/demotion logic.
- `C:/Works/GitWorks/NoteEditor/src/noteeditor/stages/ocr.py`
  - crop text regions, choose task prompt, call OCR backend, skip failed regions.
- `C:/Works/GitWorks/NoteEditor/src/noteeditor/infra/ocr_backend.py`
  - pluggable OCR backends: Ollama, vLLM, Transformers, API.
- `C:/Works/GitWorks/NoteEditor/src/noteeditor/pipeline.py`
  - per-page fallback and checkpoint-minded pipeline orchestration.

Do not include NoteEditor-specific PPTX features in read_pdf v1:

- PPTX assembly
- font matching
- background inpainting
- editable slide reconstruction
- visual fidelity tuning unrelated to text extraction

## MinerU Backend Notes

A separate thread investigated MinerU and concluded it is worth supporting as a backend, but only behind the sidecar.

Carry this into implementation as a routing decision:

- `engine=text`: text-layer extraction only.
- `engine=mineru`: call MinerU CLI/API if configured, otherwise return an actionable error.
- `engine=noteeditor-lite`: use the controllable NoteEditor-inspired layout/OCR path.
- `engine=ocr`: use direct OCR backend selection.
- `engine=auto`: text layer first; prefer MinerU for complex document parsing, formulas, tables, and OCR-heavy pages; prefer NoteEditor-lite for slide-like or diagram-heavy pages where controlled region OCR matters.

Do not make KodaX extension code import MinerU packages. The extension should only pass the engine hint to the sidecar and format the sidecar result.

## Suggested Implementation Plan

1. Create a minimal KodaX extension module.

   Proposed path:

   ```text
   extensions/read_pdf/extension.ts
   ```

   The root entrypoint is important because KodaX's current discovery mechanism resolves directory packages through `extension.*` or `index.*` files at the package root. It should export:

   ```ts
   export default function activate(api: KodaXExtensionAPI) {
     api.registerTool({ name: 'read_pdf', ... });
   }
   ```

2. Add a sidecar client.

   Prefer HTTP when an endpoint is configured:

   ```text
   READ_PDF_ENDPOINT=http://127.0.0.1:8765
   ```

   Fall back to CLI:

   ```text
   read_pdf read <path> --pages <range> --engine <engine> --format agent-json
   ```

3. Keep the first tool schema small.

   Proposed input:

   ```json
   {
     "path": "C:/docs/file.pdf",
     "pages": "1-3,7",
     "force_ocr": false,
     "max_pages": 20,
     "engine": "auto"
   }
   ```

4. Format sidecar JSON into markdown.

   The model should receive page-marked text, source labels, selected backend, and warnings. Avoid returning raw huge JSON unless the user explicitly needs diagnostics.

5. Add tests.

   Minimum extension tests:

   - registers `read_pdf` when loaded.
   - returns a helpful error when sidecar is unavailable.
   - formats a text-layer JSON fixture into page-marked markdown.
   - formats an OCR-needed JSON fixture with warnings.
   - passes `engine` through to the sidecar request.
   - formats a MinerU-shaped JSON fixture.
   - validates missing `path` and bad `pages` input.

6. Optional KodaX core follow-up, after extension MVP works.

   Patch KodaX built-in `read` so `.pdf` returns a specific hint instead of generic binary unsupported:

   ```text
   PDF file detected. Load the read_pdf extension and call read_pdf for text extraction/OCR.
   ```

## Acceptance Criteria

- Running KodaX with `--extension <extensions/read_pdf>` makes `read_pdf` visible to the model.
- `read_pdf` can read a normal text-layer PDF through the sidecar and returns page-marked text.
- An image-only PDF without OCR configured returns a clear `needs_ocr` warning, not a generic failure.
- `engine=mineru` is passed through to the sidecar; the KodaX extension does not import MinerU.
- If the sidecar is missing, the tool returns actionable setup guidance.
- No heavy OCR/PDF dependencies are added to KodaX core.
- No cloud OCR is used unless explicitly configured in the sidecar.

## Recommended First Manual Test

```bash
kodax --extension C:/Works/GitWorks/KodaX-author/KodaX-Extensions/extensions/read_pdf "Read pages 1-2 of C:/tmp/sample.pdf"
```

Expected behavior:

- The model calls `read_pdf`.
- The tool returns page-marked text or a clear setup/needs-OCR warning.
- The final assistant response summarizes the PDF content using that text.

## Risks

- Extension helper `api.exec` intentionally strips most environment variables. If sidecar OCR needs API keys, prefer daemon mode or explicit sidecar config rather than relying on inherited KodaX process env.
- Whole-page OCR on large PDFs can be slow and expensive. Enforce page caps.
- OCR confidence is backend-dependent. Do not promise reliable confidence unless the backend provides it.
- MinerU can be resource-heavy. It must be optional and invoked through the sidecar only.
- KodaX OpenAI-compatible providers may not accept image blocks inside tool results. Always return extracted text as the primary output.

## Next Owner Checklist

Decisions are now resolved — see [PLAN.md](PLAN.md) for the authoritative plan.

- [x] Decide whether the sidecar starts as CLI-only or HTTP-first. → CLI-first via `uv` or a
      bundled binary; HTTP endpoint preferred when `READ_PDF_ENDPOINT` is set; daemon deferred.
- [x] Decide the first `engine=auto` routing rules. → text layer first, RapidOCR fallback on
      low-density pages; MinerU/NoteEditor-lite return actionable "not configured" errors in v1.
- [x] Decide distribution format. → ship compiled `extension.mjs` (not `.ts`) because KodaX is a
      `bun build --compile` exe without `tsx` at runtime. `extension.ts` is dev source.
- [x] Decide OCR backend. → RapidOCR (`rapidocr-onnxruntime`), pure-pip, no large model.
- [x] Decide air-gapped delivery. → PyInstaller `--onedir` self-contained bundle (own interpreter
      + deps + models), built on a connected machine, carried into the intranet. Zero dependency.
- [x] Create root `extension.ts`.
- [x] Create `src/sidecar-client.ts`.
- [x] Create `src/format-result.ts`.
- [x] Add local fixtures for sidecar JSON output, including a MinerU-shaped result.
- [x] Add extension tests.
- [x] Dogfood through `kodax --extension C:/Works/GitWorks/KodaX-author/KodaX-Extensions/extensions/read_pdf ...`.
      Verified with KodaX 0.7.53 (npm-linked, runs via tsx): the extension activates
      ("read_pdf extension activated"), the model calls `read_pdf`, and it returns page-marked
      text for C:/tmp/sample.pdf. The compiled-binary (.mjs) path is still unvalidated — see below.
- [x] Build and validate the air-gapped PyInstaller bundle on a connected Windows machine.
      Built `kodax.exe` (bun --compile), `extension.mjs` (esbuild), and the sidecar onedir
      (PyInstaller). Validated the full zero-dependency chain: `kodax.exe` loads `extension.mjs`,
      which runs the bundled `read_pdf.exe` (own Python + RapidOCR models) — no uv, no Python, no
      network. Both text-layer and forced-OCR paths confirmed. The packed bundle from
      `pack-offline.mjs` was driven successfully through `kodax.exe`.
      Fix found during this validation: on Windows, `api.exec` uses PowerShell, so a bundled-binary
      command must use the `&` call operator (a leading quoted path is otherwise a string literal).
      Handled in `src/sidecar-client.ts` (`executableInvocation`) with test coverage.
- [ ] Only after dogfood, consider a tiny KodaX core patch for `.pdf` read hints.
