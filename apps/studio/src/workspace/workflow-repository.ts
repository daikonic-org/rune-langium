// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core/project-contract';
import {
  canonicalProjectJson,
  portableRecordRoot,
  projectFileRevision,
  readWorkflows,
  readPresentations,
  WorkflowDescriptorSchema,
  PresentationDescriptorSchema,
  type WorkflowDescriptor,
  type PresentationDescriptor,
  type ProjectSnapshot
} from '@rune-langium/project-config';
import type { ProjectController } from './project-controller.js';
import { projectConfigurationPreconditions, projectRevisionAt } from './project-save-inputs.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
async function snapshot(controller: ProjectController) {
  return controller.diagnostics().some((issue) => ['SAVE_CONFLICT', 'SAVE_UNAVAILABLE'].includes(issue.code))
    ? controller.recover()
    : (controller.current() ?? controller.load());
}
async function saveDescriptor(
  controller: ProjectController,
  current: ProjectSnapshot,
  root: 'workflows' | 'layouts',
  identity: string,
  extension: string,
  value: unknown,
  existing: { path: string }[]
) {
  if (existing.length > 1) throw new Error('Repair duplicate descriptor identities before saving.');
  const directory = portableRecordRoot(current, root);
  if (!directory) throw new Error('Configure a portable descriptor directory outside private storage.');
  const path = existing[0]?.path ?? directory + '/' + (await projectFileRevision(identity)) + extension;
  if (!existing.length && current.files.has(path))
    throw new Error('An unmanaged file owns this descriptor destination.');
  return controller.save(
    [{ path, text: JSON.stringify(value, null, 2) + '\n', expectedRevision: await projectRevisionAt(current, path) }],
    await projectConfigurationPreconditions(current)
  );
}
export const saveWorkflow = withInstrumentation(
  async function saveWorkflow(controller: ProjectController, input: WorkflowDescriptor): Promise<ProjectSnapshot> {
    const value = WorkflowDescriptorSchema.parse(input);
    const current = await snapshot(controller);
    return saveDescriptor(
      controller,
      current,
      'workflows',
      value.id,
      '.workflow.json',
      value,
      readWorkflows(current).documents.filter((entry) => entry.value.id === value.id)
    );
  },
  { op: 'saveWorkflow', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);
export const savePresentation = withInstrumentation(
  async function savePresentation(
    controller: ProjectController,
    input: PresentationDescriptor
  ): Promise<ProjectSnapshot> {
    const value = PresentationDescriptorSchema.parse(input);
    const current = await snapshot(controller);
    const key = declarationKey(value.type);
    return saveDescriptor(
      controller,
      current,
      'layouts',
      key,
      '.layout.json',
      value,
      readPresentations(current).documents.filter((entry) => declarationKey(entry.value.type) === key)
    );
  },
  { op: 'savePresentation', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);

/** Bind unchanged stored examples; edited detached drafts become portable literals. */
export const captureWorkflowRecipe = withInstrumentation(
  function captureWorkflowRecipe(input: {
    id: string;
    name: string;
    function?: WorkflowDescriptor['function'];
    inputs: Record<string, unknown>;
    sourceIds?: Readonly<Record<string, string>>;
    records: Readonly<Record<string, import('@rune-langium/codegen/instances').InstanceRecord>>;
    outputs: WorkflowDescriptor['outputs'];
  }): WorkflowDescriptor {
    const inputs = Object.fromEntries(
      Object.entries(input.inputs)
        .filter(([, value]) => value !== undefined)
        .map(([path, value]) => {
          const id = input.sourceIds?.[path];
          const source = id ? input.records[id] : undefined;
          const encoded = canonicalProjectJson(value);
          const original = source && canonicalProjectJson(source.data);
          const unchanged =
            source &&
            (encoded === original ||
              (Array.isArray(value) && value.length === 1 && canonicalProjectJson(value[0]) === original));
          return [
            path,
            unchanged ? { kind: 'example', exampleId: source.id } : { kind: 'literal', value: JSON.parse(encoded) }
          ];
        })
    );
    return WorkflowDescriptorSchema.parse({
      schemaVersion: 1,
      id: input.id,
      name: input.name,
      ...(input.function ? { function: input.function } : {}),
      inputs,
      outputs: input.outputs
    });
  },
  {
    op: 'captureWorkflowRecipe',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
