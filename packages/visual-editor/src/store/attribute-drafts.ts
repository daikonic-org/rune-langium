// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { Attribute, Dehydrated, RosettaCardinality } from '@rune-langium/core';

/** The same canonical Attribute payload for data fields, annotation fields and function signatures. */
export function createAttributeDraft(
  name: string,
  typeName: string,
  card: Pick<RosettaCardinality, 'inf' | 'sup' | 'unbounded'>,
  override = false
) {
  return {
    $type: 'Attribute',
    name,
    override,
    definition: undefined,
    typeCall: { $type: 'TypeCall', type: { $refText: typeName }, arguments: [] },
    typeCallArgs: [],
    card: { $type: 'RosettaCardinality', ...card, sup: card.sup },
    annotations: [],
    synonyms: [],
    references: [],
    labels: [],
    ruleReferences: []
  } satisfies Dehydrated<Attribute>;
}
