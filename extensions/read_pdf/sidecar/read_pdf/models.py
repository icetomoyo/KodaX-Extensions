"""Data models for the read_pdf sidecar JSON contract."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field


@dataclass
class PageResult:
    """One page of extracted text."""

    page: int
    source: str  # "text-layer" | "ocr" | ...
    text: str
    warnings: list[str] = field(default_factory=list)


@dataclass
class ReadResult:
    """The full sidecar result. Serializes to the JSON contract consumed by the extension."""

    ok: bool
    file: str
    page_count: int
    engine: str
    selected_backend: str
    mode: str  # "text" | "ocr" | "mixed"
    pages: list[PageResult] = field(default_factory=list)
    needs_ocr: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def failure(cls, file: str, engine: str, message: str) -> "ReadResult":
        return cls(
            ok=False,
            file=file,
            page_count=0,
            engine=engine,
            selected_backend="none",
            mode="none",
            error=message,
        )
