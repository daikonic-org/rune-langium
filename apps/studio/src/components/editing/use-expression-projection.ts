// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../../services/instrumentation/core.js';
import { useEffect, useRef, useState } from 'react';
import type { GeneratedProjection } from '@rune-langium/codegen/export';
import type { DocumentBinding } from '../../services/expression-document.js';
import type { PreviewSessionClient } from '../../services/preview-session-client.js';
import { usePreviewSessionFactory } from '../../shell/providers/preview-session-context.js';

export type ProjectionState =
  | { status: 'loading' }
  | { status: 'ready'; projection: GeneratedProjection; revision: number; editable: false }
  | { status: 'stale'; projection?: GeneratedProjection }
  | { status: 'error'; error: string; projection?: GeneratedProjection };

export const useExpressionProjection = withInstrumentation(
  function useExpressionProjection(
    language: 'rune' | GeneratedProjection['language'],
    binding: DocumentBinding | null,
    valid: boolean,
    kind: 'function' | 'condition',
    dependencySnapshot: unknown,
    retryRevision = 0
  ): ProjectionState {
    const factory = usePreviewSessionFactory();
    const [client, setClient] = useState<PreviewSessionClient | null>(null);
    const cache = useRef(
      new Map<
        GeneratedProjection['language'],
        { key: string; dependencies: unknown; projection: GeneratedProjection }
      >()
    );
    const sequence = useRef(0);
    const [result, setResult] = useState<{ language: typeof language; state: ProjectionState }>({
      language,
      state: { status: 'loading' }
    });
    useEffect(() => {
      const session = factory?.() ?? null;
      cache.current.clear();
      setClient(session);
      return () => session?.dispose();
    }, [factory]);
    const key = binding
      ? JSON.stringify([
          binding.workspaceGeneration,
          binding.uri,
          binding.nodeId,
          binding.revision,
          binding.region,
          kind
        ])
      : '';
    useEffect(() => {
      if (language === 'rune') return;
      const setState = (state: ProjectionState) => setResult({ language, state });
      const previous = cache.current.get(language);
      if (!binding || !valid) {
        setState({ status: 'stale', projection: previous?.projection });
        return;
      }
      if (previous?.key === key && previous.dependencies === dependencySnapshot) {
        setState({ status: 'ready', projection: previous.projection, revision: binding.revision, editable: false });
        return;
      }
      const controller = new AbortController();
      const request = ++sequence.current;
      setState(previous ? { status: 'stale', projection: previous.projection } : { status: 'loading' });
      if (!client) {
        if (!factory)
          setState({
            status: 'error',
            error: 'The generation worker is unavailable.',
            projection: previous?.projection
          });
        return;
      }
      void client
        .project(
          language,
          { uri: binding.uri, nodeId: binding.nodeId, region: binding.region },
          kind,
          binding.source,
          controller.signal
        )
        .then(
          (projection) => {
            if (request !== sequence.current || controller.signal.aborted) return;
            cache.current.set(language, { key, dependencies: dependencySnapshot, projection });
            setState({ status: 'ready', projection, revision: binding.revision, editable: false });
          },
          (error) => {
            if (request !== sequence.current || controller.signal.aborted) return;
            setState({
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
              projection: previous?.projection
            });
          }
        );
      return () => controller.abort();
    }, [language, key, valid, client, dependencySnapshot, factory, retryRevision]);
    return result.language === language ? result.state : { status: 'loading' };
  },
  { op: 'useExpressionProjection' }
);
