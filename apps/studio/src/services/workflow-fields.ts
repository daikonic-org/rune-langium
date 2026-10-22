// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  makeNodeId,
  splitNodeId,
  NODE_TYPE_TO_AST_TYPE,
  typeChipKind,
  type TypeOption,
  type TypeChipKind
} from '@rune-langium/visual-editor';
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
    const [declaredKind, declaredTarget] = expanded.typeSymbol?.split(':', 2) ?? [];
    return {
      ...schema,
      kind: declaredKind === 'choice' || declaredKind === 'typeAlias' ? declaredKind : 'data',
      title: field.label,
      targetId:
        expanded.kind === 'object'
          ? (declaredTarget ?? expanded.referencedTypeFqn ?? schema.targetId)
          : schema.targetId,
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

/** Preserve the generator's canonical kind when choosing the shared chip palette. */
export const workflowFieldChipKind = withInstrumentation(
  function workflowFieldChipKind(field: PreviewField): TypeChipKind {
    const item = field.kind === 'array' ? field.children[0] : field;
    const kind = item.typeSymbol?.split(':')[0] as TypeOption['kind'] | undefined;
    return typeChipKind(kind ?? (item.kind === 'object' ? 'data' : item.kind === 'enum' ? 'enum' : 'builtin'));
  },
  { op: 'workflowFieldChipKind', sanitize: () => '[workflow type]' }
);

/** Preview symbols retain kind so a same-name function can never capture a type link. */
export const workflowFieldNodeId = withInstrumentation(
  function workflowFieldNodeId(field: PreviewField): string | undefined {
    const item = field.kind === 'array' ? field.children[0] : field;
    const [kind, target] = item.typeSymbol?.split(':', 2) ?? [];
    const astKind = kind ? NODE_TYPE_TO_AST_TYPE[kind] : undefined;
    if (!target || !astKind) return undefined;
    const { namespace, name } = splitNodeId(target);
    return makeNodeId(namespace, name, astKind);
  },
  { op: 'workflowFieldNodeId', capture: 0 }
);

export const workflowSchemaNodeId = withInstrumentation(
  function workflowSchemaNodeId(schema: FormPreviewSchema): string | undefined {
    const astKind = NODE_TYPE_TO_AST_TYPE[schema.kind === 'function' ? 'func' : (schema.kind ?? 'data')];
    if (!astKind) return undefined;
    const { namespace, name } = splitNodeId(schema.targetId);
    return makeNodeId(namespace, name, astKind);
  },
  { op: 'workflowSchemaNodeId', capture: 0 }
);
