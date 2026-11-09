# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
"""Checksum-pinned artifacts and source verification shared by optional JVM oracles."""

import hashlib
import json
import os
import urllib.request
import zipfile


def verified_classpath(directory, manifest, cache):
    artifact_manifest = manifest
    if "artifactManifest" in manifest:
        artifact_manifest = json.loads((directory / manifest["artifactManifest"]).read_text())
        if artifact_manifest["coordinate"] != manifest["coordinate"]:
            raise SystemExit("Shared Java artifact manifest uses a different cohort")
    artifacts = artifact_manifest["artifacts"]
    cache.mkdir(parents=True, exist_ok=True)
    for artifact in artifacts:
        path = cache / artifact["name"]
        if not path.exists():
            path.write_bytes(urllib.request.urlopen(artifact["url"], timeout=30).read())
        if hashlib.sha256(path.read_bytes()).hexdigest() != artifact["sha256"]:
            raise SystemExit(f"Java reference artifact checksum mismatch: {path.name}")
    for asset in manifest["files"]:
        with zipfile.ZipFile(cache / asset["artifact"]) as archive:
            data = archive.read(asset["entry"])
        if (
            hashlib.sha256(data).hexdigest() != asset["sha256"]
            or (directory / asset["name"]).read_bytes() != data
        ):
            raise SystemExit(f"Pinned Java source changed: {asset['name']}")
    return os.pathsep.join(
        str(cache / artifact["name"])
        for artifact in artifacts
        if artifact["runtime"]
    )
