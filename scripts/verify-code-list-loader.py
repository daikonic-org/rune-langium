#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Compare the pinned lists and validator outcomes with the handwritten CDM loader."""

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
args = parser.parse_args()
directory = root / "test/fixtures/third-party/cdm-code-list-loader"
manifest = json.loads((directory / "java-oracle.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases = json.loads((directory / "cases.json").read_text())
run = subprocess.run(
    [os.environ.get("JAVA_BINARY", "java"), "--class-path", classpath,
     str(root / "scripts/fixtures/CodeListOracle.java")],
    input=json.dumps(cases), capture_output=True, text=True, timeout=60,
)
if run.returncode:
    raise SystemExit(run.stderr)
actual = json.loads(run.stdout)
for test, row in zip(cases, actual, strict=True):
    if row["id"] != test["id"]:
        raise SystemExit("Java results are out of order")
    expected_error = test.get("referenceError", test.get("expectedError"))
    if expected_error:
        if expected_error not in row.get("error", ""):
            raise SystemExit(f"{test['id']}: unexpected Java error {row}")
    else:
        expected = (
            json.loads((directory / "resources" / test["resource"]).read_text())
            if "resource" in test else test["expected"]
        )
        if "error" in row or row["value"] != expected:
            raise SystemExit(f"{test['id']}: Java output differs from the pinned resource or expected value")
print(f"Verified {len(cases)} code-list cases against CDM 7.9.0 on the JVM.")
