# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
from datetime import datetime
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import unittest
from openpyxl import Workbook
import read as reader


def fixture(edit=None, name="OIS daily data current month.xlsx"):
    book = Workbook()
    book.active.title = "info"
    book.active.cell(1, 1, "Bank of England UK OIS curve data")
    for title, (kind, grid) in reader.SHEETS.items():
        sheet = book.create_sheet(title)
        sheet.cell(4, 1, "years:")
        sheet.cell(4, 2, 1 / 12 if grid == "monthly" else 0.5)
        sheet.cell(4, 3, 1)
        sheet.cell(5, 1, "Refresh")
        sheet.cell(5, 2, "Refresh")
        sheet.cell(6, 1, datetime(2026, 11, 6))
        sheet.cell(6, 2, 4.25)
        sheet.cell(6, 3, 4.5 if grid == "monthly" else 4.51)
        sheet.cell(7, 1, datetime(2026, 11, 7))  # All unpublished cells remain absent.
    if edit:
        edit(book)
    data = BytesIO()
    book.save(data)
    archive = BytesIO()
    with ZipFile(archive, "w", ZIP_DEFLATED) as zipped:
        zipped.writestr(name, data.getvalue())
    return archive.getvalue()


def decode(content):
    return reader.decode(content, "2026-11-06", "2026-11-09", "latest", "2026-11-14T00:00:00.000Z")


class ReaderTests(unittest.TestCase):
    def test_retains_overlapping_grids_and_missing_nodes(self):
        result = decode(fixture())
        points = result["snapshot"]["points"]
        self.assertEqual(len(points), 8)
        self.assertEqual({p["date"] for p in points}, {"2026-11-06"})
        self.assertEqual({p["sourceValue"] for p in points if p["maturityMonths"] == 12}, {"4.5", "4.51"})
        self.assertEqual(len(result["snapshot"]["source"]["sha256"]), 64)

    def test_archived_workbook_name_and_refresh_rows(self):
        self.assertEqual(len(decode(fixture(name="OIS daily data_2025 to present.xlsx"))["snapshot"]["points"]), 8)

    def test_rejects_wrong_curve_identity(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            decode(fixture(lambda b: setattr(b["info"].cell(1, 1), "value", "Government nominal curve")))

    def test_rejects_unrecognized_maturity_header(self):
        with self.assertRaisesRegex(ValueError, "maturity"):
            decode(fixture(lambda b: setattr(b["3. spot, short end"].cell(4, 1), "value", "days:")))

    def test_rejects_nonnumeric_values_in_dated_rows(self):
        with self.assertRaisesRegex(ValueError, "Non-numeric"):
            decode(fixture(lambda b: setattr(b["4. spot curve"].cell(6, 2), "value", "#N/A")))

    def test_rejects_duplicate_or_unordered_maturities(self):
        with self.assertRaisesRegex(ValueError, "maturity"):
            decode(fixture(lambda b: setattr(b["4. spot curve"].cell(4, 3), "value", 0.5)))

    def test_rejects_duplicate_asof_rows(self):
        with self.assertRaisesRegex(ValueError, "Duplicate as-of"):
            decode(fixture(lambda b: setattr(b["4. spot curve"].cell(7, 1), "value", datetime(2026, 11, 6))))

    def test_empty_window_retains_source_identity_without_inventing_nodes(self):
        result = reader.decode(fixture(), "2026-11-08", "2026-11-09", "latest", "2026-11-14T00:00:00.000Z")
        self.assertEqual(result["snapshot"]["points"], [])
        self.assertEqual(len(result["snapshot"]["source"]["workbooks"]), 1)

    def test_rejects_unbounded_windows(self):
        with self.assertRaisesRegex(ValueError, "window"):
            reader.decode(fixture(), "2024-01-01", "2026-11-09", "latest", "2026-11-14T00:00:00.000Z")


if __name__ == "__main__":
    unittest.main()
