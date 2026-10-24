// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { FormPreviewSchema, PreviewField } from './types.js';

const PREVIEW_SYMBOL_PREFIXES: Readonly<Record<string, string>> = {
  builtin: 'builtin',
  RosettaTypeAlias: 'typeAlias',
  RosettaEnumeration: 'enum',
  Data: 'data',
  Choice: 'choice'
};

/** Canonical presentation identity shared by schema generation, resource bindings and layout consumers. */
export function previewTypeSymbol(kind: string, targetId: string): string | undefined {
  const prefix = PREVIEW_SYMBOL_PREFIXES[kind];
  return prefix ? `${prefix}:${targetId}` : undefined;
}

/** Resolve one deferred object body without expanding its nested references. */
export function expandPreviewField(field: PreviewField, definitions: FormPreviewSchema['definitions']): PreviewField {
  if (field.kind !== 'object' || !field.definitionId) return field;
  const body = definitions?.[field.definitionId];
  if (!body) return field;
  const prefix = (path: string) => `${field.path}.${path}`;
  const relocate = (child: PreviewField): PreviewField => {
    const base = { ...child, path: prefix(child.path) };
    if (child.kind === 'array') return { ...base, kind: 'array', children: [relocate(child.children[0])] };
    if (child.kind === 'object')
      return {
        ...base,
        kind: 'object',
        children: child.children.map(relocate),
        choiceArmPaths: child.choiceArmPaths?.map(prefix)
      };
    return base;
  };
  return { ...field, children: body.fields.map(relocate), choiceArmPaths: body.choiceArmPaths?.map(prefix) };
}
