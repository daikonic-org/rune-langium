#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Optional decimal-rounding differential check against the handwritten CDM Java implementation."""

import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from lib.java_reference_oracle import verified_classpath

root = Path(__file__).resolve().parent.parent
directory = root / "test/fixtures/third-party/cdm-rounding"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((directory / "java-oracle.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases_text = (directory / "cases.json").read_text()
cases = json.loads(cases_text, parse_float=Decimal)
result = subprocess.run(
    [os.environ.get("JAVA_BINARY", "java"), "--class-path", classpath,
     str(root / "scripts/fixtures/RoundingOracle.java")],
    input=cases_text, text=True, capture_output=True, timeout=60,
)
if result.returncode:
    raise SystemExit(result.stderr)
expected = [
    {"id": case["id"], "error": case["error"]} if "error" in case else
    {"id": case["id"], "value": Decimal(case["referenceValue"]) if "referenceValue" in case else case["expected"],
     "scale": case["referenceScale"]}
    for case in cases
]
actual_results = json.loads(result.stdout, parse_float=Decimal)
if actual_results != expected:
    for actual, pinned in zip(actual_results, expected):
        if actual != pinned:
            print(f"{pinned['id']}: expected {pinned}, actual {actual}", file=sys.stderr)
    raise SystemExit("CDM rounding oracle differs from the pinned numeric results or reference scales")
print(f"Verified {len(cases)} rounding cases and Java scales against CDM 7.9.0 on the JVM.")
