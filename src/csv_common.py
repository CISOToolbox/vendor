# -----------------------------------------------------------------------------
# REPLICATED from the private shared repository (shared/python/csv_common.py).
# DO NOT EDIT HERE - changes will be overwritten by the next propagation run.
# Fix the master in the shared repository and re-propagate. See CONTRIBUTING.md.
# -----------------------------------------------------------------------------
"""Spreadsheet formula-injection neutralisation for generated exports.

Shared by every module that generates a CSV or XLSX download. This file is
copied verbatim to ``<module>/src/csv_common.py`` — keep every copy
byte-identical.

When a spreadsheet application (Excel, LibreOffice, Google Sheets) opens a
CSV, a cell whose text starts with ``=``, ``+``, ``-``, ``@``, a tab or a
carriage return is treated as a *formula*, not as text. A user who types
``=cmd|'/c calc'!A1`` into any field therefore gets code execution on the
machine of whoever opens the export. This is CSV formula injection.

The standard neutralisation (OWASP) is to prefix the cell with a single
quote, which spreadsheets consume as a "this is text" marker.

Rule applied here
-----------------
A value is prefixed with ``'`` when, and only when:

1. it is a string (numbers passed as ``int``/``float`` are never touched), and
2. its first character is one of ``= + - @ TAB CR``, and
3. it does not parse as a plain number.

Condition 3 is what keeps ``-42``, ``-3.5``, ``+1e3`` and the French
``-1 234,56`` intact: a negative amount is not a formula and must stay
usable in the spreadsheet. Anything else starting with a dangerous
character — including ``-cmd``, ``=SUM(A1)``, ``@import`` and ``-2024-01-01``
— is quoted.

Visible consequence: the exported file literally contains ``'=foo`` where it
used to contain ``=foo``. A text editor shows the leading apostrophe;
Excel/LibreOffice do not display it, they read it as a text marker.

XLSX (openpyxl)
---------------
The *decision* rule above is shared with the XLSX exports, but the way a
cell is neutralised differs, because CSV and XLSX do not carry formulas the
same way.

In an ``.xlsx`` file the formula is explicit markup: openpyxl's value setter
turns any string starting with ``=`` into ``data_type == "f"`` and writes an
``<f>`` element, which Excel *evaluates*. Strings starting with ``+``, ``-``
or ``@`` stay ``inlineStr`` and are never re-parsed as formulas on open, so
``=`` is the only character that is actually live in XLSX — the wider set is
still matched here so that a workbook later re-saved as CSV is safe too.

Prefixing an apostrophe would be *wrong* for XLSX: unlike CSV, the leading
quote is not a marker there, it becomes part of the string and Excel shows
it. ``-42`` would be exported as ``'-42`` and the DORA register would stop
matching the EBA validators. So :func:`xlsx_safe_cell` instead:

* forces ``data_type = "s"`` — the cell is written as text, the formula is
  never evaluated, and the value is preserved **byte for byte**, and
* sets ``quotePrefix = True`` — the OOXML style flag that is the native
  encoding of the CSV apostrophe: Excel displays the text unchanged and
  remembers "this was deliberately stored as text".

No openpyxl import is needed here: the helpers only touch ``value``,
``data_type`` and ``quotePrefix`` on the cell objects handed to them.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Leading characters a spreadsheet may interpret as the start of a formula
# (or that let an attacker smuggle one past a naive filter).
DANGEROUS_PREFIXES: tuple[str, ...] = ("=", "+", "-", "@", "\t", "\r")

# Escape character consumed by spreadsheets as "the rest is literal text".
ESCAPE_PREFIX = "'"

# ``-1 234,56`` / ``-1234,56`` — French formatting that ``float()`` rejects.
# Space, non-breaking space and narrow non-breaking space are all accepted as
# thousands separators.
_FR_NUMBER_RE = re.compile(r"^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})*(?:,\d+)?$")


def _is_number(text: str) -> bool:
    """True if ``text`` is a plain number and therefore harmless as a cell."""
    stripped = text.strip()
    if not stripped:
        return False
    try:
        float(stripped)
        return True
    except ValueError:
        pass
    return bool(_FR_NUMBER_RE.match(stripped))


def is_formula_like(value: Any) -> bool:
    """True if a spreadsheet could read ``value`` as a formula rather than text.

    Single source of truth for the CSV and the XLSX exports, so both formats
    agree on *which* values are dangerous even though they neutralise them
    differently.

    Args:
        value: The cell value about to be written.

    Returns:
        ``True`` for a string starting with a formula character that is not a
        plain number; ``False`` for everything else (numbers, ``None``,
        ``bool``, empty strings, harmless text).
    """
    if not isinstance(value, str):
        return False
    if not value or value[0] not in DANGEROUS_PREFIXES:
        return False
    return not _is_number(value)


def csv_safe_cell(value: Any) -> Any:
    """Neutralise a single cell against CSV formula injection.

    Non-string values (``int``, ``float``, ``None``…) are returned unchanged
    apart from ``None`` becoming an empty string, since the ``csv`` module
    already renders them unambiguously and they cannot carry a formula.

    Args:
        value: The cell value about to be written.

    Returns:
        The value, prefixed with ``'`` if it could be read as a formula.
    """
    if value is None:
        return ""
    if not is_formula_like(value):
        return value
    return ESCAPE_PREFIX + value


def csv_safe_row(values: Iterable[Any]) -> list:
    """Apply :func:`csv_safe_cell` to every cell of a row."""
    return [csv_safe_cell(v) for v in values]


def xlsx_safe_cell(cell: Any) -> Any:
    """Neutralise one openpyxl cell in place, keeping its value untouched.

    See the module docstring for why XLSX gets a different treatment from
    CSV. A cell whose value could be read as a formula is forced to the
    string data type and flagged ``quotePrefix``; every other cell — numbers,
    dates, empty cells, ordinary text — is left strictly alone, styles
    included.

    Args:
        cell: An ``openpyxl.cell.cell.Cell`` (duck-typed: anything exposing
            ``value``, ``data_type`` and ``quotePrefix``).

    Returns:
        The same cell, for chaining.
    """
    if is_formula_like(cell.value):
        # Order matters: assigning ``value`` would re-run openpyxl's type
        # inference and set ``data_type`` back to "f".
        cell.data_type = "s"
        cell.quotePrefix = True
    return cell


def xlsx_safe_workbook(workbook: Any) -> Any:
    """Neutralise every cell of every sheet of an openpyxl workbook.

    Meant to be called once, just before ``workbook.save(...)``: a single
    chokepoint means a sheet added later cannot silently reintroduce the
    injection. Cells the exporter wrote as genuine formulas would be
    downgraded to text, so do not use this on workbooks that compute
    anything — none of ours do.

    Args:
        workbook: An ``openpyxl.Workbook``.

    Returns:
        The same workbook, for chaining.
    """
    for worksheet in workbook.worksheets:
        for row in worksheet.iter_rows():
            for cell in row:
                xlsx_safe_cell(cell)
    return workbook


__all__ = [
    "DANGEROUS_PREFIXES",
    "ESCAPE_PREFIX",
    "csv_safe_cell",
    "csv_safe_row",
    "is_formula_like",
    "xlsx_safe_cell",
    "xlsx_safe_workbook",
]
