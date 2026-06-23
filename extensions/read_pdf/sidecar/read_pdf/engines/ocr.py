"""OCR fallback behind a pluggable backend protocol.

v1 ships a single RapidOCR backend (pure-pip, CPU, strong CJK). v2 can add
VLM/MinerU/NoteEditor-lite backends implementing the same OCRBackend protocol.
All heavy imports are lazy so text-layer-only runs never touch onnxruntime.
"""

from __future__ import annotations

from typing import Callable, Protocol, runtime_checkable

import fitz  # PyMuPDF

# DPI to rasterize a page before OCR. Higher = more accurate but slower/larger.
OCR_RENDER_DPI = 200


@runtime_checkable
class OCRBackend(Protocol):
    """A backend that turns a rendered page image into text."""

    def is_available(self) -> bool: ...

    def recognize_page(self, page: "fitz.Page") -> str: ...


def render_page_png(page: "fitz.Page", dpi: int = OCR_RENDER_DPI) -> bytes:
    """Rasterize a PDF page to PNG bytes. Convenience for image-API backends."""
    return page.get_pixmap(dpi=dpi).tobytes("png")


def render_page_png_base64(page: "fitz.Page", dpi: int = OCR_RENDER_DPI) -> str:
    """Rasterize a PDF page to a base64-encoded PNG string (e.g. for VLM/HTTP backends)."""
    import base64

    return base64.b64encode(render_page_png(page, dpi)).decode("ascii")


class RapidOcrBackend:
    """RapidOCR (onnxruntime) backend. Lazily initialized on first use."""

    def __init__(self, dpi: int = OCR_RENDER_DPI) -> None:
        self._dpi = dpi
        self._engine = None  # type: ignore[var-annotated]

    def is_available(self) -> bool:
        try:
            import rapidocr_onnxruntime  # noqa: F401
        except Exception:
            return False
        return True

    def _ensure_engine(self) -> None:
        if self._engine is None:
            from rapidocr_onnxruntime import RapidOCR

            self._engine = RapidOCR()

    def recognize_page(self, page: "fitz.Page") -> str:
        import numpy as np

        self._ensure_engine()
        pixmap = page.get_pixmap(dpi=self._dpi)
        image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
            pixmap.height, pixmap.width, pixmap.n
        )
        if pixmap.n == 4:  # drop alpha
            image = image[:, :, :3]
        elif pixmap.n == 1:  # grayscale -> 3 channels
            image = np.repeat(image, 3, axis=2)

        result, _ = self._engine(image)  # type: ignore[misc]
        if not result:
            return ""
        # RapidOCR returns [[box, text, score], ...]; join recognized lines.
        return "\n".join(line[1] for line in result).strip()


# --------------------------------------------------------------------------- #
# Backend registry
#
# Add a new OCR/VLM backend by registering a factory under an engine name. The
# `engine` argument from the tool then selects it directly. See engines/README.md.
# --------------------------------------------------------------------------- #

# The backend used for engine="auto" fallback and engine="ocr".
DEFAULT_OCR_ENGINE = "rapidocr"

_BACKEND_FACTORIES: dict[str, Callable[[], OCRBackend]] = {}


def register_backend(name: str, factory: Callable[[], OCRBackend]) -> None:
    """Register an OCR backend factory under an engine name (case-insensitive)."""
    _BACKEND_FACTORIES[name.strip().lower()] = factory


def create_backend(name: str) -> OCRBackend | None:
    """Instantiate a registered backend by name, or None if not registered."""
    factory = _BACKEND_FACTORIES.get(name.strip().lower())
    return factory() if factory else None


def registered_engines() -> list[str]:
    """Names of all registered OCR backends, sorted."""
    return sorted(_BACKEND_FACTORIES)


def default_backend() -> OCRBackend:
    """The default OCR backend (used for auto fallback and engine="ocr")."""
    backend = create_backend(DEFAULT_OCR_ENGINE)
    if backend is None:  # pragma: no cover - default is always registered below
        raise RuntimeError(f"default OCR engine '{DEFAULT_OCR_ENGINE}' is not registered")
    return backend


# Built-in backend. Third-party backends call register_backend(...) at import time.
register_backend("rapidocr", RapidOcrBackend)
