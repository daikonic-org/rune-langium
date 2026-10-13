// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Typed configuration for `@zod-to-form` against the langium-generated
 * AST schemas in `src/generated/zod-schemas.ts`.
 *
 * Per the corrected R1 (`specs/013-z2f-editor-migration/research.md`),
 * the AST schemas are the canonical source of truth for form validation.
 * AST-only fields ($type discriminators, container metadata, references,
 * labels, ruleReferences, postConditions, enumSynonyms, etc.) are marked
 * `hidden: true`. The `@zod-to-form` L1/L2 optimisers strip hidden fields
 * from the schema-lite produced at validation time, so RHF's resolver
 * never sees them — they remain in the AST schema's static shape but
 * cost nothing at runtime.
 *
 * Per R11, editors consume the AST graph node directly — there is no
 * projection layer. `useZodForm(Schema, { defaultValues: node })` accepts
 * the graph node unchanged because every form-driving AST schema is a
 * `z.looseObject`.
 */

import { defineConfig } from '@zod-to-form/core';
import { editorSectionFields } from './src/components/forms/sections/config.js';

import type * as Components from './src/components/zod-form-components.js';
import type * as ZodSchemas from './src/generated/zod-schemas.js';

export default defineConfig<typeof Components, typeof ZodSchemas>({
  components: {
    source: '@/components/zod-form-components',
    fieldTemplate: '@/components/zod-field-template',
    overrides: {
      CardinalitySelector: { controlled: true, props: { value: 'field.value', onChange: 'field.onChange' } },
      Input: {},
      Select: { controlled: true, props: { value: 'field.value', onChange: 'field.onChange' } },
      Textarea: {},
      TypeSelector: { controlled: true, props: { value: 'field.value', onChange: 'field.onChange' } }
    }
  },
  defaults: {
    mode: 'auto-save',
    ui: 'shadcn',
    optimization: { compileZod: false },
    overwrite: true,
    serverAction: false
  },
  include: [
    'DataSchema',
    'RosettaEnumerationSchema',
    'ChoiceSchema',
    'RosettaFunctionSchema',
    'RosettaTypeAliasSchema'
  ],
  exclude: [],
  fields: {
    ...editorSectionFields,
    comments: { hidden: true },
    // --- Global field mappings (apply across all schemas) ---

    // Cross-reference fields → TypeSelector
    parent: { component: 'TypeSelector' },
    superType: { component: 'TypeSelector' },
    'attributes[].typeCall.type': { component: 'TypeSelector' },
    'typeCall.type': { component: 'TypeSelector' },
    'inputs[].typeCall.type': { component: 'TypeSelector' },
    'output.typeCall.type': { component: 'TypeSelector' },

    // Cardinality fields → CardinalitySelector
    'attributes[].card': { component: 'CardinalitySelector' },
    'inputs[].card': { component: 'CardinalitySelector' },
    'output.card': { component: 'CardinalitySelector' },

    // Note: top-level `definition` is rendered via MetadataSection (declared
    // in the shared section config). Per-row definition (`attributes[].definition`,
    // `enumValues[].definition`, etc.) is mapped to Textarea via the
    // per-schema overrides further down.

    // --- Hidden fields (AST-only; L1/L2 strips from schema-lite) -------

    // $type discriminators — internal, never user-editable
    $type: { hidden: true },
    'attributes[].$type': { hidden: true },
    'attributes[].typeCall.$type': { hidden: true },
    'attributes[].typeCall.arguments': { hidden: true },
    'enumValues[].$type': { hidden: true },
    'inputs[].$type': { hidden: true },
    'inputs[].typeCall.$type': { hidden: true },
    'inputs[].typeCall.arguments': { hidden: true },
    'typeCall.$type': { hidden: true },
    'output.$type': { hidden: true },

    // Annotations — rendered by AnnotationSection (Phase 7 / US5)
    // Nested annotations stay hidden — owned by their parent row, not the
    // top-level section.
    'attributes[].annotations': { hidden: true },
    'enumValues[].annotations': { hidden: true },

    // Nested synonyms stay hidden — owned by their parent row.
    'attributes[].synonyms': { hidden: true },
    'enumValues[].enumSynonyms': { hidden: true },

    // References — not user-editable in forms
    references: { hidden: true },
    'attributes[].references': { hidden: true },
    'enumValues[].references': { hidden: true },

    // Labels & rule references — not user-editable in forms
    'attributes[].labels': { hidden: true },
    'attributes[].ruleReferences': { hidden: true }
  },
  schemas: {
    // --- Per-schema field overrides ---

    DataSchema: {
      fields: {
        // Attributes list: member rows with name, type, cardinality
        // Per R5: declarative reorder ON. The native-DnD gesture surface in
        // `AttributeRow.tsx` remains the gesture provider (drag handle, drop
        // handlers); when Phase 8 (US6) promotes the array to z2f-driven
        // rendering, this flag mounts the upstream `<ArrayReorderHandle>`
        // and routes form-state mutations through `useFieldArray.move`.
        // No `onReorder` callback at config time — Pattern B per R5: the
        // row's `handleDrop` continues to fire `actions.reorderAttribute`.
        attributes: { arrayConfig: { reorder: true } },
        'attributes[].name': { component: 'Input', order: 1 },
        'attributes[].typeCall.type': { component: 'TypeSelector', order: 2 },
        'attributes[].card': { component: 'CardinalitySelector', order: 3 },
        'attributes[].override': { hidden: true },
        'attributes[].definition': { component: 'Textarea', props: { rows: 2 }, order: 4 }
      }
    },

    ChoiceSchema: {
      fields: {
        // Choice options: name + type reference
        'attributes[].name': { hidden: true },
        'attributes[].typeCall.type': { component: 'TypeSelector', order: 1 },
        'attributes[].definition': { component: 'Textarea', props: { rows: 2 }, order: 2 }
      }
    },

    RosettaEnumerationSchema: {
      fields: {
        // Enum values: name + display name
        'enumValues[].name': { component: 'Input', order: 1 },
        'enumValues[].display': { component: 'Input', order: 2 },
        'enumValues[].definition': { component: 'Textarea', props: { rows: 2 }, order: 3 }
      }
    },

    RosettaFunctionSchema: {
      fields: {
        // Input params: name + type + cardinality
        'inputs[].name': { component: 'Input', order: 1 },
        'inputs[].typeCall.type': { component: 'TypeSelector', order: 2 },
        'inputs[].card': { component: 'CardinalitySelector', order: 3 },
        // Output: type + cardinality
        'output.name': { hidden: true },
        'output.typeCall': { component: 'TypeSelector', order: 1 },
        'output.card': { component: 'CardinalitySelector', order: 2 },
        // Shortcuts — not user-editable in generated form
        shortcuts: { hidden: true }
      }
    },

    RosettaTypeAliasSchema: {
      fields: {
        // TypeAlias: wrapped type reference
        'typeCall.type': { component: 'TypeSelector', order: 1 },
        'typeCall.arguments': { hidden: true }
      }
    }
  }
});
