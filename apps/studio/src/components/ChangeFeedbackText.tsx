// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';

import { useLayoutEffect, useRef, useState } from 'react';
import { ChangeSet } from '@codemirror/state';
import { minimalDocumentChange } from '../lang/minimal-document-change.js';
import {
  CHANGE_HIGHLIGHT_MS,
  CHANGE_REMOVAL_MS,
  feedbackRevisionChanged,
  installFeedbackTiming,
  type ChangeEffect,
  type FeedbackRevision
} from '../services/change-feedback.js';
import '../styles/change-feedback.css';

interface TextCue {
  text: string;
  from: number;
  to: number;
  removed: string;
  kind: ChangeEffect;
}

export const ChangeFeedbackText = withInstrumentation(
  function ChangeFeedbackText({
    text,
    scope,
    revision,
    ready = true
  }: {
    text: string;
    scope: string;
    revision?: FeedbackRevision;
    ready?: boolean;
  }) {
    const host = useRef<HTMLSpanElement>(null);
    const previous = useRef({ text, scope, revision });
    const [cue, setCue] = useState<TextCue | null>(null);
    useLayoutEffect(() => {
      if (host.current) installFeedbackTiming(host.current);
      const pre = host.current?.closest('pre');
      const clear = () => setCue(null);
      pre?.addEventListener('focusin', clear);
      return () => pre?.removeEventListener('focusin', clear);
    }, []);
    useLayoutEffect(() => {
      const old = previous.current;
      if (!ready) {
        setCue(null);
        return;
      }
      // A ready, unchanged output still consumes its authored revision. Later
      // hydration on that revision must not inherit provenance from an old edit.
      previous.current = { text, scope, revision };
      if (
        old.scope !== scope ||
        old.text === text ||
        (revision && !feedbackRevisionChanged(old.revision, revision)) ||
        host.current?.closest('pre')?.contains(document.activeElement)
      ) {
        if (old.text !== text || old.scope !== scope) setCue(null);
        return;
      }
      const changes: TextCue[] = [];
      ChangeSet.of(minimalDocumentChange(old.text, text), old.text.length).iterChanges((fromA, toA, fromB, toB) => {
        changes.push({
          text,
          from: fromB,
          to: toB,
          removed: old.text.slice(fromA, toA),
          kind: fromA === toA ? 'add' : fromB === toB ? 'remove' : 'change'
        });
      });
      const change = changes[0] ?? null;
      setCue(change);
    }, [text, scope, revision, ready]);
    useLayoutEffect(() => {
      if (!cue) return;
      const timer = setTimeout(() => setCue(null), cue.kind === 'remove' ? CHANGE_REMOVAL_MS : CHANGE_HIGHLIGHT_MS);
      return () => clearTimeout(timer);
    }, [cue]);
    const visible = cue?.text === text ? cue : null;
    return (
      <span ref={host} onFocusCapture={() => setCue(null)}>
        {visible ? (
          <>
            {text.slice(0, visible.from)}
            {visible.kind === 'remove' ? (
              <span
                data-change-feedback="remove"
                className="rune-text-ghost"
                data-removed-text={visible.removed}
                aria-hidden="true"
                inert
              />
            ) : (
              <span data-change-feedback={visible.kind}>{text.slice(visible.from, visible.to)}</span>
            )}
            {text.slice(visible.to)}
          </>
        ) : (
          text
        )}
      </span>
    );
  },
  {
    op: 'ChangeFeedbackText',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
