// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { isRosettaModel } from '../../packages/core/src/index.js';
import { curatedModelImplementations } from '../../packages/project-runtime/src/curated-implementations/cdm.js';
/** Simulate publication before a generator test; a bare codeImplementation declaration supplies no executable body. */
export function installPublishedNativeImplementations(documents: readonly { parseResult: { value: unknown } }[]): void {
  for (const document of documents) {
    const model = document.parseResult.value;
    if (!isRosettaModel(model)) continue;
    for (const [index, entry] of curatedModelImplementations(model))
      if (entry.kind === 'language-specific') Reflect.set(model.elements[index]!, '$implementation', entry);
  }
}
