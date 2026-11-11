// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core/project-contract';
import {
  createRuneDslServices,
  isRosettaFunction,
  namespaceFromModelName,
  type RosettaModel
} from '@rune-langium/core';
import { renderWorkflowFunction, type WorkflowFunctionDefinition } from '@rune-langium/codegen/rosetta';
import {
  canonicalProjectJson,
  portableRecordRoot,
  projectFileRevision,
  normalizeProjectPath,
  isIgnoredProjectEntry,
  projectSourcePaths,
  readWorkflows,
  readPresentations,
  WorkflowDescriptorSchema,
  PresentationDescriptorSchema,
  type WorkflowDescriptor,
  type PresentationDescriptor,
  type ProjectSnapshot,
  type ProjectChange,
  type ProjectSavePreconditions
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
  existing: { path: string }[],
  changes: readonly ProjectChange[] = [],
  preconditions?: ProjectSavePreconditions
) {
  if (existing.length > 1) throw new Error('Repair duplicate descriptor identities before saving.');
  const directory = portableRecordRoot(current, root);
  if (!directory) throw new Error('Configure a portable descriptor directory outside private storage.');
  const path = existing[0]?.path ?? directory + '/' + (await projectFileRevision(identity)) + extension;
  if (!existing.length && current.files.has(path))
    throw new Error('An unmanaged file owns this descriptor destination.');
  const configuration = await projectConfigurationPreconditions(current);
  return controller.save(
    [
      ...changes,
      { path, text: JSON.stringify(value, null, 2) + '\n', expectedRevision: await projectRevisionAt(current, path) }
    ],
    { ...preconditions, inputs: [...(preconditions?.inputs ?? []), ...(configuration.inputs ?? [])] }
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

/** Create source and its runnable recipe in one repository transaction. Never overwrites source. */
export const saveWorkflowFunction = withInstrumentation(
  async function saveWorkflowFunction(
    controller: ProjectController,
    input: { definition: WorkflowFunctionDefinition; path: string; id: string }
  ): Promise<{ snapshot: ProjectSnapshot; workflow: WorkflowDescriptor }> {
    const text = renderWorkflowFunction(input.definition);
    const current = await snapshot(controller);
    const path = normalizeProjectPath(input.path);
    if (!path?.endsWith('.rosetta') || path.split('/').some(isIgnoredProjectEntry))
      throw new Error('Choose a project-relative .rosetta source path outside private storage.');
    if ([...current.files.keys()].some((existing) => existing.toLowerCase() === path.toLowerCase()))
      throw new Error('That source file already exists. Choose another path or edit the existing file.');
    const files = new Map(current.files).set(path, text);
    const sources = projectSourcePaths(files, current.project.build.sources);
    if (!sources.includes(path)) throw new Error('This path is not included by the project source patterns.');
    const parser = createRuneDslServices().RuneDsl.parser.LangiumParser;
    for (const source of sources) {
      if (source === path) continue;
      const model = parser.parse<RosettaModel>(files.get(source)!).value;
      if (
        namespaceFromModelName(model.name) === input.definition.namespace &&
        model.elements.some((element) => isRosettaFunction(element) && element.name === input.definition.name)
      )
        throw new Error('A function with this name already exists in that namespace.');
    }
    const workflow = WorkflowDescriptorSchema.parse({
      schemaVersion: 1,
      id: input.id,
      name: input.definition.name,
      function: {
        model: 'local',
        namespace: input.definition.namespace,
        kind: 'RosettaFunction',
        name: input.definition.name
      },
      inputs: {},
      outputs: { [input.definition.output.name]: { name: input.definition.output.name } }
    });
    if (readWorkflows(current).workflows.some((entry) => entry.id === workflow.id))
      throw new Error('This workflow identity already exists. Create a new workflow.');
    const saved = await saveDescriptor(
      controller,
      current,
      'workflows',
      workflow.id,
      '.workflow.json',
      workflow,
      [],
      [{ path, text, expectedRevision: null }],
      {
        paths: [...current.files.keys()],
        inputs: await Promise.all(
          sources
            .filter((source) => source !== path)
            .map(async (source) => ({
              path: source,
              revision: await projectRevisionAt(current, source)
            }))
        )
      }
    );
    return { snapshot: saved, workflow };
  },
  {
    op: 'saveWorkflowFunction',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
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
