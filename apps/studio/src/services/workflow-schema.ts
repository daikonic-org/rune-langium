// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useCallback, useEffect, useState } from 'react';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { usePreviewSessionFactory } from '../shell/providers/preview-session-context.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { withInstrumentation } from './instrumentation/core.js';

export const useWorkflowSchema = withInstrumentation(
  function useWorkflowSchema(target: string | undefined): {
    schema?: FormPreviewSchema;
    error?: string;
    retry(): void;
  } {
    const factory = usePreviewSessionFactory(),
      models = useWorkspaceOptional()?.models;
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    const [result, setResult] = useState<{
      target: string;
      factory: typeof factory;
      models: typeof models;
      attempt: number;
      schema?: FormPreviewSchema;
      error?: string;
    }>();
    useEffect(() => {
      if (!target || !factory) return;
      const client = factory(),
        controller = new AbortController();
      void client.schema(target, controller.signal).then(
        (schema) => {
          if (!controller.signal.aborted) setResult({ target, factory, models, attempt, schema });
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult({
              target,
              factory,
              models,
              attempt,
              error: error instanceof Error ? error.message : String(error)
            });
        }
      );
      return () => {
        controller.abort();
        client.dispose();
      };
    }, [target, factory, models, attempt]);
    return result &&
      result.target === target &&
      result.factory === factory &&
      result.models === models &&
      result.attempt === attempt
      ? { schema: result.schema, error: result.error, retry }
      : { retry };
  },
  {
    op: 'useWorkflowSchema',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
