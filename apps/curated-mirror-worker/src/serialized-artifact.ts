// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  createRuneDslServices,
  serializeRuneModel,
  assertValidDocuments,
  addLegacyAnnotations
} from '@rune-langium/core';
import { isCuratedSourceFile } from '@rune-langium/curated-schema';
import type { CuratedModelId, CuratedSerializedWorkspaceArtifact } from '@rune-langium/curated-schema';
import { URI } from 'langium';
import { gzip, inflate } from 'pako';
import { sha256Hex } from './manifest.js';
import { computeNamespaceGraph, type NamespaceGraphEntry } from './namespace-graph.js';

const BLOCK = 512;
const LANGIUM_VERSION = '4.2.2';

interface TarEntry {
  path: string;
  size: number;
  typeflag: string;
  dataOffset: number;
}

export interface SerializedArtifactBuildResult {
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
  documentCount: number;
  namespaces: Record<string, NamespaceGraphEntry>;
}

export async function buildSerializedWorkspaceArtifact(
  modelId: CuratedModelId,
  version: string,
  archiveBytes: Uint8Array
): Promise<SerializedArtifactBuildResult> {
  const rosettaFiles = readRosettaFilesFromTarGz(archiveBytes).filter((file) =>
    isCuratedSourceFile(modelId, file.path)
  );
  if (rosettaFiles.length === 0) {
    throw new Error(`curated source ${modelId}@${version} contained no .rosetta files`);
  }

  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;
  const serializer = RuneDsl.serializer.JsonSerializer;

  const documents = rosettaFiles.map((file) => {
    const document = factory.fromString(file.content, URI.parse(`[${modelId}]/${file.path}`));
    return modelId === 'rune-dsl' && file.path.endsWith('/annotations.rosetta')
      ? addLegacyAnnotations(document, factory)
      : document;
  });
  await builder.build(documents, { validation: false });
  assertValidDocuments(documents);

  const perDocArray = documents.map((document, index) => {
    const model = document.parseResult.value;
    const exports: Array<{ type: string; name: string; path: string }> = [];
    const elements = (model as { elements?: unknown[] }).elements;
    for (let j = 0; j < (elements?.length ?? 0); j++) {
      const elem = elements![j] as
        | {
            name?: string;
            $type?: string;
            enumValues?: Array<{ name?: string; $type?: string }>;
          }
        | undefined;
      if (elem?.name && elem?.$type) {
        exports.push({
          type: elem.$type,
          name: elem.name,
          path: `/elements@${j}`
        });
        // Include enum values — Langium's ScopeComputation adds these
        // to the global index so cross-file enum literal references resolve.
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
    return {
      path: rosettaFiles[index]!.path,
      content: rosettaFiles[index]!.content,
      modelJson: serializeRuneModel(serializer, document.parseResult.value),
      exports
    };
  });

  const artifact: CuratedSerializedWorkspaceArtifact = {
    schemaVersion: 1,
    kind: 'langium-json-serializer',
    modelId,
    version,
    langiumVersion: LANGIUM_VERSION,
    documents: perDocArray
  };

  const namespaces = computeNamespaceGraph(perDocArray, modelId);

  const bytes = gzip(new TextEncoder().encode(JSON.stringify(artifact)));
  return {
    bytes,
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.byteLength,
    documentCount: artifact.documents.length,
    namespaces
  };
}

function readRosettaFilesFromTarGz(archiveBytes: Uint8Array): Array<{ path: string; content: string }> {
  const tar = inflate(archiveBytes);
  const decoder = new TextDecoder('utf-8');
  const files: Array<{ path: string; content: string }> = [];

  let offset = 0;
  while (offset + BLOCK <= tar.byteLength) {
    const headerBlock = tar.subarray(offset, offset + BLOCK);
    if (headerBlock.every((byte) => byte === 0)) break;
    const entry = parseTarEntry(headerBlock, offset + BLOCK);
    offset += BLOCK;

    const dataBlocks = Math.ceil(entry.size / BLOCK);
    const dataEnd = entry.dataOffset + entry.size;
    if (entry.typeflag === '0' || entry.typeflag === '\0' || entry.typeflag === '') {
      if (entry.path.endsWith('.rosetta') && !isAppleDoubleEntry(entry.path)) {
        files.push({
          path: entry.path,
          content: decoder.decode(tar.subarray(entry.dataOffset, dataEnd))
        });
      }
    } else if (entry.typeflag === '5' || entry.typeflag === 'g' || entry.typeflag === 'x') {
      // Directories and PAX headers don't contribute documents.
    } else if (entry.typeflag === '1' || entry.typeflag === '2') {
      throw new Error(`tar: links not supported (path=${entry.path})`);
    } else {
      throw new Error(`tar: unsupported typeflag '${entry.typeflag}' (path=${entry.path})`);
    }

    offset += dataBlocks * BLOCK;
  }

  return files;
}

function parseTarEntry(block: Uint8Array, dataOffset: number): TarEntry {
  const decoder = new TextDecoder('utf-8');
  const slice = (start: number, end: number): string => {
    const sub = block.subarray(start, end);
    let last = sub.length;
    while (last > 0 && sub[last - 1] === 0) last--;
    return decoder.decode(sub.subarray(0, last));
  };

  const name = slice(0, 100);
  const sizeOctal = slice(124, 136).trim();
  const typeflag = slice(156, 157) || '\0';
  const prefix = slice(345, 500);
  const size = sizeOctal.length > 0 ? parseInt(sizeOctal, 8) : 0;
  const rawPath = prefix.length > 0 ? `${prefix}/${name}` : name;

  return {
    path: cleanPath(rawPath),
    size,
    typeflag,
    dataOffset
  };
}

/**
 * macOS BSD `tar` emits AppleDouble companion files (`._<basename>`,
 * typeflag '0', ~163 bytes each) for every source file that has extended
 * attributes. The companion's path ends in the same `.rosetta` suffix as
 * the real file, so a naive `path.endsWith('.rosetta')` check counts
 * them and Langium then parses 163 bytes of AppleDouble binary metadata
 * as Rosetta source — producing one ghost document per real document
 * and doubling the artifact size.
 *
 * Prod doesn't hit this in practice because GitHub codeload archives
 * strip xattrs, but the seed (which tars from a workdir on a macOS
 * volume) does. Skipping any path whose basename starts with `._`
 * defends against both producers without losing legitimate content
 * (no real Rosetta file should start with `._`).
 */
function isAppleDoubleEntry(path: string): boolean {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return base.startsWith('._');
}

function cleanPath(raw: string): string {
  let path = raw;
  if (path.startsWith('./')) path = path.slice(2);
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path.length === 0) return '';
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error(`tar: rejected unsafe path (${raw})`);
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`tar: rejected path-traversal entry (${raw})`);
    }
  }
  return path;
}
