// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useState } from 'react';
import type { ValidationDiagnostic } from '@rune-langium/codegen/instances';
import { useProject } from '../shell/providers/project-context.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { usePreviewSessionFactory } from '../shell/providers/preview-session-context.js';
import { withInstrumentation } from './instrumentation/core.js';

export interface WorkflowValidation {
  state: 'pending' | 'valid' | 'invalid' | 'unavailable' | 'unchecked';
  diagnostics: ValidationDiagnostic[];
  message?: string;
  retry?(): void;
}

export const workflowValidationRetry = withInstrumentation(
  function workflowValidationRetry(checks: readonly WorkflowValidation[]): (() => void) | undefined {
    const retries = [
      ...new Set(checks.flatMap((check) => (check.state === 'unavailable' && check.retry ? [check.retry] : [])))
    ];
    return retries.length ? () => retries.forEach((retry) => retry()) : undefined;
  },
  { op: 'workflowValidationRetry', sanitize: () => ({}) }
);

export const useWorkflowValidation = withInstrumentation(
  function useWorkflowValidation(
    target: string | undefined,
    data: Record<string, unknown>,
    functionInputs = false
  ): WorkflowValidation {
    const factory = usePreviewSessionFactory();
    const models = useWorkspaceOptional()?.models;
    const projectRevision = useProject().snapshot?.revision;
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    const [result, setResult] = useState<{
      target: string;
      data: unknown;
      factory: typeof factory;
      models: typeof models;
      functionInputs: boolean;
      attempt: number;
      projectRevision: string | undefined;
      value: WorkflowValidation;
    }>();
    useEffect(() => {
      if (!target || !factory) return;
      const client = factory();
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void client.validate(target, data, controller.signal, functionInputs).then(
          (diagnostics) => {
            if (!controller.signal.aborted)
              setResult({
                target,
                data,
                factory,
                models,
                functionInputs,
                attempt,
                projectRevision,
                value: { state: diagnostics.length ? 'invalid' : 'valid', diagnostics }
              });
          },
          (error) => {
            if (!controller.signal.aborted)
              setResult({
                target,
                data,
                factory,
                models,
                functionInputs,
                attempt,
                projectRevision,
                value: {
                  state: 'unavailable',
                  diagnostics: [],
                  message: error instanceof Error ? error.message : String(error)
                }
              });
          }
        );
      }, 120);
      return () => {
        clearTimeout(timer);
        controller.abort();
        client.dispose();
      };
    }, [target, data, factory, functionInputs, models, attempt, projectRevision]);
    if (!target) return { state: 'unchecked', diagnostics: [] };
    if (!factory) return { state: 'unavailable', diagnostics: [], message: 'Validation worker is preparing.' };
    return result?.target === target &&
      result.data === data &&
      result.factory === factory &&
      result.models === models &&
      result.functionInputs === functionInputs &&
      result.attempt === attempt &&
      result.projectRevision === projectRevision
      ? { ...result.value, retry }
      : { state: 'pending', diagnostics: [] };
  },
  {
    op: 'useWorkflowValidation',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
