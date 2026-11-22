// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import type { ReactNode } from 'react';
import type { SourceRegion } from '@rune-langium/core';
import { highlightTree } from '@lezer/highlight';
import type { DocumentBinding } from '../services/expression-document.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { studioEditorHighlightStyle } from './editor-theme.js';
import { runeDslLanguage } from './rune-dsl.js';

type RenderSyntax = (range: SourceRegion) => ReactNode;
const documentRenderers = new WeakMap<DocumentBinding, RenderSyntax>();

function syntaxRenderer(source: string, base = 0): RenderSyntax {
  const tree = runeDslLanguage().parser.parse(source);
  return ({ from, to }) => {
    let offset = base + from;
    const end = base + to;
    const parts: ReactNode[] = [];
    highlightTree(
      tree,
      studioEditorHighlightStyle,
      (start, stop, className) => {
        if (offset < start) parts.push(source.slice(offset, start));
        parts.push(
          <span className={className} key={start}>
            {source.slice(start, stop)}
          </span>
        );
        offset = stop;
      },
      offset,
      end
    );
    if (offset < end) parts.push(source.slice(offset, end));
    return parts;
  };
}

/** Use the same document context and highlighter as the full-file editor. */
export const runeDocumentSyntax = withInstrumentation(
  function runeDocumentSyntax(binding: DocumentBinding): RenderSyntax {
    let render = documentRenderers.get(binding);
    if (!render) {
      render = syntaxRenderer(binding.source);
      documentRenderers.set(binding, render);
    }
    return render;
  },
  { op: 'runeDocumentSyntax', capture: 0 }
);

/** Highlight drafts in their original lexical context, using expression-relative offsets. */
export const runeExpressionSyntax = withInstrumentation(
  function runeExpressionSyntax(source: string, binding?: DocumentBinding, original?: SourceRegion): RenderSyntax {
    if (binding && original) {
      const base = original.from;
      if (binding.source.slice(base, original.to) === source) {
        const render = runeDocumentSyntax(binding);
        return ({ from, to }) => render({ from: base + from, to: base + to });
      }
      return syntaxRenderer(binding.source.slice(0, base) + source, base);
    }
    const prefix = 'alias draft: ';
    return syntaxRenderer(prefix + source, prefix.length);
  },
  { op: 'runeExpressionSyntax', capture: 0 }
);
