#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# Copyright (c) 2026 Pradeep Mouli
#
# Upload pre-built serialized artifacts to the curated-mirror R2 bucket
# and patch each model's manifest.json to include the artifact reference.
#
# Prerequisites:
#   - dist/curated-artifacts/<modelId>/latest.serialized.json.gz
#   - dist/curated-artifacts/<modelId>/artifact-meta.json
#   - dist/curated-artifacts/<modelId>/source.tar.gz
#   - CLOUDFLARE_API_TOKEN env var (or wrangler login)
#
# Usage:
#   bash scripts/upload-serialized-artifacts.sh [--dry-run]

set -euo pipefail
DRY_RUN=0
if (( $# > 0 )); then
  if (( $# != 1 )) || [[ "$1" != "--dry-run" ]]; then echo "Usage: $0 [--dry-run]" >&2; exit 2; fi
  DRY_RUN=1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="rune-curated-mirror"
MIRROR_BASE="https://www.daikonic.dev/curated"
ARTIFACT_DIR="$REPO_ROOT/dist/curated-artifacts"
WRANGLER=(pnpm --filter @rune-langium/curated-mirror-worker exec wrangler)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

upload_object() {
  local key="$1" file="$2" content_type="$3"
  # Keep the complete error: tailing Wrangler output hid the cause of failed publications.
  "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --file "$file" --content-type "$content_type" --remote
  printf '%s\n' "$key" >> "$TMP_DIR/published-keys"
}

shopt -s nullglob
model_dirs=("$ARTIFACT_DIR"/*/)
if (( ${#model_dirs[@]} == 0 )); then
  echo "No artifacts found in $ARTIFACT_DIR" >&2
  exit 1
fi

# Prepare every manifest before uploading; failures must leave published pointers alone.
for model_dir in "${model_dirs[@]}"; do
  model_id=$(basename "$model_dir")
  artifact_file="$model_dir/latest.serialized.json.gz"
  meta_file="$model_dir/artifact-meta.json"

  if [[ ! -f "$artifact_file" || ! -f "$meta_file" || ! -f "$model_dir/source.tar.gz" ]]; then
    echo "Missing artifact, source archive or meta file for $model_id" >&2
    exit 1
  fi

  echo "=== $model_id ==="

  # Read metadata
  langium_version=$(jq -er '.langiumVersion // error("Missing compiler version; rebuild artifacts")' "$meta_file")
  version=$(jq -r '.version' "$meta_file")
  sha256=$(jq -r '.sha256' "$meta_file")
  archive_sha256=$(jq -r '.archiveSha256' "$meta_file")
  size_bytes=$(jq -r '.sizeBytes' "$meta_file")
  doc_count=$(jq -r '.documentCount' "$meta_file")

  while IFS= read -r dependency; do
    if [[ ! -f "$ARTIFACT_DIR/$dependency/artifact-meta.json" || ! -f "$ARTIFACT_DIR/$dependency/latest.serialized.json.gz" ]]; then
      echo "Missing dependency bundle $dependency required by $model_id" >&2
      exit 1
    fi
  done < <(jq -r '.dependencies // {} | keys[]' "$meta_file")

  # Fetch current manifest, patch in the artifact reference + namespaces, re-upload
  echo "  Patching manifest.json..."
  manifest_url="$MIRROR_BASE/$model_id/manifest.json"
  current_manifest=$(curl -fsS "$manifest_url")

  manifest_file="$TMP_DIR/$model_id.json"
  echo "$current_manifest" | jq \
    --arg sha "$sha256" \
    --arg url "$MIRROR_BASE/$model_id/artifacts/$version.serialized.json.gz" \
    --arg archiveUrl "$MIRROR_BASE/$model_id/artifacts/source-$archive_sha256.tar.gz" \
    --arg langiumVersion "$langium_version" \
    --argjson size "$size_bytes" \
    --argjson docs "$doc_count" \
    --slurpfile meta "$meta_file" \
    'del(.cohort) | .upstreamCommit = ($meta[0].upstreamCommit // .upstreamCommit) | .upstreamRef = ($meta[0].upstreamRef // .upstreamRef) |
    .sha256 = $meta[0].archiveSha256 | .sizeBytes = $meta[0].archiveSizeBytes |
    .generatedAt = $meta[0].generatedAt | .version = ($meta[0].generatedAt | .[0:10]) |
    .archiveUrl = $archiveUrl | .artifacts.serializedWorkspace = {
      schemaVersion: 1,
      kind: "langium-json-serializer",
      url: $url,
      sha256: $sha,
      sizeBytes: $size,
      documentCount: $docs,
      langiumVersion: $langiumVersion
    } |
    .dependencies = ($meta[0].dependencies // {}) |
    if (($meta[0].namespaces // {}) | length) > 0 then
      .schemaVersion = 2 | .namespaces = $meta[0].namespaces
    else . end' > "$manifest_file"

done

# Hash the complete prepared manifest set, so unchanged local bundles also get
# new immutable manifests when their dependency cohort changes.
cohort="cohort-$(cat "$TMP_DIR/"*.json | shasum -a 256 | cut -d ' ' -f 1)"
for model_dir in "${model_dirs[@]}"; do
  model_id=$(basename "$model_dir")
  jq --arg cohort "$cohort" '.cohort = $cohort | .dependencies |= map_values($cohort)' \
    "$TMP_DIR/$model_id.json" > "$TMP_DIR/$model_id.pinned"
  mv "$TMP_DIR/$model_id.pinned" "$TMP_DIR/$model_id.json"
done

# An explicit verified release build may prepare catalog mappings; nightly master builds never invent tags.
release_plan="$TMP_DIR/releases"
if [[ -f "$ARTIFACT_DIR/resolved-sources.json" ]]; then
  jq -e 'type == "array"' "$ARTIFACT_DIR/resolved-sources.json" > /dev/null
  if jq -e 'any(.[]; .release != null)' "$ARTIFACT_DIR/resolved-sources.json" > /dev/null; then
    node "$REPO_ROOT/scripts/lib/curated-releases.mjs" --phase prepare \
      --sources "$ARTIFACT_DIR/resolved-sources.json" --manifests "$TMP_DIR" \
      --out "$release_plan" --base "${MIRROR_BASE%/curated}"
  fi
fi

if (( DRY_RUN )); then
  mkdir -p "$REPO_ROOT/dist"
  preview=$(mktemp -d "$REPO_ROOT/dist/curated-publication-preview.XXXXXX")
  cp "$TMP_DIR/"*.json "$preview/"
  if [[ -f "$release_plan/plan.json" ]]; then
    mkdir -p "$preview/releases"
    cp "$release_plan/"*.json "$preview/releases/"
  fi
  echo "Prepared publication preview: $preview"
  exit 0
fi

# Upload all versioned blobs across the dependency set before advancing any pointer.
for model_dir in "${model_dirs[@]}"; do
  model_id=$(basename "$model_dir")
  version=$(jq -r '.version' "$model_dir/artifact-meta.json")
  archive_sha256=$(jq -r '.archiveSha256' "$model_dir/artifact-meta.json")
  upload_object "curated/$model_id/artifacts/source-$archive_sha256.tar.gz" "$model_dir/source.tar.gz" application/gzip
  upload_object "curated/$model_id/artifacts/$version.serialized.json.gz" "$model_dir/latest.serialized.json.gz" application/gzip
  for ns_file in "$model_dir/ns/"*.json.gz; do
    upload_object "curated/$model_id/artifacts/$version/ns/$(basename "$ns_file")" "$ns_file" application/gzip
  done
done

# Every dependency manifest must exist before a latest manifest can expose it.
for model_dir in "${model_dirs[@]}"; do
  model_id=$(basename "$model_dir")
  upload_object "curated/$model_id/artifacts/$cohort/manifest.json" "$TMP_DIR/$model_id.json" 'application/json; charset=utf-8'
done

# Catalogs are promoted only from successful immutable upload receipts, dependencies first.
if [[ -f "$release_plan/plan.json" ]]; then
  node "$REPO_ROOT/scripts/lib/curated-releases.mjs" --phase ready --out "$release_plan" --receipts "$TMP_DIR/published-keys"
  while IFS= read -r model_id; do
    upload_object "releases/$model_id.json" "$release_plan/$model_id.json" 'application/json; charset=utf-8'
  done < <(jq -r '.models[]' "$release_plan/plan.json")
  echo "Tagged releases published; Nightly pointers are unchanged."
  exit 0
fi

# Only untagged Nightly builds advance these moving pointers.
# Each pointer write is atomic in R2; the group of manifests is not a transaction.
for model_dir in "${model_dirs[@]}"; do
  model_id=$(basename "$model_dir")
  upload_object "curated/$model_id/latest.tar.gz" "$model_dir/source.tar.gz" application/gzip
  upload_object "curated/$model_id/latest.serialized.json.gz" "$model_dir/latest.serialized.json.gz" application/gzip
  upload_object "curated/$model_id/manifest.json" "$TMP_DIR/$model_id.json" 'application/json; charset=utf-8'
  echo "  Published $model_id"
done

echo "All artifacts uploaded."
