// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '@rune-langium/visual-editor';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { ChangeFeedbackBoundary, feedbackSources, type FeedbackItem } from '../services/change-feedback.js';
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
