// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore, type NodeRepository } from '@rune-langium/visual-editor';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import {
  CHANGE_HIGHLIGHT_MS,
  ChangeFeedbackBoundary,
  feedbackSources,
  type FeedbackItem
} from '../services/change-feedback.js';
import '../styles/change-feedback.css';

export const useFeedbackRevision = withInstrumentation(
  function useFeedbackRevision(files?: Parameters<typeof feedbackSources>[0]) {
    const workspace = useWorkspaceOptional();
    const patches = useEditorStore((state) => state.pendingEditPatches);
    const sources = useMemo(() => feedbackSources(files ?? workspace?.files ?? []), [files, workspace?.files]);
    return useMemo(() => ({ sources, edits: patches?.length ? patches : undefined }), [sources, patches]);
  },
  {
    op: 'useFeedbackRevision',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const useChangeFeedback = withInstrumentation(
  function useChangeFeedback(scope: string, items: readonly FeedbackItem[], ready = true) {
    const revision = useFeedbackRevision();
    const root = useRef<HTMLElement | null>(null);
    const boundary = useRef<ChangeFeedbackBoundary | null>(null);
    const frame = useRef<number | undefined>(undefined);
    const current = useRef({ scope, items, ready, revision });
    current.current = { scope, items, ready, revision };
    const refresh = useCallback(() => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      // RHF adopts the canonical parse in passive effects. Cue the resulting row,
      // rather than a preceding form row that its reset is about to replace.
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (!root.current?.isConnected) return;
        boundary.current ??= new ChangeFeedbackBoundary();
        const { scope, items, ready, revision } = current.current;
        boundary.current.update(root.current, scope, items, ready, revision);
      });
    }, []);
    const setRoot = useCallback(
      (element: HTMLElement | null) => {
        root.current = element;
        if (element) refresh();
        else {
          if (frame.current !== undefined) cancelAnimationFrame(frame.current);
          boundary.current?.dispose();
        }
      },
      [refresh]
    );
    useEffect(refresh, [scope, items, ready, revision, refresh]);
    useEffect(
      () => () => {
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        boundary.current?.dispose();
        boundary.current = null;
      },
      []
    );
    return setRoot;
  },
  {
    op: 'useChangeFeedback',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

/** Compare catalog updates independently of tree filters and authored edit feedback. */
export const useNamespaceArrivals = withInstrumentation(
  function useNamespaceArrivals(repository: NodeRepository): ReadonlySet<string> | undefined {
    const workspace = useWorkspaceOptional();
    const scope = `${workspace?.workspaceId ?? ''}:${workspace?.workspaceEpoch ?? 0}`;
    const previous = useRef<{ scope: string; repository: NodeRepository }>(undefined);
    const [arrival, setArrival] = useState<{ scope: string; namespaces: ReadonlySet<string> }>();

    useEffect(() => {
      const old = previous.current;
      previous.current = { scope, repository };
      if (!old || old.scope !== scope) return;

      const arrived = repository.namespaces().filter((namespace) => {
        const current = repository.byNamespace(namespace);
        const prior = old.repository.byNamespace(namespace);
        return (
          current.length > prior.length ||
          current.filter((node) => !node.meta.deferred).length > prior.filter((node) => !node.meta.deferred).length
        );
      });
      if (arrived.length) {
        setArrival((last) => ({
          scope,
          namespaces: new Set([...(last?.scope === scope ? last.namespaces : []), ...arrived])
        }));
      }
    }, [scope, repository]);

    useEffect(() => {
      if (!arrival || arrival.scope !== scope) return;
      const timeout = setTimeout(() => setArrival(undefined), CHANGE_HIGHLIGHT_MS);
      return () => clearTimeout(timeout);
    }, [arrival, scope]);

    return arrival?.scope === scope ? arrival.namespaces : undefined;
  },
  { op: 'useNamespaceArrivals', capture: 0 }
);
