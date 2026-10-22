// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useState } from 'react';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { usePreviewSessionFactory } from '../shell/providers/preview-session-context.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { withInstrumentation } from './instrumentation/core.js';

export const useWorkflowSchema = withInstrumentation(
  function useWorkflowSchema(target: string | undefined): { schema?: FormPreviewSchema; error?: string } | undefined {
    const factory = usePreviewSessionFactory(),
      models = useWorkspaceOptional()?.models;
    const [result, setResult] = useState<{
      target: string;
      factory: typeof factory;
      models: typeof models;
      schema?: FormPreviewSchema;
      error?: string;
    }>();
    useEffect(() => {
      if (!target || !factory) return;
      const client = factory(),
        controller = new AbortController();
      void client.schema(target, controller.signal).then(
        (schema) => {
          if (!controller.signal.aborted) setResult({ target, factory, models, schema });
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult({ target, factory, models, error: error instanceof Error ? error.message : String(error) });
        }
      );
      return () => {
        controller.abort();
        client.dispose();
      };
    }, [target, factory, models]);
    return result && result.target === target && result.factory === factory && result.models === models
      ? result
      : undefined;
  },
  {
    op: 'useWorkflowSchema',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
