"""PyInstaller entry launcher.

PyInstaller runs its entry script as ``__main__`` with no package context, which
breaks the relative imports inside ``read_pdf.cli``. Importing the package here
(absolute import) keeps those relative imports valid in the frozen binary.

For normal use prefer the console script (``read_pdf``) or ``python -m read_pdf.cli``.
"""

import sys

from read_pdf.cli import main

if __name__ == "__main__":
    sys.exit(main())
