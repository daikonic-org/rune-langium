// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { FieldConfig } from '@zod-to-form/core';

/** Shared placement for canonical metadata and condition constructs. */
export const editorSections = new Map([
  ['AnnotationSection', ['annotations']],
  ['ConditionSection', ['conditions', 'postConditions']],
  ['MetadataSection', ['definition', 'display', 'synonyms', 'enumSynonyms']]
]);

/** Generated forms consume the same section assignments as the Inspector. */
export const editorSectionFields: Record<string, FieldConfig> = Object.fromEntries(
  Array.from(editorSections, ([section, fields]) => fields.map((field) => [field, { section }])).flat()
);
