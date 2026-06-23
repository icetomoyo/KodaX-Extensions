"""Pipeline orchestration: validate -> text layer -> density check -> OCR fallback -> assemble."""

from __future__ import annotations

import os

from .engines import ocr as ocr_engine
from .engines import text_layer
from .models import PageResult, ReadResult

ENGINE_LABEL = "read_pdf/pymupdf"
# Built-in engine modes handled directly here. Any other engine name is looked up
# in the OCR backend registry (see engines/ocr.py and engines/README.md).
BUILTIN_ENGINES = {"auto", "text", "ocr"}


def parse_pages(spec: str | None, total: int) -> list[int]:
    """Parse a 1-based page spec like "1-3,7" into a sorted, de-duplicated, clamped list.

    None/empty means all pages. Out-of-range numbers are clamped to [1, total].
    """
    if not spec or not spec.strip():
        return list(range(1, total + 1))

    selected: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s.strip()), int(end_s.strip())
        else:
            start = end = int(part)
        for page in range(start, end + 1):
            if 1 <= page <= total:
                selected.add(page)
    return sorted(selected)


def read_pdf(
    path: str,
    *,
    pages: str | None = None,
    engine: str = "auto",
    force_ocr: bool = False,
    max_pages: int | None = None,
    backend: ocr_engine.OCRBackend | None = None,
) -> ReadResult:
    """Read a PDF into page-marked text following the JSON contract."""
    engine_l = engine.strip().lower()
    is_auto = engine_l == "auto"
    is_text = engine_l == "text"

    # Resolve which OCR backend (if any) this engine selects and whether every page
    # should be OCR'd. `text` never OCRs unless force_ocr; `ocr` and any registered
    # backend name OCR all pages; `auto` OCRs only sparse pages.
    if engine_l in BUILTIN_ENGINES:
        ocr_engine_name = ocr_engine.DEFAULT_OCR_ENGINE
        ocr_all = engine_l == "ocr" or force_ocr
    else:
        ocr_engine_name = engine_l  # a specific registered backend
        ocr_all = True

    # Resolve the OCR backend up front (config error) so an unknown engine fails fast,
    # independent of the file. Construction is cheap; models load lazily on first use.
    may_ocr = ocr_all or is_auto
    ocr_backend: ocr_engine.OCRBackend | None = None
    if may_ocr:
        ocr_backend = backend if backend is not None else ocr_engine.create_backend(ocr_engine_name)
        if ocr_backend is None:
            available = ", ".join(["auto", "text", "ocr", *ocr_engine.registered_engines()])
            return ReadResult.failure(
                path,
                ENGINE_LABEL,
                f'engine "{engine}" is not configured. Available engines: {available}. '
                f"(mineru / noteeditor-lite are reserved for v2; register a backend to enable them.)",
            )

    if not os.path.isfile(path):
        return ReadResult.failure(path, ENGINE_LABEL, f"file not found: {path}")

    try:
        doc = text_layer.open_document(path)
    except Exception as exc:  # noqa: BLE001 - surface any open/parse failure to the caller
        return ReadResult.failure(path, ENGINE_LABEL, f"could not open PDF: {exc}")

    try:
        total = text_layer.page_count(doc)
        page_numbers = parse_pages(pages, total)
        warnings: list[str] = []
        if max_pages is not None and len(page_numbers) > max_pages:
            warnings.append(
                f"page cap reached: processed {max_pages} of {len(page_numbers)} requested pages."
            )
            page_numbers = page_numbers[:max_pages]

        ocr_ready: bool | None = None  # lazily probed only when OCR is actually needed

        page_results: list[PageResult] = []
        needs_ocr: list[int] = []
        used_text = False
        used_ocr = False

        for page_number in page_numbers:
            try:
                text = text_layer.extract_page_text(doc, page_number)
            except Exception as exc:  # noqa: BLE001 - isolate per-page failures
                page_results.append(
                    PageResult(page=page_number, source="error", text="", warnings=[str(exc)])
                )
                continue

            if is_text and not ocr_all:
                want_ocr = False
            elif ocr_all:
                want_ocr = True
            else:  # auto
                want_ocr = not text_layer.has_sufficient_text(text)

            if not want_ocr or ocr_backend is None:
                used_text = True
                page_results.append(PageResult(page=page_number, source="text-layer", text=text))
                continue

            if ocr_ready is None:
                ocr_ready = ocr_backend.is_available()
            if not ocr_ready:
                needs_ocr.append(page_number)
                # Under auto, keep whatever sparse text-layer text we have.
                source = "text-layer" if is_auto else "none"
                page_results.append(
                    PageResult(
                        page=page_number,
                        source=source,
                        text=text,
                        warnings=["OCR requested but no OCR backend is available."],
                    )
                )
                continue

            try:
                ocr_text = ocr_backend.recognize_page(doc[page_number - 1])
                used_ocr = True
                page_results.append(
                    PageResult(
                        page=page_number,
                        source="ocr",
                        text=ocr_text,
                        warnings=["OCR confidence unavailable for this backend."],
                    )
                )
            except Exception as exc:  # noqa: BLE001 - isolate per-page OCR failures
                page_results.append(
                    PageResult(
                        page=page_number,
                        source="text-layer",
                        text=text,
                        warnings=[f"OCR failed, kept text layer: {exc}"],
                    )
                )

        selected_backend = _selected_backend(used_text, used_ocr, bool(needs_ocr))
        mode = _mode(used_text, used_ocr)
        return ReadResult(
            ok=True,
            file=path,
            page_count=total,
            engine=ENGINE_LABEL,
            selected_backend=selected_backend,
            mode=mode,
            pages=page_results,
            needs_ocr=needs_ocr,
            warnings=warnings,
        )
    finally:
        doc.close()


def _selected_backend(used_text: bool, used_ocr: bool, needs_ocr: bool) -> str:
    if used_ocr and used_text:
        return "text-layer+ocr"
    if used_ocr:
        return "ocr"
    if needs_ocr:
        return "text-layer (ocr unavailable)"
    return "text-layer"


def _mode(used_text: bool, used_ocr: bool) -> str:
    if used_text and used_ocr:
        return "mixed"
    if used_ocr:
        return "ocr"
    return "text"
