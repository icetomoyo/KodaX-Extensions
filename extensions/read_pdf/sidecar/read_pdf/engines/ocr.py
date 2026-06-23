"""OCR fallback behind a pluggable backend protocol.

v1 ships a single RapidOCR backend (pure-pip, CPU, strong CJK). v2 can add
VLM/MinerU/NoteEditor-lite backends implementing the same OCRBackend protocol.
All heavy imports are lazy so text-layer-only runs never touch onnxruntime.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import fitz  # PyMuPDF

# DPI to rasterize a page before OCR. Higher = more accurate but slower/larger.
OCR_RENDER_DPI = 200


@runtime_checkable
class OCRBackend(Protocol):
    """A backend that turns a rendered page image into text."""

    def is_available(self) -> bool: ...

    def recognize_page(self, page: "fitz.Page") -> str: ...


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


def default_backend() -> OCRBackend:
    return RapidOcrBackend()
