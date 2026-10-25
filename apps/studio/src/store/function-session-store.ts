// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { makeNodeId, splitNodeId } from '@rune-langium/visual-editor/identifiers';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import { buildDefaultValues, resolveArmPaths } from '../services/preview-validator.js';
import type { PreviewSessionClient } from '../services/preview-session-client.js';
import { retainedWorkflowFields } from '../services/workflow-input-compatibility.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface FunctionSessionState {
  functionFqn: string | null;
  boundParameter: string | null;
  inputs: Record<string, unknown>;
  result: unknown;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  error?: string;
  schema?: FormPreviewSchema;
  schemaStatus?: 'loading' | 'ready' | 'unavailable';
}

export interface FunctionSession {
  getState(): FunctionSessionState;
  subscribe(listener: () => void): () => void;
  selectFunction(fqn: string | null, schemaTargetId?: string): Promise<void>;
  setInput(name: string, value: unknown): void;
  setInputs(inputs: Record<string, unknown>): void;
  bindInstance(parameter: string, record: InstanceRecord): void;
  run(): Promise<void>;
  dispose(): void;
}

const INITIAL_STATE: FunctionSessionState = {
  functionFqn: null,
  boundParameter: null,
  inputs: {},
  result: undefined,
  status: 'idle'
};

export const createFunctionSession = withInstrumentation(
  function createFunctionSession(client: PreviewSessionClient): FunctionSession {
    let state = INITIAL_STATE;
    let disposed = false;
    let selectionVersion = 0;
    let executionVersion = 0;
    let activeController: AbortController | undefined;
    let loadingSchema = false;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    const patch = (next: Partial<FunctionSessionState>) => {
      state = { ...state, ...next };
      notify();
    };

    return {
      getState: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async selectFunction(fqn, schemaTargetId) {
        const version = ++selectionVersion;
        ++executionVersion;
        activeController?.abort();
        if (!fqn) {
          loadingSchema = false;
          patch({ ...INITIAL_STATE, schema: undefined, schemaStatus: undefined, error: undefined });
          return;
        }
        const controller = new AbortController();
        activeController = controller;
        const previousSchema = state.functionFqn === fqn ? state.schema : undefined;
        loadingSchema = true;
        patch({
          functionFqn: fqn,
          boundParameter: previousSchema ? state.boundParameter : null,
          inputs: previousSchema ? state.inputs : {},
          result: undefined,
          status: 'running',
          error: undefined,
          schema: previousSchema,
          schemaStatus: 'loading'
        });
        try {
          const { namespace, name } = splitNodeId(schemaTargetId ?? fqn);
          const schema = await client.schema(makeNodeId(namespace, name, 'RosettaFunction'), controller.signal);
          if (disposed || version !== selectionVersion) return;
          const defaults = buildDefaultValues(schema.fields, resolveArmPaths(schema));
          const retained = previousSchema
            ? Object.fromEntries(
                retainedWorkflowFields(previousSchema, schema).map((field) => [field.path, state.inputs[field.path]])
              )
            : {};
          loadingSchema = false;
          patch({ schema, schemaStatus: 'ready', inputs: { ...defaults, ...retained }, status: 'idle' });
        } catch (error) {
          if (disposed || version !== selectionVersion || controller.signal.aborted) return;
          loadingSchema = false;
          patch({
            status: 'failed',
            schemaStatus: 'unavailable',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },
      setInput(name, value) {
        ++executionVersion;
        if (!loadingSchema) activeController?.abort();
        patch({
          inputs: { ...state.inputs, [name]: structuredClone(value) },
          result: undefined,
          status: loadingSchema ? 'running' : state.schemaStatus === 'unavailable' ? 'failed' : 'idle',
          error: state.schemaStatus === 'unavailable' ? state.error : undefined
        });
      },
      setInputs(inputs) {
        ++executionVersion;
        if (!loadingSchema) activeController?.abort();
        patch({
          inputs: structuredClone(inputs),
          result: undefined,
          status: loadingSchema ? 'running' : state.schemaStatus === 'unavailable' ? 'failed' : 'idle',
          error: state.schemaStatus === 'unavailable' ? state.error : undefined
        });
      },
      bindInstance(parameter, record) {
        const field = state.schema?.fields.find((candidate) => candidate.path === parameter);
        const value = field?.kind === 'array' ? [record.data] : record.data;
        ++executionVersion;
        if (!loadingSchema) activeController?.abort();
        patch({
          boundParameter: parameter,
          inputs: { ...state.inputs, [parameter]: structuredClone(value) },
          result: undefined,
          status: loadingSchema ? 'running' : state.schemaStatus === 'unavailable' ? 'failed' : 'idle',
          error: state.schemaStatus === 'unavailable' ? state.error : undefined
        });
      },
      async run() {
        if (!state.functionFqn || state.status === 'running' || state.schemaStatus === 'unavailable' || loadingSchema)
          return;
        if (state.schema?.executionUnavailable) {
          patch({ status: 'failed', result: undefined, error: state.schema.executionUnavailable });
          return;
        }
        const version = selectionVersion;
        const execution = ++executionVersion;
        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        const inputs = structuredClone(state.inputs);
        patch({ status: 'running', result: undefined, error: undefined });
        try {
          const result = await client.execute(state.functionFqn, inputs, controller.signal);
          if (disposed || version !== selectionVersion || execution !== executionVersion) return;
          patch({ result, status: 'succeeded' });
        } catch (error) {
          if (disposed || version !== selectionVersion || execution !== executionVersion || controller.signal.aborted)
            return;
          patch({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        activeController?.abort();
        listeners.clear();
        client.dispose();
      }
    };
  },
  { op: 'createFunctionSession' }
);
