"""read_pdf extraction engines: text-layer first, OCR fallback.

Importing this package registers the built-in OCR backends. To add your own
backend, create a module here that calls ``ocr.register_backend(...)`` at import
time and add one import line below. See README.md in this folder.
"""

# Importing `ocr` registers the built-in RapidOCR backend.
from . import ocr  # noqa: F401

# Register third-party backends by importing their modules here, e.g.:
# from . import glm_ocr  # noqa: F401
