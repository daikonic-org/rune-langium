#!/usr/bin/env python3
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Optional JVM oracle check; ordinary target tests use the pinned expectations offline."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
directory = root / "test/fixtures/third-party/cdm-frequency"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache-dir", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((directory / "strata.json").read_text())
args.cache_dir.mkdir(parents=True, exist_ok=True)
for artifact in manifest["artifacts"]:
    path = args.cache_dir / artifact["name"]
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(artifact["url"], timeout=30).read())
    if hashlib.sha256(path.read_bytes()).hexdigest() != artifact["sha256"]:
        raise SystemExit(f"Strata artifact checksum mismatch: {path.name}")
for asset in manifest["files"]:
    with zipfile.ZipFile(args.cache_dir / asset["artifact"]) as archive:
        data = archive.read(asset["entry"])
    if (
        hashlib.sha256(data).hexdigest() != asset["sha256"]
        or (directory / asset["name"]).read_bytes() != data
    ):
        raise SystemExit(f"Pinned Strata source changed: {asset['name']}")
cases = json.loads((directory / "cases.json").read_text()) + json.loads(
    (directory / "strata-cases.json").read_text()
)
classpath = os.pathsep.join(
    str(args.cache_dir / artifact["name"])
    for artifact in manifest["artifacts"]
    if artifact["runtime"]
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
