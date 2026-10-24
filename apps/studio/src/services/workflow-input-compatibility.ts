// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { FormPreviewSchema, PreviewField } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';
/** Retain only the same parameter and canonical element type across schema changes. */
export const retainedWorkflowFields = withInstrumentation(
  function retainedWorkflowFields(before: FormPreviewSchema, after: FormPreviewSchema): PreviewField[] {
    return after.fields.filter((field) =>
      before.fields.some((old) => {
        if (old.path !== field.path || old.kind !== field.kind) return false;
        const a = old.kind === 'array' ? old.children[0] : old;
        const b = field.kind === 'array' ? field.children[0] : field;
        return !!a && !!b && a.kind === b.kind && a.typeSymbol === b.typeSymbol;
      })
    );
  },
  { op: 'retainedWorkflowFields', capture: 0 }
);
