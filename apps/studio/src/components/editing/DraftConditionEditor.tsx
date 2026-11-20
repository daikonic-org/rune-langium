// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState } from 'react';
import {
  ExpressionBuilder,
  expressionScopeFromEntries,
  type ExpressionEditorSlotProps,
  type FunctionScope
} from '@rune-langium/visual-editor';
import { requestExpressionScope, type WorkspaceFile } from '../../services/workspace.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import type { ExpressionDocument } from '../../services/expression-document.js';
import { pathToUri } from '../../utils/uri.js';
import { InlineExpressionField } from './InlineExpressionRows.js';

const EMPTY_SCOPE: FunctionScope = { inputs: [], output: null, aliases: [] };

/** New conditions own a local draft until Add; scope still comes from the linked worker. */
export const DraftConditionEditor = withInstrumentation(
  function DraftConditionEditor({
    filePath,
    files,
    documents,
    ...props
  }: ExpressionEditorSlotProps & {
    filePath?: string;
    files: readonly WorkspaceFile[];
    documents: ExpressionDocument;
  }) {
    const nodeId = props.draftCondition!.nodeId;
    const kind = props.draftCondition!.kind;
    const [result, setResult] = useState<{ scope: FunctionScope; error?: string }>({ scope: EMPTY_SCOPE });
    useEffect(() => {
      let cancelled = false;
      setResult({ scope: EMPTY_SCOPE });
      if (!filePath) {
        setResult({ scope: EMPTY_SCOPE, error: 'Waiting for the current source.' });
        return;
      }
      void requestExpressionScope(filePath, nodeId, { draftCondition: kind }, files).then(
        (entries) => {
          if (!cancelled) setResult({ scope: expressionScopeFromEntries(entries) });
        },
        () => {
          if (!cancelled) setResult({ scope: EMPTY_SCOPE, error: 'Scope unavailable.' });
        }
      );
      return () => {
        cancelled = true;
      };
    }, [filePath, files, nodeId, kind]);
    const file = files.find((entry) => entry.path === filePath);
    const binding = file && documents.capture(pathToUri(file.path), nodeId, { from: 0, to: file.content.length });
    return binding && file && props.onChange ? (
      <InlineExpressionField
        session={{ binding, documents, file, files, scope: result.scope }}
        target={{ draftCondition: kind }}
        value={props.value ?? ''}
        onChange={props.onChange}
      />
    ) : (
      <ExpressionBuilder {...props} presentation="inline" scope={result.scope} error={props.error ?? result.error} />
    );
  },
  { op: 'DraftConditionEditor' }
);
