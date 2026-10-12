// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { AnnotationRef, AnnotationQualifier, Dehydrated } from '@rune-langium/core';
import {
  AnnotationRefSchema,
  RosettaClassSynonymSchema,
  RosettaSynonymSchema,
  RosettaEnumSynonymSchema
} from '../generated/zod-schemas.js';
import { SCHEMA_BY_TYPE } from '../schemas/schema-by-type.js';
import { getEditorFieldSchema } from '../schemas/editor-field-schema.js';
import type { MetadataNode, MetadataItem, MetadataCommand, MetadataEditResult } from './metadata-target.js';

type ItemField = 'annotations' | 'synonyms' | 'enumSynonyms';
type MetadataFields = { definition?: string; display?: string } & Partial<Record<ItemField, MetadataItem[]>>;

export function createAnnotationDraft(
  name: string,
  attribute?: string,
  qualifiers: readonly Dehydrated<AnnotationQualifier>[] = []
): Dehydrated<AnnotationRef> {
  return AnnotationRefSchema.parse({
    $type: 'AnnotationRef',
    annotation: { $refText: name },
    ...(attribute ? { attribute: { $refText: attribute } } : {}),
    qualifiers
  }) as Dehydrated<AnnotationRef>;
}

export function createSynonymDraft(
  kind: 'class' | 'body' | 'enumValue',
  source: string,
  value?: string
): MetadataItem | undefined {
  if (!source.trim() || (kind !== 'class' && !value?.trim())) return undefined;
  const sources = [{ $refText: source }];
  const synonymValue = { $type: 'RosettaSynonymValueBase', name: value };
  switch (kind) {
    case 'class':
      return RosettaClassSynonymSchema.parse({
        $type: 'RosettaClassSynonym',
        sources,
        ...(value ? { value: synonymValue } : {})
      }) as MetadataItem;
    case 'enumValue':
      return RosettaEnumSynonymSchema.parse({
        $type: 'RosettaEnumSynonym',
        sources,
        synonymValue: value
      }) as MetadataItem;
    case 'body':
      return RosettaSynonymSchema.parse({
        $type: 'RosettaSynonym',
        sources,
        body: { $type: 'RosettaSynonymBody', hints: [], metaValues: [], values: [synonymValue] }
      }) as MetadataItem;
  }
}

export function getMetadataItems(node: MetadataNode, field: ItemField): readonly MetadataItem[] {
  return (node as MetadataFields)[field] ?? [];
}

/** Validate the field being edited; unrelated declaration drafts do not participate. */
export function validateMetadataCommand(node: MetadataNode, command: MetadataCommand): MetadataEditResult | undefined {
  const root = SCHEMA_BY_TYPE[node.$type];
  const field = command.kind === 'definition' || command.kind === 'display' ? command.kind : command.field;
  const schema = root && getEditorFieldSchema(root, field);
  if (!schema) return { status: 'unsupported' };
  let candidate: unknown;
  if (command.kind === 'definition' || command.kind === 'display') candidate = command.value;
  else {
    const items = getMetadataItems(node, command.field);
    if (
      command.kind !== 'append' &&
      (!Number.isInteger(command.index) || command.index < 0 || items[command.index] !== command.expected)
    )
      return { status: 'stale' };
    const next = [...items];
    if (command.kind === 'append') next.push(command.value);
    else if (command.kind === 'replace') next[command.index] = command.value;
    else next.splice(command.index, 1);
    candidate = next;
  }
  const parsed = schema.safeParse(candidate);
  return parsed.success ? undefined : { status: 'invalid', issues: parsed.error.issues };
}

/** Applies only a previously validated command inside the existing graph recipe. */
export function applyMetadataRecipe(node: MetadataNode, command: MetadataCommand): void {
  const target = node as MetadataFields;
  if (command.kind === 'definition' || command.kind === 'display') {
    target[command.kind] = command.value;
    return;
  }
  const items = target[command.field] ?? (target[command.field] = []);
  if (command.kind === 'append') items.push(command.value);
  else if (command.kind === 'replace') items[command.index] = command.value;
  else items.splice(command.index, 1);
}
