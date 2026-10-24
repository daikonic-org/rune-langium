// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { declarationKey } from '@rune-langium/core/project-contract';
import { SymbolIdentitySchema } from './config-schema.js';
import { readExamples } from './examples.js';
import { readPortableRecords } from './portable-records.js';
import type { ProjectSnapshot } from './types.js';
const text = z.string().min(1);
export const WorkflowBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('example'), exampleId: text }),
  z.strictObject({ kind: z.literal('literal'), value: z.json() })
]);
export type WorkflowBinding = z.infer<typeof WorkflowBindingSchema>;
export const WorkflowDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: text.max(200),
  name: text,
  function: SymbolIdentitySchema.optional(),
  inputs: z.record(text, WorkflowBindingSchema),
  outputs: z.record(text, z.strictObject({ name: text, type: SymbolIdentitySchema.optional() }))
});
export type WorkflowDescriptor = z.infer<typeof WorkflowDescriptorSchema>;
export function readWorkflows(snapshot: ProjectSnapshot, knownSymbols?: ReadonlySet<string>) {
  const read = readPortableRecords(snapshot, {
    root: 'workflows',
    extension: '.workflow.json',
    prefix: 'WORKFLOW',
    parse: (value) => WorkflowDescriptorSchema.parse(value)
  });
  const examples = readExamples(snapshot);
  const ids = new Set<string>();
  for (const { path, value } of read.documents) {
    const issue = (code: string, message: string) => read.diagnostics.push({ code, path, message, severity: 'error' });
    if (ids.has(value.id)) issue('WORKFLOW_DUPLICATE_ID', 'Workflow IDs must be unique. Both recipes are retained.');
    ids.add(value.id);
    const missing = knownSymbols
      ? [value.function, ...Object.values(value.outputs).map((output) => output.type)].filter(
          (symbol) => symbol && !knownSymbols.has(declarationKey(symbol))
        )
      : [];
    if (missing.length)
      issue(
        'WORKFLOW_SYMBOL_UNAVAILABLE',
        `Workflow symbols are unavailable: ${missing.map((symbol) => `${symbol!.namespace}.${symbol!.name} (${symbol!.kind}, ${symbol!.model})`).join(', ')}. Its recipe and bindings are retained.`
      );
    for (const binding of Object.values(value.inputs))
      if (binding.kind === 'example') {
        const matches = examples.documents.filter((entry) => entry.descriptor.id === binding.exampleId);
        if (
          matches.length !== 1 ||
          matches[0]!.payload === undefined ||
          (knownSymbols && !knownSymbols.has(declarationKey(matches[0]!.descriptor.type)))
        )
          issue(
            'WORKFLOW_EXAMPLE_UNAVAILABLE',
            'A bound example is missing, ambiguous or unavailable. Its binding is retained.'
          );
      }
  }
  return {
    workflows: read.documents.map((entry) => entry.value),
    documents: read.documents,
    diagnostics: read.diagnostics
  };
}
