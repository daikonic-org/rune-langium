// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isRosettaFunction, isRosettaModel, type RosettaModel } from '@rune-langium/core';
import {
  ImplementationSourcePackSchema,
  type FunctionImplementation,
  type ImplementationSourcePack
} from '@rune-langium/core/project-contract';
import { curatedModelImplementations, RUNE_IMPLEMENTATIONS, type CdmImplementationResources } from './cdm.js';
import { RUNE_IMPLEMENTATION_SOURCES } from './generated/rune-sources.js';
import { projectFileRevision } from '@rune-langium/project-config';

export function curatedRuneSourceFiles(entries: Iterable<FunctionImplementation>): string[] {
  const files = new Set<string>();
  for (const entry of entries)
    if (entry.kind === 'rune') {
      const source = RUNE_IMPLEMENTATIONS.find(
        (candidate) =>
          candidate.namespace === entry.namespace && candidate.name === entry.name && candidate.path === entry.path
      );
      if (!source) throw new Error('Unknown Rune implementation selected by publication.');
      for (const file of source.files) files.add(file);
    }
  return [...files].sort();
}
/** Stamp only the serialized copy; upstream source and the linked graph retain their original bytes and bodies. */
export function stampCuratedImplementations(
  json: string,
  entries: ReadonlyMap<number, FunctionImplementation>,
  sources?: ImplementationSourcePack
): string {
  const value: unknown = JSON.parse(json);
  if (!isRosettaModel(value)) throw new Error('Curated implementation payload requires a model.');
  for (const [index, entry] of entries) {
    const node = value.elements[index];
    if (!isRosettaFunction(node) || node.name !== entry.name)
      throw new Error('Curated implementation declaration changed.');
    Reflect.set(node, '$implementation', entry);
  }
  if (sources) Reflect.set(value, '$implementationSources', ImplementationSourcePackSchema.parse(sources));
  return JSON.stringify(value);
}

/** CI publication carries implementations in the checksum-pinned serialized bundle. */
export async function publishCuratedImplementations(
  model: RosettaModel,
  json: string,
  origin: { model: string; commit: string },
  resources?: CdmImplementationResources
): Promise<string> {
  if (origin.model !== 'cdm') return json;
  const selected = await curatedModelImplementations(model, resources);
  if (!selected.size) return json;
  const paths = [...curatedRuneSourceFiles(selected.values()), 'LICENSE'];
  const files = await Promise.all(
    paths.map(async (path) => {
      const content = RUNE_IMPLEMENTATION_SOURCES[path];
      if (!content) throw new Error('Missing curated Rune source: ' + path);
      const sha256 = await projectFileRevision(content);
      return { path, content, sha256 };
    })
  );
  return stampCuratedImplementations(json, selected, files.length ? { schemaVersion: 1, ...origin, files } : undefined);
}
