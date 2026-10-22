// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { FormPreviewSchema, PreviewField } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';

// Every export below operates on the user's own model field paths/labels
// (PreviewField.path/label, derived from the .rune types the user
// authored) — none of it is curated/structural data safe to capture.
// capture:0 (duration/errors only) throughout this file.

export const fieldRootKey = withInstrumentation(
  function fieldRootKey(path: string): string {
    return path.split('.')[0]!.split('[]').join('');
  },
  { op: 'fieldRootKey' }
);

export const fieldLeafKey = withInstrumentation(
  function fieldLeafKey(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1]!.split('[]').join('');
  },
  { op: 'fieldLeafKey' }
);

export const resolveArmPaths = withInstrumentation(
  function resolveArmPaths(schema: {
    kind?: FormPreviewSchema['kind'];
    fields: PreviewField[];
    choiceArmPaths?: string[];
  }): string[] | undefined {
    return schema.kind === 'choice' ? schema.fields.map((field) => field.path) : schema.choiceArmPaths;
  },
  { op: 'resolveArmPaths' }
);

export const splitChoiceArmFields = withInstrumentation(
  function splitChoiceArmFields(
    fields: PreviewField[],
    armPaths: string[] | undefined
  ): { armFields: PreviewField[]; otherFields: PreviewField[] } {
    if (!armPaths || armPaths.length === 0) {
      return { armFields: [], otherFields: fields };
    }
    const armPathSet = new Set(armPaths);
    return {
      armFields: fields.filter((field) => armPathSet.has(field.path)),
      otherFields: fields.filter((field) => !armPathSet.has(field.path))
    };
  },
  { op: 'splitChoiceArmFields' }
);

export const buildDefaultValue = withInstrumentation(
  function buildDefaultValue(field: PreviewField): unknown {
    if (field.kind === 'string' && field.format && !field.required) return undefined;
    switch (field.kind) {
      case 'boolean':
        return false;
      case 'enum':
        return field.required ? (field.enumValues?.[0]?.value ?? '') : undefined;
      case 'object':
        return field.required
          ? buildDefaultFieldsObject(field.children ?? [], field.choiceArmPaths, fieldLeafKey)
          : undefined;
      case 'array':
        return [];
      default:
        return '';
    }
  },
  { op: 'buildDefaultValue' }
);

export const buildDefaultObjectValue = withInstrumentation(
  function buildDefaultObjectValue(field: PreviewField): Record<string, unknown> {
    if (field.kind !== 'object') return {};
    return buildDefaultFieldsObject(field.children ?? [], field.choiceArmPaths, fieldLeafKey);
  },
  { op: 'buildDefaultObjectValue' }
);

export const buildArmValue = withInstrumentation(
  function buildArmValue(arm: PreviewField): unknown {
    // Choice arms are optional as fields, but the selected arm needs a value.
    return arm.kind === 'object' ? buildDefaultObjectValue(arm) : buildDefaultValue({ ...arm, required: true });
  },
  { op: 'buildArmValue' }
);

export const buildDefaultFieldsObject = withInstrumentation(
  function buildDefaultFieldsObject(
    fields: PreviewField[],
    armPaths: string[] | undefined,
    keyFn: (path: string) => string
  ): Record<string, unknown> {
    const { armFields, otherFields } = splitChoiceArmFields(fields, armPaths);
    const entries: Array<[string, unknown]> = otherFields.map((field) => [keyFn(field.path), buildDefaultValue(field)]);
    const [firstArm] = armFields;
    if (firstArm) {
      entries.push([keyFn(firstArm.path), buildArmValue(firstArm)]);
    }
    return Object.fromEntries(entries);
  },
  { op: 'buildDefaultFieldsObject' }
);

export const buildDefaultValues = withInstrumentation(
  function buildDefaultValues(fields: PreviewField[], armPaths?: string[]): Record<string, unknown> {
    return buildDefaultFieldsObject(fields, armPaths, fieldRootKey);
  },
  { op: 'buildDefaultValues' }
);
