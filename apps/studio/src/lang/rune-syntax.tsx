// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import type { ReactNode } from 'react';
import type { SourceRegion } from '@rune-langium/core';
import { highlightTree } from '@lezer/highlight';
import type { DocumentBinding } from '../services/expression-document.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { studioEditorHighlightStyle } from './editor-theme.js';
import { runeDslLanguage } from './rune-dsl.js';

type RenderSyntax = (range: SourceRegion) => { text: string; content: ReactNode };
const documentRenderers = new WeakMap<DocumentBinding, RenderSyntax>();

function syntaxRenderer(source: string, base = 0): RenderSyntax {
  const tree = runeDslLanguage().parser.parse(source);
  return ({ from, to }) => {
    let offset = base + from;
    const end = base + to;
    const parts: ReactNode[] = [];
    let text = '';
    const append = (start: number, stop: number) => {
      if (start >= stop) return;
      text += source.slice(start, stop);
      let cursor = start;
      highlightTree(
        tree,
        studioEditorHighlightStyle,
        (from, to, className) => {
          if (cursor < from) parts.push(source.slice(cursor, from));
          parts.push(
            <span className={className} key={from}>
              {source.slice(from, to)}
            </span>
          );
          cursor = to;
        },
        start,
        stop
      );
      if (cursor < stop) parts.push(source.slice(cursor, stop));
    };
    tree.iterate({
      from: offset,
      to: end,
      enter(node) {
        // Only parsed operators are display substitutions. Strings and comments keep their authored text.
        if (node.name !== 'derefOperator' || node.from < offset || node.to > end) return;
        const before = source.slice(offset, node.from).replace(/[ \t]+$/, '');
        append(offset, offset + before.length);
        const separator = source.slice(node.from, node.to) === '->' ? '.' : '…';
        text += separator;
        parts.push(
          <span className="text-syntax-operator" key={node.from}>
            {separator}
          </span>
        );
        offset = node.to;
        while (offset < end && (source[offset] === ' ' || source[offset] === '\t')) offset++;
      }
    });
    append(offset, end);
    return { text, content: parts };
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
  function runeExpressionSyntax(source: string, binding?: DocumentBinding, original?: SourceRegion) {
    if (binding && original) {
      const base = original.from;
      if (binding.source.slice(base, original.to) === source) {
        const render = runeDocumentSyntax(binding);
        return ({ from, to }: SourceRegion) => render({ from: base + from, to: base + to }).content;
      }
      const render = syntaxRenderer(binding.source.slice(0, base) + source, base);
      return (range: SourceRegion) => render(range).content;
    }
    const prefix = 'alias draft: ';
    const render = syntaxRenderer(prefix + source, prefix.length);
    return (range: SourceRegion) => render(range).content;
  },
  { op: 'runeExpressionSyntax', capture: 0 }
);
