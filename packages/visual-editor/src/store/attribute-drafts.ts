// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RosettaCardinality } from '@rune-langium/core';
import type { z } from 'zod';
import type { AttributeSchema } from '../generated/zod-schemas.js';

/** The same canonical Attribute payload for data fields, annotation fields and function inputs. */
export function createAttributeDraft(
  name: string,
  typeName: string,
  card: Pick<RosettaCardinality, 'inf' | 'sup' | 'unbounded'>,
  override = false
): z.input<typeof AttributeSchema> {
  return {
    $type: 'Attribute',
    name,
    override,
    typeCall: { $type: 'TypeCall', type: { $refText: typeName }, arguments: [] },
    typeCallArgs: [],
    card: { $type: 'RosettaCardinality', ...card },
    annotations: [],
    synonyms: [],
    references: [],
    labels: [],
    ruleReferences: []
  };
}
