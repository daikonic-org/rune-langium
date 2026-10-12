// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * `$type` → generated Zod schema registry.
 *
 * Shared by the corpus invariant gate (every dehydrated corpus node must
 * `safeParse` against its own `$type`'s schema — the schemas-never-reject-
 * parser-output invariant) and the render gate (`cst-reuse-renderer`'s
 * schema-driven structural-render-vs-CST-fallback decision).
 *
 * Keys cover every `$type` render-core's `renderNode` dispatches on
 * (`rosetta-render-core.ts`) plus the top-level `$type`s the VE's
 * `astToModel` adapter recognizes — the union of both consumers' needs.
 * Completeness against the renderer's dispatch set is enforced by
 * `test/serialize/schema-by-type-exhaustiveness.test.ts`.
 *
 * @module
 */

import type { z } from 'zod';
import * as generated from '../generated/zod-schemas.js';

/** Every `$type` this map keys, in the order render-core's dispatcher checks them. */
export const RENDERER_HANDLED_TYPES = [
  'Schema',
  'Data',
  'Attribute',
  'Choice',
  'ChoiceOption',
  'RosettaEnumeration',
  'RosettaEnumValue',
  'Condition',
  'RosettaFunction',
  'Operation',
  'ShortcutDeclaration',
  'RosettaTypeAlias',
  'TypeParameter',
  'AnnotationRef',
  'RosettaClassSynonym',
  'RosettaSynonym',
  'RosettaEnumSynonym'
] as const;

const SCHEMA_TYPES = [...RENDERER_HANDLED_TYPES, 'RosettaRecordType', 'RosettaBasicType', 'Annotation'] as const;

function schemasByType(schemas: typeof generated): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(SCHEMA_TYPES.map((type) => [type, schemas[`${type}Schema`]]));
}

/** `$type` → generated schema, covering every renderer-handled type and every top-level type. */
export const SCHEMA_BY_TYPE = schemasByType(generated);

// The render gate holds this registry by reference. Refresh its entries without
// invalidating the source-sync and workspace state that consume it.
// Node/Workers consumers also load this React-free registry; HMR is an optional host extension.
type HotImportMeta = ImportMeta & { hot?: { accept(path: string, callback: (schemas: unknown) => void): void } };
if ((import.meta as HotImportMeta).hot) {
  (import.meta as HotImportMeta).hot!.accept('../generated/zod-schemas.js', (schemas: unknown) => {
    if (schemas) Object.assign(SCHEMA_BY_TYPE, schemasByType(schemas as typeof generated));
  });
}
