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

const EMPTY_SCOPE: FunctionScope = { inputs: [], output: null, aliases: [] };

/** New conditions own a local draft until Add; scope still comes from the linked worker. */
export const DraftConditionEditor = withInstrumentation(
  function DraftConditionEditor({
    filePath,
    files,
    ...props
  }: ExpressionEditorSlotProps & { filePath?: string; files: readonly WorkspaceFile[] }) {
    const nodeId = props.draftCondition!.nodeId;
    const kind = props.draftCondition!.kind;
    const [result, setResult] = useState<{ scope: FunctionScope; error?: string }>({ scope: EMPTY_SCOPE });
    useEffect(() => {
      let cancelled = false;
      setResult({ scope: EMPTY_SCOPE });
      if (!filePath) {
        setResult({ scope: EMPTY_SCOPE, error: 'Source unavailable. Use Text to draft this condition.' });
        return;
      }
      void requestExpressionScope(filePath, nodeId, { draftCondition: kind }, files).then(
        (entries) => {
          if (!cancelled) setResult({ scope: expressionScopeFromEntries(entries) });
        },
        () => {
          if (!cancelled)
            setResult({ scope: EMPTY_SCOPE, error: 'Scope unavailable. Use Text to draft this condition.' });
        }
      );
      return () => {
        cancelled = true;
      };
    }, [filePath, files, nodeId, kind]);
    return <ExpressionBuilder {...props} scope={result.scope} error={props.error ?? result.error} />;
  },
  { op: 'DraftConditionEditor' }
);
