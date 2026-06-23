# Adding an OCR backend to read_pdf

This guide shows how to plug a new OCR/VLM backend into the `read_pdf` sidecar so
you can select it live with `engine=<your-name>` — **without changing the KodaX
extension (TypeScript) layer at all**. The `engine` argument is forwarded verbatim
from the tool to the sidecar, where it is resolved against a backend registry.

- Built-in backend: **RapidOCR** (`rapidocr`), used for `engine=auto` fallback and `engine=ocr`.
- Reserved for v2: `mineru`, `noteeditor-lite` (calling them returns an actionable error
  until you register a backend under that name).

## How engine routing works

| `engine` | Behavior |
|----------|----------|
| `auto` (default) | Text layer first; only low-text pages go to the **default** OCR backend (`rapidocr`). |
| `text` | Text layer only; never OCRs (unless `force_ocr`). |
| `ocr` | OCR **every** requested page with the default backend. |
| `<registered name>` | OCR every requested page with **that** backend. |
| unregistered name | `ok:false` error listing available engines. |

`force_ocr: true` forces OCR-all using the selected backend.

## The backend contract

A backend is any object implementing this protocol ([ocr.py](ocr.py)):

```python
from typing import Protocol, runtime_checkable
import fitz  # PyMuPDF

@runtime_checkable
class OCRBackend(Protocol):
    def is_available(self) -> bool: ...
    def recognize_page(self, page: "fitz.Page") -> str: ...
```

- `is_available()` — cheap probe (e.g. "is the dependency importable / endpoint reachable").
  Return `False` to make pages fall back to a `needs_ocr` warning instead of crashing.
- `recognize_page(page)` — receive a `fitz.Page`, return the recognized text (UTF-8).
  Rasterize the page yourself, or use the helpers in `ocr.py`:
  - `render_page_png(page, dpi=200) -> bytes`
  - `render_page_png_base64(page, dpi=200) -> str`  (ready for VLM/HTTP image payloads)

Per-page exceptions are caught by the pipeline and isolated, so one bad page never fails the document.

## Add a backend in 3 steps

### Step 1 — write the backend module

Create `engines/<name>.py` and register it at import time. Example: a VLM/OCR backend
that talks to an OpenAI-compatible vision endpoint (vLLM, Ollama's OpenAI shim, etc.):

```python
# engines/vlm_ocr.py
from __future__ import annotations
import os
import fitz

from .ocr import OCRBackend, register_backend, render_page_png_base64

class VlmOcrBackend:
    """OCR via an OpenAI-compatible vision chat endpoint."""

    def __init__(self) -> None:
        self._base = os.environ.get("READ_PDF_VLM_URL", "http://127.0.0.1:8000/v1")
        self._model = os.environ.get("READ_PDF_VLM_MODEL", "glm-ocr")
        self._key = os.environ.get("READ_PDF_VLM_KEY", "")

    def is_available(self) -> bool:
        try:
            import httpx  # noqa: F401
        except Exception:
            return False
        return bool(self._base)

    def recognize_page(self, page: "fitz.Page") -> str:
        import httpx

        image_b64 = render_page_png_base64(page)
        payload = {
            "model": self._model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Transcribe all text in this image. Output text only."},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                ],
            }],
            "temperature": 0,
        }
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        resp = httpx.post(f"{self._base}/chat/completions", json=payload,
                          headers=headers, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

# Register under an engine name (use it as engine="vlm").
register_backend("vlm", VlmOcrBackend)
```

A cloud OCR API backend looks the same — read the key from an env var, call the
provider, return text. Keep cloud backends **opt-in**: only call out when explicitly
selected, never by default.

### Step 2 — load it

Add one import line to [`engines/__init__.py`](__init__.py) so the registration runs:

```python
from . import vlm_ocr  # noqa: F401
```

That's it on the code side. `engine=vlm` now works; the TS layer needs no change.

### Step 3 — declare dependencies & rebuild

- Add any pip deps to [`../pyproject.toml`](../pyproject.toml) and refresh the lock:
  ```bash
  uv lock --project extensions/read_pdf/sidecar
  ```
- **Connected machines:** nothing else to do — `uv run` picks up your edited code and
  new deps on the next call.
- **Air-gapped bundle:** rebuild the sidecar binary so the new backend + deps + any
  models are embedded, then re-pack:
  ```bash
  node scripts/build-sidecar.mjs
  node scripts/pack-offline.mjs
  ```
  If your backend lazy-imports a package or ships data files, add the matching
  `--hidden-import <pkg>` or `--collect-all <pkg>` flags in
  [`scripts/build-sidecar.mjs`](../../../../scripts/build-sidecar.mjs).

## Test it

```bash
# Direct CLI (fastest feedback loop)
uv run --project extensions/read_pdf/sidecar read_pdf read C:/tmp/sample.pdf --engine vlm --format agent-json

# Through KodaX
kodax --extension <repo>/extensions/read_pdf "Read C:/tmp/scan.pdf with engine vlm"
```

## Important: environment variables and how KodaX spawns the sidecar

KodaX's `api.exec` **strips most environment variables** before running a command. So a
backend that needs an API key (cloud OCR, remote VLM) will **not** see `READ_PDF_VLM_KEY`
when KodaX spawns the sidecar as a one-shot CLI. Options:

1. **Daemon mode (recommended for keyed backends):** start the sidecar HTTP server in a
   shell where the env vars are set, then point the extension at it with
   `READ_PDF_ENDPOINT=http://127.0.0.1:8765`. The long-lived server keeps the env.
2. **Local, keyless backends** (Ollama/vLLM on localhost) work fine via the CLI path.

This is also why cloud OCR is never the default: it requires deliberate configuration.

## Note on whole-document parsers (MinerU etc.)

The `OCRBackend` protocol is **per-page**. Document parsers like MinerU work on the whole
file and emit Markdown/JSON for the entire document. They don't fit `recognize_page` cleanly
and need a separate document-level hook — that is planned for v2. If you only need text
recognition, the per-page protocol above is the right extension point today.
