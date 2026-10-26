// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Rune DSL syntax highlighting tests (T014).
 */

import { describe, it, expect } from 'vitest';
import { StringStream } from '@codemirror/language';
import { runeDslLanguage, runeDslStreamParser } from '../../src/lang/rune-dsl.js';

describe('runeDslStreamParser', () => {
  function tokens(source: string) {
    const result: { text: string; tag: string | null }[] = [];
    const state = runeDslStreamParser.startState();
    for (const line of source.split('\n')) {
      const stream = new StringStream(line, 4, 4);
      while (!stream.eol()) {
        stream.start = stream.pos;
        const tag = runeDslStreamParser.token(stream, state);
        if (tag) result.push({ text: stream.current(), tag });
      }
    }
    return result;
  }
  const tokenize = (line: string) => tokens(line).map(({ tag }) => tag);

  it('tokenizes keywords', () => {
    const tokens = tokenize('namespace foo.bar');
    expect(tokens).toContain('keyword');
  });

  it('tokenizes type keywords', () => {
    const tokens = tokenize('type Foo extends Bar:');
    expect(tokens).toContain('keyword');
    expect(tokens).toContain('typeName');
  });

  it('tokenizes strings', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens).toContain('string');
  });

  it('tokenizes numbers', () => {
    const tokens = tokenize('42');
    expect(tokens).toContain('number');
  });

  it('tokenizes single-line comments', () => {
    const tokens = tokenize('// this is a comment');
    expect(tokens).toContain('comment');
  });

  it('tokenizes multi-line comment start', () => {
    const tokens = tokenize('/* start of comment');
    expect(tokens).toContain('comment');
  });

  it('tokenizes boolean literals', () => {
    const tokens = tokenize('True False');
    expect(tokens).toContain('bool');
  });

  it('tokenizes definition keywords', () => {
    const tokens = tokenize('enum MyEnum:');
    expect(tokens).toContain('keyword');
  });

  it('tokenizes operators', () => {
    const tokens = tokenize('and or');
    expect(tokens).toContain('keyword');
  });
  it('separates documentation and synonym heads, fields, references and literal values', () => {
    const source = `[docReference ISDA MasterAgreement
      rationale "Path [synonym] and // text" rationale_author "Author"
      provision "5(a)"]
    [regulatoryReference CFTC Rule reportedField]
    [synonym FpML value "payment" path "/trade/payment" dateFormat "yyyy-MM-dd"]
    [ruleReference for payment -> amount Compute]
    [label for amount "Cash amount"]`;
    const result = tokens(source);
    for (const head of ['docReference', 'regulatoryReference', 'synonym', 'ruleReference', 'label'])
      expect(result).toContainEqual({ text: head, tag: 'annotation' });
    for (const field of ['rationale', 'rationale_author', 'provision', 'reportedField', 'value', 'path', 'dateFormat'])
      expect(result).toContainEqual({ text: field, tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'ISDA', tag: 'variableName' });
    expect(result).toContainEqual({ text: '"Path [synonym] and // text"', tag: 'string' });
  });

  it('uses standard annotation declarations and learns custom annotation names', () => {
    const result = tokens(
      'annotation custom:\n purpose string (0..1)\ntype Trade:\n [custom purpose]\n [metadata scheme "source"="ISO 4217"]\n [codeImplementation]'
    );
    for (const head of ['custom', 'metadata', 'codeImplementation'])
      expect(result).toContainEqual({ text: head, tag: 'annotation' });
    expect(result).toContainEqual({ text: 'purpose', tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'scheme', tag: 'propertyName' });
    expect(result).toContainEqual({ text: '"ISO 4217"', tag: 'string' });
  });

  it('preserves ordinary list and lambda highlighting around annotation-like text', () => {
    const result = tokens('[True, False] [item -> amount] ["docReference", "synonym"]');
    expect(result.some(({ tag }) => tag === 'annotation')).toBe(false);
    expect(result.filter(({ tag }) => tag === 'bool')).toHaveLength(2);
    expect(result).toContainEqual({ text: 'item', tag: 'keyword' });
  });

  it('keeps comment contents out of annotation state, including multiline comments', () => {
    const result = tokens('/* [docReference ISDA\n [synonym FpML] */\n[metadata scheme] // [label "x"]');
    expect(result.filter(({ tag }) => tag === 'annotation')).toEqual([{ text: 'metadata', tag: 'annotation' }]);
    expect(result.at(-1)!.tag).toBe('comment');
  });

  it('retains multiline literal contents without treating bracketed text as annotations', () => {
    const result = tokens(
      '[docReference ISDA MasterAgreement rationale "First line\n[metadata scheme] // literal text\nLast line"]\n[metadata scheme]'
    );
    expect(result.filter(({ tag }) => tag === 'annotation')).toEqual([
      { text: 'docReference', tag: 'annotation' },
      { text: 'metadata', tag: 'annotation' }
    ]);
    expect(result).toContainEqual({ text: '[metadata scheme] // literal text', tag: 'string' });
  });

  it('copies annotation context without sharing mutable incremental parser state', () => {
    const state = runeDslStreamParser.startState();
    const stream = new StringStream('[metadata', 4, 4);
    while (!stream.eol()) {
      stream.start = stream.pos;
      runeDslStreamParser.token(stream, state);
    }
    const copy = runeDslStreamParser.copyState(state);
    runeDslStreamParser.token(new StringStream(']', 4, 4), copy);
    expect(runeDslStreamParser.token(new StringStream('scheme', 4, 4), state)).toBe('propertyName');
  });
});

describe('runeDslLanguage', () => {
  it('returns a CodeMirror Extension', () => {
    const ext = runeDslLanguage();
    expect(ext).toBeDefined();
  });
});
