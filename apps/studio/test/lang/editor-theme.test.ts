// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Verifies that the studioEditorHighlightStyle derives its syntax palette
 * from the canonical design tokens rather than hardcoding hex values.
 *
 * The public HighlightStyle.specs contract verifies theme-variable rules and
 * canonical fallbacks; source checks retain existing chrome/font regressions.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { syntax } from '@rune-langium/design-system/tokens';
import { tags as t } from '@lezer/highlight';
import { studioEditorHighlightStyle } from '../../src/lang/editor-theme.js';

/** The theme module source — used to assert it references the syntax tokens
 * (rather than hardcoded hex), since the compiled HighlightStyle doesn't
 * expose per-tag colors at runtime. */
const THEME_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/lang/editor-theme.ts'),
  'utf8'
);

describe('design-system syntax tokens (canonical values)', () => {
  // One object-equality pins every canonical hex value AND the exact key set —
  // `toEqual` also fails on an added/removed key, so it's strictly stronger than
  // the 10 per-key `it` blocks it replaces.
  it('syntax tokens match the canonical palette', () => {
    expect(syntax).toEqual({
      keyword: '#C792EA',
      type: '#00D4AA',
      attribute: '#82AAFF',
      string: '#C3E88D',
      comment: '#5C5C6A',
      number: '#E8913A',
      function: '#82AAFF',
      operator: '#8A8A96',
      constant: '#E8913A',
      variable: '#00D4AA'
    });
  });
});

describe('studio editor theme uses design-system syntax tokens', () => {
  it('re-exports the theme without error', async () => {
    const mod = await import('../../src/lang/editor-theme.js');
    expect(mod.studioEditorTheme).toBeDefined();
    expect(mod.studioEditorHighlightStyle).toBeDefined();
    expect(mod.studioEditorExtensions).toBeDefined();
  });

  it('uses theme CSS variables with canonical fallbacks for actual highlighting rules', () => {
    for (const [tag, key] of [
      [t.keyword, 'keyword'],
      [t.function(t.variableName), 'function'],
      [t.propertyName, 'attribute'],
      [t.typeName, 'type'],
      [t.string, 'string'],
      [t.operator, 'operator'],
      [t.number, 'number'],
      [t.bool, 'constant']
    ] as const) {
      const rule = studioEditorHighlightStyle.specs.find((spec) =>
        (Array.isArray(spec.tag) ? spec.tag : [spec.tag]).includes(tag)
      );
      expect(rule?.color).toBe(`var(--syntax-${key}, ${syntax[key]})`);
    }
  });

  it('keeps comments neutral and italic while metadata retains annotation emphasis', () => {
    const rule = (tag: typeof t.comment) =>
      studioEditorHighlightStyle.specs.find((spec) => (Array.isArray(spec.tag) ? spec.tag : [spec.tag]).includes(tag));
    expect(rule(t.comment)).toMatchObject({ color: 'var(--muted-foreground)', fontStyle: 'italic' });
    expect(rule(t.meta)?.color).toBe(rule(t.annotation)?.color);
    expect(rule(t.meta)?.fontStyle).toBeUndefined();
  });

  // Anti-regression: #C792EA (keyword) and #C3E88D (string) are unique to the
  // syntax palette; if either reappears as a literal, someone reverted to
  // hardcoded hex.
  it('does not reintroduce the hardcoded syntax hex it replaced', () => {
    expect(THEME_SRC).not.toMatch(/#C792EA/i);
    expect(THEME_SRC).not.toMatch(/#C3E88D/i);
  });

  // Chrome anti-regression: the legacy surface hex must be gone from
  // the EditorView.theme({}) block; all chrome colors must now use var(--*)
  // or color-mix() so the editor adapts to the active theme (daikonic).
  it('does not contain the legacy background hex in the chrome', () => {
    expect(THEME_SRC).not.toMatch(/#0C0C14/i);
    expect(THEME_SRC).not.toMatch(/#181824/i);
    expect(THEME_SRC).not.toMatch(/#12121C/i);
  });

  // The line-number gutter is a sibling of .cm-content and does NOT inherit
  // its font, so it must set the mono font itself — otherwise line numbers
  // fall back to the body UI font (Inter) and render proportional/misaligned.
  it('the .cm-gutters block sets the mono font', () => {
    expect(THEME_SRC).toMatch(/const editorTextStyle =\s*\{[\s\S]*?font-mono/);
    expect(THEME_SRC).toMatch(/'\.cm-gutters':\s*\{[\s\S]*?\.\.\.editorTextStyle/);
  });

  // Only use tokens defined in the BASE palette so the theme resolves under
  // every theme (incl. ?theme=default). --color-error is daikonic-only — use
  // --destructive (base + per-theme) instead.
  it('does not use daikonic-only tokens (e.g. --color-error)', () => {
    expect(THEME_SRC).not.toMatch(/var\(--color-error\)/);
  });
});
