// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { runeDslLanguage } from '../../src/lang/rune-dsl.js';
import { sourceDeclarationAt } from '../../src/lang/source-declaration.js';

function select(source: string, token: string, offset = 1) {
  const state = EditorState.create({ doc: source, extensions: runeDslLanguage() });
  return sourceDeclarationAt(state, source.indexOf(token) + offset);
}

describe('source declaration selection', () => {
  it.each(['is', 'between', 'construct', 'source'])('ignores %s in documentation', (token) => {
    for (const comment of [`// the type ${token}`, `/*\ntype ${token}\n*/`, `<"the type ${token}">`]) {
      expect(select(`namespace example\n${comment}\ntype Valid:\n`, token)).toBeNull();
    }
  });

  it('does not guess from neighboring declarations or tokens on their lines', () => {
    const source = 'namespace example\ntype Valid:\n  condition Check: value is absent\n';
    for (const token of ['type', ':', 'condition', 'value', 'is', 'absent']) expect(select(source, token)).toBeNull();
    expect(select(source, 'Valid')).toBe('example.Valid');
  });

  it('retains function identity and quoted namespaces', () => {
    expect(select('namespace "example.functions"\nfunc UpdateAmount:\n', 'UpdateAmount')).toBe(
      'example.functions.UpdateAmount#RosettaFunction'
    );
  });

  it('ignores a namespace declaration inside a comment', () => {
    expect(select('namespace real\n/*\nnamespace fake\n*/\ntype Valid:\n', 'Valid')).toBe('real.Valid');
  });

  it.each(['"', "'"])('ignores declarations inside multiline %s documentation', (quote) => {
    const source = [
      'namespace real',
      `<${quote}description with an escaped \\${quote}`,
      'namespace fake',
      'type is',
      'type between',
      'type construct',
      'type source',
      `${quote}>`,
      'type Valid:'
    ].join('\n');
    for (const token of ['is', 'between', 'construct', 'source']) expect(select(source, `type ${token}`, 6)).toBeNull();
    expect(select(source, 'Valid')).toBe('real.Valid');
  });

  it('keeps comment markers inside a multiline description as string content', () => {
    const source = 'namespace real\n<"description /* //\ntype source\n">\ntype Valid:';
    expect(select(source, 'type source', 6)).toBeNull();
    expect(select(source, 'Valid')).toBe('real.Valid');
  });

  it('recognizes escaped declaration identifiers', () => {
    expect(select('namespace example\ntype ^source:\n', '^source', 2)).toBe('example.source');
  });
});
