"""read_pdf sidecar CLI.

Usage:
    read_pdf read <path> [--pages 1-3,7] [--engine auto] [--force-ocr] [--max-pages N] [--format agent-json]
    read_pdf inspect <path> [--format json]

Always prints a single JSON object to stdout. Known/handled failures are reported
as {"ok": false, "error": ...} with exit code 0 so the extension can parse them;
only unexpected crashes exit non-zero.
"""

from __future__ import annotations

import argparse
import sys

from .models import ReadResult
from .pipeline import ENGINE_LABEL, read_pdf, text_layer


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="read_pdf", description="Extract PDF text for agents.")
    sub = parser.add_subparsers(dest="command", required=True)

    read_cmd = sub.add_parser("read", help="Extract page-marked text from a PDF.")
    read_cmd.add_argument("path", help="PDF file path.")
    read_cmd.add_argument("--pages", default=None, help='1-based page range, e.g. "1-3,7".')
    read_cmd.add_argument(
        "--engine",
        default="auto",
        choices=["auto", "text", "ocr", "mineru", "noteeditor-lite"],
        help="Engine hint.",
    )
    read_cmd.add_argument("--force-ocr", action="store_true", help="OCR even if a text layer exists.")
    read_cmd.add_argument("--max-pages", type=int, default=None, help="Safety cap on pages processed.")
    read_cmd.add_argument(
        "--format", default="agent-json", choices=["agent-json", "json"], help="Output format."
    )

    inspect_cmd = sub.add_parser("inspect", help="Report basic PDF metadata.")
    inspect_cmd.add_argument("path", help="PDF file path.")
    inspect_cmd.add_argument("--format", default="json", choices=["json"], help="Output format.")

    return parser


def _cmd_read(args: argparse.Namespace) -> int:
    result = read_pdf(
        args.path,
        pages=args.pages,
        engine=args.engine,
        force_ocr=args.force_ocr,
        max_pages=args.max_pages,
    )
    print(result.to_json())
    return 0


def _cmd_inspect(args: argparse.Namespace) -> int:
    import json
    import os

    if not os.path.isfile(args.path):
        print(ReadResult.failure(args.path, ENGINE_LABEL, f"file not found: {args.path}").to_json())
        return 0
    try:
        doc = text_layer.open_document(args.path)
    except Exception as exc:  # noqa: BLE001
        print(ReadResult.failure(args.path, ENGINE_LABEL, f"could not open PDF: {exc}").to_json())
        return 0
    try:
        info = {
            "ok": True,
            "file": args.path,
            "page_count": text_layer.page_count(doc),
            "engine": ENGINE_LABEL,
        }
    finally:
        doc.close()
    print(json.dumps(info, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "read":
        return _cmd_read(args)
    if args.command == "inspect":
        return _cmd_inspect(args)
    parser.error(f"unknown command: {args.command}")  # raises SystemExit(2)


if __name__ == "__main__":
    sys.exit(main())
