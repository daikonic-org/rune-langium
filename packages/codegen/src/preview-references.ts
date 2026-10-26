// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isMetadataInputEnvelope } from './expr/metadata-input.js';
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
  const relocate = (child: PreviewField) =>
    mapPreviewFieldPaths(child, prefix, field.declaredPath ? (path) => field.declaredPath + '.' + path : undefined);
  return { ...field, children: body.fields.map(relocate), choiceArmPaths: body.choiceArmPaths?.map(prefix) };
}

/** Relocate a finite preview tree, including Choice-arm paths and array item paths. */
export function mapPreviewFieldPaths(
  field: PreviewField,
  map: (path: string) => string,
  declared?: (path: string) => string
): PreviewField {
  const base = {
    ...field,
    path: map(field.path),
    ...(declared || field.declaredPath ? { declaredPath: (declared ?? map)(field.declaredPath ?? field.path) } : {})
  };
  if (field.kind === 'array')
    return { ...base, kind: 'array', children: [mapPreviewFieldPaths(field.children[0], map, declared)] };
  if (field.kind === 'object')
    return {
      ...base,
      kind: 'object',
      children: field.children.map((child) => mapPreviewFieldPaths(child, map, declared)),
      choiceArmPaths: field.choiceArmPaths?.map(map)
    };
  return base;
}
/** Edit a metadata payload's value path while retaining its adjacent keys, scheme and references. */
export function metadataPreviewField(field: PreviewField, value: unknown): PreviewField {
  if (!field.metadata || field.kind === 'array') return field;
  const candidate =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'meta') &&
    !Object.prototype.hasOwnProperty.call(value, 'value')
      ? { ...value, value: undefined }
      : value;
  if (!isMetadataInputEnvelope(candidate, field.metadata.payloadShape)) return field;
  const prefix = field.path;
  return {
    ...mapPreviewFieldPaths(
      field,
      (path) =>
        path === prefix || path.startsWith(prefix + '.') || path.startsWith(prefix + '[]')
          ? prefix + '.value' + path.slice(prefix.length)
          : path,
      (path) => path
    ),
    metadata: undefined
  };
}
