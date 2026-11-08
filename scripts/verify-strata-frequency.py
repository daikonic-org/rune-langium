#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Optional JVM oracle check; ordinary target tests use the pinned expectations offline."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from lib.java_reference_oracle import verified_classpath

root = Path(__file__).resolve().parent.parent
directory = root / "test/fixtures/third-party/cdm-frequency"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((directory / "strata.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases = json.loads((directory / "cases.json").read_text()) + json.loads(
    (directory / "strata-cases.json").read_text()
)
result = subprocess.run(
    [
        os.environ.get("JAVA_BINARY", "java"),
        "--class-path",
        classpath,
        str(root / "scripts/fixtures/StrataFrequencyOracle.java"),
        *[
            case["referenceInput"]
            if "referenceInput" in case
            else str(case["inputs"]["frequency"]["periodMultiplier"])
            + case["inputs"]["frequency"]["period"]
            for case in cases
        ],
    ],
    capture_output=True,
    text=True,
    timeout=60,
)
if result.returncode:
    raise SystemExit(result.stderr)
lines = result.stdout.splitlines()
if len(lines) != len(cases):
    raise SystemExit("Strata oracle result count differs from the pinned cases")
for case, line in zip(cases, lines):
    kind, value = line.split("\t")
    expected = case.get("referenceExpected", case.get("expected"))
    actual = int(value) if kind == "value" else value
    if (kind, actual) != (
        ("value", expected)
        if expected is not None
        else ("error", case.get("referenceError", "IllegalArgumentException"))
    ):
        raise SystemExit(f"Strata oracle differs for {case['id']}: {line}")
print(f"Verified {len(cases)} cases against published Strata 1.7.0 on the JVM.")
