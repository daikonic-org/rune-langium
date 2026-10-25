#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
//
// Build serialized workspace artifacts for curated models.
//
// Runs the same Langium parse + serialize that the curated-mirror
// worker does, but in a CI environment with enough memory for CDM.
// The worker OOMs on CDM (~141 files through Langium); CI has 4GB+.
//
// Usage:
//   node --max-old-space-size=4096 scripts/build-serialized-artifacts.mjs
//
// Outputs to dist/curated-artifacts/<modelId>/ for R2 upload via wrangler.

import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { computeNamespaceGraph, nsArtifactSlug } from './lib/namespace-graph.mjs';
import { resolveCuratedSources } from './lib/curated-sources.mjs';
import { isCuratedSourceFile } from '../packages/curated-schema/dist/index.js';

const corePkgDir = new URL('../packages/core/', import.meta.url);
const langiumIndex = new URL('node_modules/langium/lib/index.js', corePkgDir);
const { URI } = await import(langiumIndex);

const { values: options } = parseArgs({
  options: {
    sources: { type: 'string' },
    release: { type: 'string' },
    'out-dir': { type: 'string' },
    'cache-dir': { type: 'string' }
  }
});
if (options.sources && options.release) throw new Error('Choose either pinned sources or a verified release build');
const SOURCES = options.sources
  ? JSON.parse(await readFile(options.sources, 'utf8'))
  : await resolveCuratedSources(fetch, { cdmRelease: options.release });

