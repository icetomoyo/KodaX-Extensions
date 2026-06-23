"""Text-layer extraction via PyMuPDF. Zero AI inference; the cheapest reliable path."""

from __future__ import annotations

import fitz  # PyMuPDF

# A page with fewer than this many non-whitespace characters in its text layer is
# treated as "needs OCR" under engine=auto.
MIN_TEXT_CHARS = 10


def open_document(path: str) -> fitz.Document:
    """Open a PDF. Raises if the file is missing or not a valid PDF."""
    return fitz.open(path)


def page_count(doc: fitz.Document) -> int:
    return doc.page_count


def extract_page_text(doc: fitz.Document, page_number: int) -> str:
    """Extract the text layer for a 1-based page number."""
    page = doc[page_number - 1]
    return page.get_text("text").strip()


def has_sufficient_text(text: str, min_chars: int = MIN_TEXT_CHARS) -> bool:
    """Heuristic: is the text layer dense enough to skip OCR?"""
    return len("".join(text.split())) >= min_chars
