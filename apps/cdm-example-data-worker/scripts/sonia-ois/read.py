# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""One bounded XLSX decoder for CI acquisition and offline archive replay."""
import argparse
import base64
from datetime import date, datetime, timezone
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZipFile

from openpyxl import load_workbook

BASE = "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/"
URLS = {"latest": BASE + "latest-yield-curve-data.zip", "archive": BASE + "oisddata.zip"}
SHEETS = {
    "1. fwds, short end": ("instantaneous-forward", "monthly"),
    "2. fwd curve": ("instantaneous-forward", "semiannual"),
    "3. spot, short end": ("spot", "monthly"),
    "4. spot curve": ("spot", "semiannual"),
}
MAX_ARCHIVE = 16 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_POINTS = 100000


def checked_zip(content):
    archive = ZipFile(BytesIO(content))
    entries = archive.infolist()
    if len(entries) > 1000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
        raise ValueError("Archive exceeds decoding bounds")
    if len({entry.filename for entry in entries}) != len(entries):
        raise ValueError("Duplicate archive entries")
    return archive


def workbook_points(content, name, start, end):
    with checked_zip(content):
        pass
    book = load_workbook(BytesIO(content), read_only=True, data_only=True, keep_links=False)
    result = []
    try:
        if not set(SHEETS).issubset(book.sheetnames) or book["info"].cell(1, 1).value != "Bank of England UK OIS curve data":
            raise ValueError("Unexpected BoE OIS workbook identity/sheets")
        for sheet_name, (kind, grid) in SHEETS.items():
            sheet = book[sheet_name]
            if sheet.max_row > 10000 or sheet.max_column > 400:
                raise ValueError("Workbook exceeds row/column bounds")
            rows = sheet.iter_rows(values_only=True)
            header = [next(rows) for _ in range(4)]
            if header[3][0] != "years:":
                raise ValueError("Expected maturity years header")
            maturities = []
            previous = 0
            for column, years in enumerate(header[3][1:], start=1):
                if years is None:
                    continue
                if isinstance(years, bool) or not isinstance(years, (float, int)):
                    raise ValueError("Invalid maturity")
                months = round(years * 12)
                if months <= previous or months > 600 or abs(years * 12 - months) > 0.000001:
                    raise ValueError("Non-increasing/non-monthly maturity grid")
                previous = months
                maturities.append((column, months, format(Decimal(str(years)), "f")))
            if not maturities:
                raise ValueError("Empty maturity grid")
            seen = set()
            for row in rows:
                stamp = row[0]
                if stamp == "Refresh" and all(value in (None, "Refresh") for value in row):
                    continue
                if stamp is None or stamp == "#VALUE!":
                    if any(value is not None for value in row[1:]):
                        raise ValueError("Values without an as-of date")
                    continue
                if not isinstance(stamp, datetime) or stamp.time() != datetime.min.time():
                    raise ValueError("Invalid as-of date")
                as_of = stamp.date().isoformat()
                if as_of in seen:
                    raise ValueError("Duplicate as-of row")
                seen.add(as_of)
                if not start <= as_of <= end:
                    continue
                for column, months, years in maturities:
                    value = row[column]
                    if value is None:
                        continue  # Unpublished nodes stay absent, never filled.
                    if isinstance(value, bool) or not isinstance(value, (int, float)):
                        raise ValueError("Non-numeric published curve point")
                    number = Decimal(str(value))
                    if not number.is_finite():
                        raise ValueError("Non-finite curve point")
                    result.append({"date": as_of, "kind": kind, "grid": grid, "maturityMonths": months,
                                   "maturityYears": years, "sourceValue": format(number, "f"), "workbook": name})
                    if len(result) > MAX_POINTS:
                        raise ValueError("Too many curve points")
    finally:
        book.close()
    return result


def decode(content, start, end, source, retrieved_at):
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last or (last - first).days >= 366 or len(content) > MAX_ARCHIVE:
        raise ValueError("Invalid bounded acquisition window/archive")
    points, books = [], []
    with checked_zip(content) as archive:
        for entry in archive.infolist():
            name = entry.filename
            # Select OIS workbooks only; preserve their exact archive entry identity.
            if not re.fullmatch(r"OIS daily data(?: current month|_[0-9]{4} to (?:[0-9]{4}|present))\.xlsx", name):
                continue
            years = re.fullmatch(r"OIS daily data_([0-9]{4}) to ([0-9]{4}|present)\.xlsx", name)
            if years and (int(years[1]) > last.year or (years[2] != "present" and int(years[2]) < first.year)):
                continue
            data = archive.read(entry)
            rows = workbook_points(data, name, start, end)
            points.extend(rows)
            books.append({"name": name, "sha256": sha256(data).hexdigest()})
    if not books:
        raise ValueError("No OIS curve data for the requested window")
    if len(points) > MAX_POINTS:
        raise ValueError("Too many curve points")
    points.sort(key=lambda p: (p["date"], p["kind"], p["grid"], p["maturityMonths"]))
    keys = [(p["date"], p["kind"], p["grid"], p["maturityMonths"]) for p in points]
    if len(set(keys)) != len(keys):
        raise ValueError("Overlapping workbook data")
    return {"snapshot": {"schemaVersion": 1, "series": "sonia-ois", "decoder": "boe-ois-xlsx-v1",
             "window": {"startDate": start, "endDate": end},
             "source": {"url": URLS[source], "sha256": sha256(content).hexdigest(), "retrievedAt": retrieved_at,
                        "workbooks": sorted(books, key=lambda b: b["name"])}, "points": points},
            "archiveBase64": base64.b64encode(content).decode("ascii")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--source", choices=URLS, default="latest")
    parser.add_argument("--archive", required=True, type=Path, help="Decode exact source bytes acquired by the catalog transport")
    parser.add_argument("--retrieved-at", required=True, help="Original source capture timestamp")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Archive too large")
    content = args.archive.read_bytes()
    acquired = decode(content, args.start, args.end, args.source,
                      args.retrieved_at or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as output:
        json.dump(acquired, output, separators=(",", ":"), allow_nan=False)
        output.write("\n")


if __name__ == "__main__":
    main()