const LANGIUM_VERSION = JSON.parse(
  await readFile(new URL('node_modules/langium/package.json', corePkgDir), 'utf8')
).version;
const OUT_DIR = options['out-dir'] ?? 'dist/curated-artifacts';
// Public base for absolute artifact URLs in the manifest (matches archiveUrl +
// artifacts.serializedWorkspace.url). Per-namespace `artifact` values MUST be
// absolute so any consumer can fetch them directly without prefixing — relative
// paths resolve against the consumer's page URL and 404.
const MIRROR_BASE = 'https://www.daikonic.dev/curated';

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadArchive(source) {
  const cache =
    options['cache-dir'] && source.commit
      ? join(options['cache-dir'], `${source.id}-${source.commit}.tar.gz`)
      : undefined;
  if (cache) {
    try {
      return new Uint8Array(await readFile(cache));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const ref = source.commit ?? `refs/heads/${source.ref}`;
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${ref}`;
  console.log(`  Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (cache) {
    await mkdir(options['cache-dir'], { recursive: true });
    await writeFile(cache, bytes);
  }
  return bytes;
}

function readTarString(block, start, end) {
  const sub = block.subarray(start, end);
  let last = sub.length;
  while (last > 0 && sub[last - 1] === 0) last--;
  return new TextDecoder('utf-8').decode(sub.subarray(0, last));
}

function extractRosettaFiles(tarGzBytes) {
  const tar = new Uint8Array(gunzipSync(Buffer.from(tarGzBytes)));
  const decoder = new TextDecoder('utf-8');
  const files = [];
  const BLOCK = 512;
  let offset = 0;

  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const sizeOctal = readTarString(header, 124, 136).trim();
    const typeflag = readTarString(header, 156, 157) || '\0';
    const prefix = readTarString(header, 345, 500);
    const size = sizeOctal.length > 0 ? parseInt(sizeOctal, 8) : 0;
    let path = prefix.length > 0 ? `${prefix}/${name}` : name;
    if (path.startsWith('./')) path = path.slice(2);
    if (path.endsWith('/')) path = path.slice(0, -1);

    offset += BLOCK;
    const dataBlocks = Math.ceil(size / BLOCK);

    if ((typeflag === '0' || typeflag === '\0' || typeflag === '') && path.endsWith('.rosetta')) {
      files.push({ path, content: decoder.decode(tar.subarray(offset, offset + size)) });
    }

    offset += dataBlocks * BLOCK;
  }

  return files;
}

function stampNamespacesIntoModelJson(modelJson, namespace, bigIntReplacer) {
  let parsed;
  try {
    parsed = JSON.parse(modelJson);
  } catch {
    return modelJson;
  }
  if (!parsed || !Array.isArray(parsed.elements)) return modelJson;
  for (const el of parsed.elements) {
    if (el && typeof el === 'object') el.$namespace = namespace;
  }
  return JSON.stringify(parsed, bigIntReplacer);
}

async function buildArtifact(source, archiveBytes, RuneDsl, documentMap) {
  const { serializeRuneModel, runeBigIntReplacer, namespaceFromModelName } =
    await import('../packages/core/dist/index.js');

  const rosettaFiles = extractRosettaFiles(archiveBytes).filter((file) => isCuratedSourceFile(source.id, file.path));
  console.log(`  Found ${rosettaFiles.length} .rosetta files`);
  if (rosettaFiles.length === 0) throw new Error(`${source.id}: no .rosetta files`);

  const serializer = RuneDsl.serializer.JsonSerializer;

  const documents = rosettaFiles.map((file) => {
    const document = documentMap.get(`${source.id}/${file.path}`);
    if (!document) throw new Error(`Missing parsed document: ${file.path}`);
    return document;
  });

  console.log(`  Serializing with textRegions...`);
  const version = new Date().toISOString().slice(0, 10);
  const artifact = {
    schemaVersion: 1,
    kind: 'langium-json-serializer',
    modelId: source.id,
    version,
    langiumVersion: LANGIUM_VERSION,
    documents: documents.map((doc, i) => {
      const model = doc.parseResult.value;
      const exports = [];
      for (let j = 0; j < (model.elements?.length ?? 0); j++) {
        const elem = model.elements[j];
        if (elem?.name && elem?.$type) {
          exports.push({
            type: elem.$type,
            name: elem.name,
            path: `/elements@${j}`
          });
          // Include enum values for cross-file resolution
          if (elem.enumValues) {
            for (let k = 0; k < elem.enumValues.length; k++) {
              const val = elem.enumValues[k];
              if (val?.name) {
                exports.push({
                  type: val.$type ?? 'RosettaEnumValue',
                  name: val.name,
                  path: `/elements@${j}/enumValues@${k}`
                });
              }
            }
          }
        }
      }
      const ns = namespaceFromModelName(model.name);
      const rawModelJson = serializeRuneModel(serializer, model);
      return {
        path: rosettaFiles[i].path,
        content: rosettaFiles[i].content,
        modelJson: ns ? stampNamespacesIntoModelJson(rawModelJson, ns, runeBigIntReplacer) : rawModelJson,
        exports
      };
    })
  };

  const json = JSON.stringify(artifact, runeBigIntReplacer);
  const gzipped = gzipSync(Buffer.from(json));
  return {
    bytes: gzipped,
    sha256: sha256Hex(gzipped),
    sizeBytes: gzipped.byteLength,
    documentCount: rosettaFiles.length,
    documents: artifact.documents,
    version
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/resolved-sources.json`, JSON.stringify(SOURCES, null, 2) + '\n');
  const { createRuneDslServices, assertValidDocuments, addLegacyAnnotations } =
    await import('../packages/core/dist/index.js');
  const archives = new Map(
    await Promise.all(SOURCES.map(async (source) => [source.id, await downloadArchive(source)]))
  );
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const documentMap = new Map(
    SOURCES.flatMap((source) =>
      extractRosettaFiles(archives.get(source.id))
        .filter((file) => isCuratedSourceFile(source.id, file.path))
        .map((file) => {
          const document = factory.fromString(file.content, URI.parse(`[${source.id}]/${file.path}`));
          return [
            `${source.id}/${file.path}`,
            source.id === 'rune-dsl' && file.path.endsWith('/annotations.rosetta')
              ? addLegacyAnnotations(document, factory)
              : document
          ];
        })
    )
  );
  const documents = [...documentMap.values()];
  console.log(`Parsing ${documents.length} production documents in one workspace...`);
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
  assertValidDocuments(documents);
  const namespacesByKey = new Map([...documentMap].map(([key, document]) => [key, document.parseResult.value.name]));
  let failed = false;

  for (const source of SOURCES) {
    console.log(`\n=== ${source.id} ===`);
    const outDir = `${OUT_DIR}/${source.id}`;
    await mkdir(outDir, { recursive: true });

    try {
      const archiveBytes = archives.get(source.id);
      const archiveSha = sha256Hex(archiveBytes);
      console.log(`  Archive: ${archiveBytes.byteLength} bytes, SHA: ${archiveSha.slice(0, 16)}...`);

      const result = await buildArtifact(source, archiveBytes, RuneDsl, documentMap);
      console.log(`  Artifact: ${result.sizeBytes} bytes, ${result.documentCount} documents`);

      await writeFile(`${outDir}/latest.serialized.json.gz`, result.bytes);
      await writeFile(`${outDir}/source.tar.gz`, archiveBytes);

      // ── Per-namespace artifacts ────────────────────────────────────────────
      const graph = computeNamespaceGraph(result.documents, source.id, namespacesByKey);
      const dependencies = {};
      for (const entry of Object.values(graph))
        for (const dependency of entry.deps) {
          const prefix = dependency.endsWith('.*') ? dependency.slice(0, -2) : dependency;
          for (const [key, namespace] of namespacesByKey) {
            const owner = key.slice(0, key.indexOf('/'));
            if (owner !== source.id && (namespace === prefix || namespace.startsWith(prefix + '.')))
              dependencies[owner] = 'latest';
          }
        }

      // Build a path→ns lookup so we group by the graph's assignments
      const pathToNs = new Map();
      for (const [ns, entry] of Object.entries(graph)) {
        for (const d of entry.docs) pathToNs.set(d.path, ns);
      }

      // Group FULL docs (with original {type,name,path} exports) by namespace
      const nsDocs = {};
      for (const doc of result.documents) {
        const ns = pathToNs.get(doc.path);
        if (!ns) continue;
        (nsDocs[ns] ??= []).push(doc);
      }

      const nsDir = `${outDir}/ns`;
      await mkdir(nsDir, { recursive: true });

      let totalNsBytes = 0;
      const nsCount = Object.keys(graph).length;

      // Map each namespace to an R2-safe artifact slug. R2/wrangler reject keys
      // containing `..` (path-traversal guard), and leading/trailing dots are
      // unsafe as path segments. Rosetta namespaces are dot-separated
      // identifiers, but the upstream corpus is not always clean — e.g. rune-fpml
      // declares `namespace fpml.consolidated.` (trailing dot), which would
      // produce `fpml.consolidated..json.gz`. Collapse repeated dots and strip
      // edge dots for the FILENAME/KEY only; the namespace identity (the map key
      // below, used for closure + display) is preserved verbatim. Fail loudly on
      // a slug collision rather than silently overwriting one namespace's blob.
      const nsToSlug = new Map();
      const slugToNs = new Map();
      for (const ns of Object.keys(graph)) {
        const slug = nsArtifactSlug(ns);
        if (slugToNs.has(slug)) {
          throw new Error(
            `${source.id}: namespace artifact slug collision — "${ns}" and "${slugToNs.get(slug)}" both map to "${slug}"`
          );
        }
        slugToNs.set(slug, ns);
        nsToSlug.set(ns, slug);
      }

      for (const ns of Object.keys(graph)) {
        const nsDocList = nsDocs[ns] ?? [];
        const nsJson = JSON.stringify({ documents: nsDocList });
        const nsGzipped = gzipSync(Buffer.from(nsJson));
        await writeFile(`${nsDir}/${nsToSlug.get(ns)}.json.gz`, nsGzipped);
        totalNsBytes += nsGzipped.byteLength;
      }

      console.log(`  Per-ns: ${nsCount} namespaces, ${totalNsBytes} total bytes`);

      // Build namespaces map for the meta. The map KEY is the real namespace
      // (used by /api/parse for closure + the explorer); the `artifact` value
      // uses the R2-safe slug so the key matches the uploaded blob filename.
      const version = `${result.version}-${result.sha256.slice(0, 12)}`;
      const namespacesMap = {};
      for (const [ns, entry] of Object.entries(graph)) {
        namespacesMap[ns] = {
          deps: entry.deps,
          exports: entry.exports,
          // Absolute URL (consistent with archiveUrl + serializedWorkspace.url) so
          // any consumer fetches it directly; relative paths 404 against a page URL.
          artifact: `${MIRROR_BASE}/${source.id}/artifacts/${version}/ns/${nsToSlug.get(ns)}.json.gz`
        };
      }

      await writeFile(
        `${outDir}/artifact-meta.json`,
        JSON.stringify(
          {
            modelId: source.id,
            upstreamCommit: source.commit,
            upstreamRef: source.ref,
            langiumVersion: LANGIUM_VERSION,
            version,
            sha256: result.sha256,
            sizeBytes: result.sizeBytes,
            documentCount: result.documentCount,
            archiveSha256: archiveSha,
            archiveSizeBytes: archiveBytes.byteLength,
            generatedAt: new Date().toISOString(),
            namespaces: namespacesMap,
            dependencies
          },
          null,
          2
        )
      );
      console.log(`  ✓ ${outDir}/`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
}

main();
