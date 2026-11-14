// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  WorkflowPreparationSchema,
  WorkflowPreparedSourcesSchema,
  canonicalProjectJson,
  createProjectDraftSnapshot,
  projectFileRevision,
  projectSourcePaths,
  isIgnoredProjectEntry,
  type WorkflowPreparation,
  type ProjectSnapshot
} from '@rune-langium/project-config';
import { createProjectResolutionContext, projectSourceUri } from '@rune-langium/project-runtime/context';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import { PreparationRequest, assertExecutionJson, type PreparationResult } from '@rune-langium/worker-core/execution';
import { URI } from 'langium';
import { prepareHostedDatabase } from './database-preparation.js';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import type { ProjectController } from '../workspace/project-controller.js';
import { projectConfigurationPreconditions, projectRevisionAt } from '../workspace/project-save-inputs.js';
import { withInstrumentation } from './instrumentation/core.js';

export interface PreparedWorkflowData {
  base: ProjectSnapshot;
  project: ProjectRuntimeInput;
  sources: Readonly<Record<string, string>>;
  receipt: Omit<PreparationResult, 'value'> & {
    driverRevision: string;
    moduleRevision: string;
    sourceRevisions: Record<string, string>;
  };
}

/** Prepare immutable, per-run overrides; only an explicit Save can alter the workspace. */
export const prepareWorkflowData = withInstrumentation(
  async function prepareWorkflowData(
    runtime: ProjectRuntimeInput,
    config: WorkflowPreparation,
    inputs: Record<string, unknown>,
    options: { token: string; signal: AbortSignal; isCurrent(): boolean; prepare?: typeof prepareHostedDatabase }
  ): Promise<PreparedWorkflowData> {
    const current = () => {
      options.signal.throwIfAborted();
      if (!options.isCurrent()) throw new Error('Project changed while preparing data. Execute again.');
    };
    current();
    const preparation = WorkflowPreparationSchema.parse(config);
    const input = { inputs, parameters: preparation.parameters ?? {} };
    assertExecutionJson(input);
    const base = runtime.snapshot;
    const code = base.files.get(preparation.module),
      driver = base.files.get(preparation.driver);
    if (!code || !driver) throw new Error('The preparation module or pinned database driver is missing.');
    const allowed = new Set(
      projectSourcePaths(
        new Map(preparation.outputs.map((path): [string, string] => [path, ''])),
        base.project.build.sources
      )
    );
    if (preparation.outputs.some((path) => !allowed.has(path) || path.split('/').some(isIgnoredProjectEntry)))
      throw new Error('Prepared outputs must be writable Rune sources selected by this project.');
    const [driverRevision, moduleRevision] = await Promise.all([
      projectFileRevision(driver),
      projectFileRevision(code)
    ]);
    const projectRevision = await projectFileRevision(
      canonicalProjectJson({
        project: runtime.receipt,
        preparation,
        driverRevision,
        moduleRevision,
        inputs
      })
    );
    current();
    const request = PreparationRequest.parse({
      schemaVersion: 1,
      projectRevision,
      driverRevision,
      code,
      input
    });
    const result = await (options.prepare ?? prepareHostedDatabase)(request, {
      token: options.token,
      signal: options.signal
    });
    current();
    if (result.projectRevision !== projectRevision) throw new Error('Preparation receipt differs from this run.');
    const { sources } = WorkflowPreparedSourcesSchema.parse(result.value);
    if (
      Object.keys(sources).length !== preparation.outputs.length ||
      Object.keys(sources).some((path) => !allowed.has(path))
    )
      throw new Error('Preparation must return exactly its declared Rune output paths.');
    const snapshot = await createProjectDraftSnapshot(base, new Map(Object.entries(sources)), validateProjectTarget);
    const models = { ...runtime.resolution.models };
    for (const path of preparation.outputs) models[URI.parse(projectSourceUri(path)).toString()] = 'local';
    const resolution = await createProjectResolutionContext(snapshot, models);
    const sourceRevisions = Object.fromEntries(
      await Promise.all(
        Object.entries(sources).map(async ([path, text]): Promise<[string, string]> => [
          path,
          await projectFileRevision(text)
        ])
      )
    );
    current();
    return {
      base,
      sources,
      project: { ...runtime, snapshot, resolution, receipt: resolution.receipt },
      receipt: {
        schemaVersion: 1,
        projectRevision,
        executionId: result.executionId,
        queryCount: result.queryCount,
        driverRevision,
        moduleRevision,
        sourceRevisions
      }
    };
  },
  {
    op: 'prepareWorkflowData',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);

/** Reuse the project transaction's compare-and-swap and rollback; never write from a late run. */
export const savePreparedWorkflowData = withInstrumentation(
  async function savePreparedWorkflowData(
    controller: ProjectController,
    prepared: PreparedWorkflowData,
    isCurrent: () => boolean
  ) {
    if (
      !isCurrent() ||
      controller.current()?.workspaceId !== prepared.base.workspaceId ||
      controller.current()?.revision !== prepared.base.revision
    )
      throw new Error('Save source edits and execute again before saving prepared data.');
    const destinations = Object.keys(prepared.sources);
    const first = destinations[0];
    if (!first) throw new Error('No prepared sources are available.');
    const receiptPath = first + '.' + prepared.receipt.executionId + '.preparation.json';
    if (prepared.base.files.has(receiptPath))
      throw new Error('This execution receipt already exists. Execute again before saving.');
    const texts = new Map(Object.entries(prepared.sources));
    texts.set(receiptPath, JSON.stringify(prepared.receipt, null, 2) + '\n');
    const writes = await Promise.all(
      [...texts].map(async ([path, text]) => ({
        path,
        text,
        expectedRevision: await projectRevisionAt(prepared.base, path)
      }))
    );
    const written = new Set(writes.map((write) => write.path));
    const configuration = await projectConfigurationPreconditions(prepared.base, [...written]);
    if (!isCurrent()) throw new Error('The prepared run is no longer current.');
    const inputs = new Map<string, string | null>(
      [...prepared.base.fileRevisions].filter(([path]) => !written.has(path))
    );
    for (const input of configuration.inputs ?? []) inputs.set(input.path, input.revision);
    return controller.save(writes, {
      paths: [...prepared.base.files.keys()],
      inputs: [...inputs].map(([path, revision]) => ({ path, revision }))
    });
  },
  {
    op: 'savePreparedWorkflowData',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
