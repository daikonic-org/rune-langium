#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Compare the period range cases with the published handwritten CDM implementation."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from lib.java_reference_oracle import verified_classpath

root = Path(__file__).resolve().parent.parent
directory = root / "test/fixtures/third-party/cdm-period-range"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((directory / "java-oracle.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases_text = (directory / "cases.json").read_text()
cases = json.loads(cases_text)
result = subprocess.run(
    [os.environ.get("JAVA_BINARY", "java"), "--class-path", classpath,
     str(root / "scripts/fixtures/PeriodRangeOracle.java")],
    input=cases_text, text=True, capture_output=True, timeout=60,
)
if result.returncode:
    raise SystemExit(result.stderr)
expected = [
    {"id": case["id"], "error": case["referenceError"]} if "referenceError" in case
    else {"id": case["id"], "value": case["expected"]}
    for case in cases
]
actual = json.loads(result.stdout)
if actual != expected:
    if len(actual) != len(expected):
        print(f"Expected {len(expected)} rows, received {len(actual)}", file=sys.stderr)
    for observed, pinned in zip(actual, expected):
        if observed != pinned:
            print(f"{pinned['id']}: expected {pinned}, actual {observed}", file=sys.stderr)
    raise SystemExit("CDM period range oracle differs from the pinned cases")
print(f"Verified {len(cases)} period range cases against CDM 7.9.0 on the JVM.")
