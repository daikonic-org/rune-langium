#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Verify the pinned calendar cases against the published handwritten CDM defaults."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from lib.java_reference_oracle import verified_classpath

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
parser.add_argument("--suite", choices=("cdm-calendar", "cdm-commodity-periods"), default="cdm-calendar")
args = parser.parse_args()
directory = root / "test/fixtures/third-party" / args.suite
manifest = json.loads((directory / "java-oracle.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases = [
    case for case in json.loads((directory / "cases.json").read_text())
    if case.get("reference", "java") == "java"
]
expected = [
    {"id": case["id"], "error": case["referenceError"]} if "referenceError" in case
    else {"id": case["id"], "value": case.get("referenceExpected", case.get("expected"))}
    for case in cases
]
result = subprocess.run(
    [os.environ.get("JAVA_BINARY", "java"), "--class-path", classpath,
     str(root / "scripts/fixtures/CalendarOracle.java")],
    input=json.dumps(cases), text=True, capture_output=True, timeout=60,
)
if result.returncode:
    raise SystemExit(result.stderr)
actual = json.loads(result.stdout)
if actual != expected:
    if len(actual) != len(expected):
        print(f"Expected {len(expected)} rows, received {len(actual)}", file=sys.stderr)
    for observed, pinned in zip(actual, expected):
        if observed != pinned:
            print(f"{pinned['id']}: expected {pinned}, actual {observed}", file=sys.stderr)
    raise SystemExit("CDM calendar oracle differs from the pinned cases")
print(f"Verified {len(expected)} {args.suite} cases against CDM 7.9.0 on the JVM.")
