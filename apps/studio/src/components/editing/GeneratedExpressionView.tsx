// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratedProjection } from '@rune-langium/codegen/export';
import { ExpressionCodeEditor } from './ExpressionCodeEditor.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const GeneratedExpressionView = withInstrumentation(
  function GeneratedExpressionView({ projection }: { projection: GeneratedProjection }) {
    return (
      <div data-testid="generated-expression" className="flex min-h-32 flex-1 flex-col">
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
            readOnly
            code={projection.code}
            language={projection.language}
            label={`Generated ${projection.language}`}
          />
        )}
      </div>
    );
  },
  { op: 'GeneratedExpressionView' }
);
