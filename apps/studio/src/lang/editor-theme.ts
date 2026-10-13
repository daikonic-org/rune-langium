// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Studio editor theme — token-driven CodeMirror 6 theme that adapts to the
 * active design-system theme (daikonic by default). The chrome (gutters,
 * selection, search, autocomplete, tooltips) uses semantic CSS design tokens so
 * it stays consistent with whatever theme is active; syntax highlighting derives
 * its palette from the `syntax.*` tokens.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { syntax } from '@rune-langium/design-system/tokens';

const editorTextStyle = {
  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
  fontSize: '13px',
  lineHeight: '1.45'
};

export const studioEditorTheme = EditorView.theme(
  {
    '&': {
      ...editorTextStyle,
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)',
      height: '100%'
    },
    '.cm-scroller': {
      overflow: 'auto'
    },
    '.cm-content': {
      caretColor: 'var(--primary)',
      ...editorTextStyle,
      padding: '8px 0'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--primary)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 15%, transparent)'
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 34%, transparent)'
    },
    '.cm-gutters': {
      // Gutters are siblings of the content and need the same metrics for alignment.
      ...editorTextStyle,
      paddingLeft: 'var(--space-1)',
      backgroundColor: 'color-mix(in srgb, var(--card) 92%, var(--background))',
      color: 'var(--muted-foreground)',
      border: 'none',
      borderRight: '1px solid var(--border)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 42%, var(--card))',
      color: 'var(--muted-foreground)'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 2px 0 4px',
      minWidth: '0'
    },
    '.cm-line': { padding: '0 8px' },
    '.cm-foldGutter': { width: '10px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0', color: 'var(--muted-foreground)' },
    '.cm-tooltip': {
      backgroundColor: 'color-mix(in srgb, var(--card) 88%, var(--background))',
      border: '1px solid var(--border)',
      borderRadius: '4px'
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent)'
      }
    },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-warning) 22%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--color-warning) 45%, transparent)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--color-warning) 35%, transparent)'
    },
    '.cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)'
    },
    '.cm-panels': {
      backgroundColor: 'var(--popover)',
      color: 'var(--foreground)'
    },
    '.cm-panel.cm-search': {
      backgroundColor: 'var(--popover)',
      padding: '2px 6px',
      fontSize: '12px'
    }
  },
  { dark: true }
);

export const studioEditorHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: syntax.keyword },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: 'var(--foreground)' },
  { tag: [t.function(t.variableName), t.labelName], color: syntax.function },
  { tag: [t.propertyName], color: syntax.attribute },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: syntax.variable },
  { tag: [t.definition(t.name), t.separator], color: 'var(--foreground)' },
  {
    tag: [t.typeName, t.className, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: syntax.type
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: syntax.operator
  },
  { tag: [t.meta, t.comment], color: syntax.comment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: syntax.variable, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--foreground)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: syntax.constant },
  { tag: [t.processingInstruction, t.string, t.inserted], color: syntax.string },
  // --destructive (not --color-error): the latter is only defined under
  // [data-theme='daikonic'], so it wouldn't resolve under ?theme=default.
  // --destructive is defined in the base palette AND overridden per-theme.
  { tag: t.invalid, color: 'var(--destructive)' },
  { tag: t.number, color: syntax.number }
]);

export const studioEditorExtensions = [studioEditorTheme, syntaxHighlighting(studioEditorHighlightStyle)];
