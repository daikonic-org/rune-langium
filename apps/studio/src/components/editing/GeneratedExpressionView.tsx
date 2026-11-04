// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratedProjection } from '@rune-langium/codegen/export';
import { useEffect, useRef, useState } from 'react';
import type { SourceRegion } from '@rune-langium/core';
import { Button } from '@rune-langium/design-system/ui/button';
import type { DocumentBinding, DocumentEdit, CommitResult } from '../../services/expression-document.js';
import { prepareProjectionEdit } from '../../services/projection-edit.js';
import { getTsWasmBytes } from '../../lens/ts-wasm-asset.js';
import { ExpressionCodeEditor } from './ExpressionCodeEditor.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

interface ProjectionCapture {
  binding: DocumentBinding;
  regions: SourceRegion[];
  dependencies: unknown;
}
interface ProjectionEdit {
  capture(): ProjectionCapture | undefined;
  apply(edit: DocumentEdit, dependencies: unknown): CommitResult;
}
export const GeneratedExpressionView = withInstrumentation(
  function GeneratedExpressionView({ projection, edit }: { projection: GeneratedProjection; edit?: ProjectionEdit }) {
    const [draft, setDraft] = useState<{
      text: string;
      projection: GeneratedProjection;
      captured: ProjectionCapture;
    }>();
    const [error, setError] = useState<string>();
    const [pending, setPending] = useState(false);
    const sequence = useRef(0);
    useEffect(
      () => () => {
        sequence.current++;
      },
      []
    );
    const discard = () => {
      sequence.current++;
      setPending(false);
      setError(undefined);
      setDraft(undefined);
    };
    const apply = async () => {
      if (!draft || !edit || pending) return;
      const request = ++sequence.current;
      setPending(true);
      setError(undefined);
      try {
        const change = await prepareProjectionEdit(
          draft.captured.binding,
          draft.captured.regions,
          draft.projection.code,
          draft.text,
          draft.projection.syntax ?? 'statements',
          await getTsWasmBytes(),
          draft.projection.origins
        );
        if (request !== sequence.current) return;
        const result = edit.apply(change, draft.captured.dependencies);
        if (!result.ok)
          throw new Error(
            result.reason === 'read-only'
              ? 'This source is read-only.'
              : 'The source or its dependencies changed. Discard this draft and try again.'
          );
        discard();
      } catch (error) {
        if (request === sequence.current) setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (request === sequence.current) setPending(false);
      }
    };
    return (
      <div data-testid="generated-expression" className="flex shrink-0 flex-col">
        {projection.implementation && (
          <div role="status" className="border-b px-2 py-1 text-xs text-muted-foreground">
            <span>{projection.implementation.label}</span>
            {projection.implementation.reference && (
              <span className="ml-2 font-mono">{projection.implementation.reference}</span>
            )}
          </div>
        )}
        {projection.code && (
          <ExpressionCodeEditor
            readOnly={!edit && !draft}
            code={draft?.text ?? projection.code}
            language={projection.language}
            label={`Generated ${projection.language}`}
            onChange={(text) => {
              if (pending) {
                sequence.current++;
                setPending(false);
              }
              setError(undefined);
              setDraft((previous) => {
                const captured = previous?.captured ?? edit?.capture();
                return captured ? { text, projection: previous?.projection ?? projection, captured } : previous;
              });
            }}
          />
        )}
        {draft && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span role="status" className="text-xs text-muted-foreground">
              Unapplied draft
            </span>
            <Button size="xs" disabled={pending || !edit} onClick={apply}>
              {pending ? 'Checking…' : 'Apply'}
            </Button>
            <Button size="xs" variant="ghost" onClick={discard}>
              Discard
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="pt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  },
  { op: 'GeneratedExpressionView' }
);
