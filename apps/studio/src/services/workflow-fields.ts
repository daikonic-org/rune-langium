// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expandPreviewField, type FormPreviewSchema, type PreviewField } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';

export const workflowFieldType = withInstrumentation(
  function workflowFieldType(field: PreviewField): string {
    const item = field.kind === 'array' ? field.children[0] : field;
    const type =
      item.typeSymbol?.split('#')[0]?.split(':').slice(-1)[0] ??
      (item.kind === 'object' ? item.referencedTypeFqn : undefined) ??
      item.kind;
    return `${type.split('.').slice(-1)[0]}${field.kind === 'array' ? '[]' : ''}`;
  },
  {
    op: 'workflowFieldType',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const workflowFieldSchema = withInstrumentation(
  function workflowFieldSchema(schema: FormPreviewSchema, field: PreviewField): FormPreviewSchema {
    const expanded = expandPreviewField(field, schema.definitions);
    return {
      ...schema,
      kind: 'data',
      title: field.label,
      targetId: expanded.kind === 'object' ? (expanded.referencedTypeFqn ?? schema.targetId) : schema.targetId,
      fields: expanded.kind === 'object' ? expanded.children : [expanded],
      choiceArmPaths: expanded.kind === 'object' ? expanded.choiceArmPaths : undefined
    };
  },
  {
    op: 'workflowFieldSchema',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
