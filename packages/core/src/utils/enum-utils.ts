// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RosettaEnumeration, RosettaEnumValue } from '../generated/ast.js';
import { getElementNamespace } from '../analysis/cross-namespace-refs.js';

/** Portable synonym source used by materialized resource enums. Ordinary enum synonyms remain mappings only. */
export const CODE_LIST_ENUM_NAMESPACE = 'rune.resources';
export const CODE_LIST_ENUM_SOURCE = 'CodeList';

/** The member identifier and the external code are distinct; displayName is presentation only. */
export function getEnumValueLiteral(value: RosettaEnumValue): string {
  const mappings = (value.enumSynonyms ?? []).filter((mapping) =>
    mapping.sources.some(
      (source) =>
        source.ref?.name === CODE_LIST_ENUM_SOURCE && getElementNamespace(source.ref) === CODE_LIST_ENUM_NAMESPACE
    )
  );
  if (!mappings.length) return value.name;
  if (
    mappings.length !== 1 ||
    mappings[0]!.patternMatch !== undefined ||
    mappings[0]!.patternReplace !== undefined ||
    mappings[0]!.removeHtml
  )
    throw new Error('A resource enum member must have one literal code mapping: ' + value.name);
  return mappings[0]!.synonymValue;
}

/** Effective enum members, with child declarations overriding inherited names. */
export function getEnumValues(enumeration: RosettaEnumeration): RosettaEnumValue[] {
  const seen = new Set<RosettaEnumeration>();
  const values = new Map<string, RosettaEnumValue>();
  for (
    let current: RosettaEnumeration | undefined = enumeration;
    current && !seen.has(current);
    current = current.parent?.ref
  ) {
    seen.add(current);
    for (const value of current.enumValues) if (!values.has(value.name)) values.set(value.name, value);
  }
  return [...values.values()];
}
