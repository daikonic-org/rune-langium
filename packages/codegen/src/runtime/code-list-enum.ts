// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { CODE_LIST_ENUM_NAMESPACE, CODE_LIST_ENUM_SOURCE } from '@rune-langium/core';
import { buildModel } from '../import/ast-builder.js';
import { sanitizeIdentifier, dedupeIdentifier } from '../import/identifiers.js';
import { renderModel } from '../emit/rosetta/rosetta-render-core.js';
import type { CodeListValue } from '../types.js';

/** Use the same canonical enum builder and Rune renderer as schema imports. */
export function renderCodeListEnum(
  name: string,
  values: readonly CodeListValue[],
  options: { declareSource?: boolean; namespace?: string } = {}
): string {
  const namespace = options.namespace ?? CODE_LIST_ENUM_NAMESPACE;
  const ownsSource = namespace === CODE_LIST_ENUM_NAMESPACE;
  const used = new Set<string>();
  const built = buildModel({
    namespace,
    sourceName: CODE_LIST_ENUM_SOURCE,
    types: [],
    funcs: [],
    enums: [
      {
        name,
        sourceKey: name,
        values: values.map((value) => ({
          name: dedupeIdentifier(sanitizeIdentifier(value.value, 'Code'), used),
          sourceKey: value.value,
          displayName: value.label,
          description: value.description
        }))
      }
    ]
  });
  const source = options.declareSource === false ? undefined : built.synonymSourceDeclaration;
  return renderModel(
    { name: namespace, elements: built.elements },
    { declarations: [ownsSource ? source : `import ${CODE_LIST_ENUM_NAMESPACE}.*`] }
  );
}
