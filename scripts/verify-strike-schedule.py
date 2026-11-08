#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Optional differential check against the published handwritten CDM Java implementation."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from lib.java_reference_oracle import verified_classpath

root = Path(__file__).resolve().parent.parent
directory = root / "test/fixtures/third-party/cdm-strike-schedule"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((directory / "java-oracle.json").read_text())
classpath = verified_classpath(directory, manifest, args.cache_dir)
cases = json.loads((directory / "cases.json").read_text())
result = subprocess.run(
    [os.environ.get("JAVA_BINARY", "java"), "--class-path", classpath,
     str(root / "scripts/fixtures/StrikeScheduleOracle.java")],
    input=json.dumps(cases), text=True, capture_output=True, timeout=60,
)
if result.returncode:
    raise SystemExit(result.stderr)
expected = [{"id": case["id"], "value": case["expected"]} for case in cases]
if json.loads(result.stdout) != expected:
    raise SystemExit("CDM strike-schedule oracle differs from the pinned cases")
print(f"Verified {len(cases)} strike-schedule cases against CDM 7.9.0 on the JVM.")
