// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isRosettaModel } from '../../packages/core/src/index.js';
import {
  CDM_IMPLEMENTATIONS,
  curatedModelImplementations
} from '../../packages/project-runtime/src/curated-implementations/cdm.js';
import { RUNE_IMPLEMENTATION_SOURCES } from '../../packages/project-runtime/src/curated-implementations/generated/rune-sources.js';

/** Supply the published Rune sources as ordinary workspace files in generator-only fixtures. */
export function publishedRuneFiles(namespace: string, names: readonly string[]) {
  const files = new Set(
    CDM_IMPLEMENTATIONS.flatMap((entry) =>
      entry.kind === 'rune' && entry.namespace === namespace && names.includes(entry.name)
        ? entry.files.filter((file) => file.endsWith('.rosetta'))
        : []
    )
  );
  return [...files].map((file) => ({
    uri: `file:///model/implementations/cdm/${file}`,
    content: RUNE_IMPLEMENTATION_SOURCES[file]!
  }));
}
/** Simulate publication before a generator test; a bare codeImplementation declaration supplies no executable body. */
export function installPublishedNativeImplementations(documents: readonly { parseResult: { value: unknown } }[]): void {
  for (const document of documents) {
    const model = document.parseResult.value;
    if (!isRosettaModel(model)) continue;
    for (const [index, entry] of curatedModelImplementations(model))
      if (entry.kind === 'language-specific') Reflect.set(model.elements[index]!, '$implementation', entry);
  }
}
