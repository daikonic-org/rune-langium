// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Rune DSL syntax highlighting tests (T014).
 */

import { describe, it, expect } from 'vitest';
import { ensureSyntaxTree, StringStream } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { highlightTree, tags } from '@lezer/highlight';
import { studioEditorHighlightStyle } from '../../src/lang/editor-theme.js';
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
    expect(tokens).toContain('typeName.definition');
    expect(tokens).toContain('typeName');
  });

  it('assigns declaration, member, type-reference and call roles without relying on capitalization', () => {
    const result = tokens(`type money:
  Amount number (1..1)
func increaseCash:
  inputs:
    Cash money (1..1)
    change number (1..1)
  output:
    result money (1..1)
  condition Positive: Cash -> Amount > 0
  set result: money { Amount: ApplyChange(Cash -> Amount, change) }`);
    expect(result).toContainEqual({ text: 'money', tag: 'typeName.definition' });
    expect(result).toContainEqual({ text: 'increaseCash', tag: 'variableName.function.definition' });
    expect(result).toContainEqual({ text: 'Positive', tag: 'labelName' });
    for (const name of ['Amount', 'Cash', 'change', 'result'])
      expect(result).toContainEqual({ text: name, tag: 'propertyName.definition' });
    expect(result).toContainEqual({ text: 'number', tag: 'typeName' });
    expect(result.filter(({ text, tag }) => text === 'money' && tag === 'typeName')).toHaveLength(3);
    expect(result).toContainEqual({ text: 'Amount', tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'ApplyChange', tag: 'variableName.function' });
  });

  it('distinguishes enum constants, choice types and member navigation', () => {
    const result = tokens(`enum direction:
  increase
  decrease displayName "Decrease"
choice Payment:
  example.money
  Security
func Change:
  inputs:
    cash example.money (1..1)
  output:
    result direction (1..1)
  set result: direction -> increase
  condition Present: cash -> amount exists`);
    expect(result).toContainEqual({ text: 'direction', tag: 'typeName.definition' });
    for (const name of ['increase', 'decrease'])
      expect(result).toContainEqual({ text: name, tag: 'variableName.constant' });
    expect(result.filter(({ text, tag }) => text === 'increase' && tag === 'variableName.constant')).toHaveLength(2);
    for (const name of ['example.money', 'Security', 'direction'])
      expect(result).toContainEqual({ text: name, tag: 'typeName' });
    expect(result).toContainEqual({ text: 'amount', tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'displayName', tag: 'keyword' });
  });

  it('does not leak declaration expectations into later lines or independent parser copies', () => {
    expect(tokens('type\nnotAType')).toContainEqual({ text: 'notAType', tag: 'variableName' });
    const state = runeDslStreamParser.startState();
    const parse = (line: string, target = state) => {
      const stream = new StringStream(line, 4, 4);
      const tags = [];
      while (!stream.eol()) {
        stream.start = stream.pos;
        tags.push(runeDslStreamParser.token(stream, target));
      }
      return tags;
    };
    parse('enum direction:');
    const copy = runeDslStreamParser.copyState(state);
    parse('enum other:', copy);
    expect(parse('  other', state)).toContain('variableName.constant');
    parse('func Example:', state);
    expect(parse('  set result: other -> entry', state)).not.toContain('variableName.constant');
  });

  it('keeps unnamed conditions and aliases in expression roles', () => {
    const result = tokens(`type Quote:
  value number (0..1)
  condition: value exists
func Copy:
  inputs:
    quote Quote (1..1)
  output:
    result number (0..1)
  alias selected: quote -> value
  set result: selected
  post-condition: result exists`);
    expect(result.filter(({ tag }) => tag === 'labelName')).toEqual([]);
    expect(result).toContainEqual({ text: 'selected', tag: 'variableName.definition' });
    expect(result).toContainEqual({ text: 'value', tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'post-condition', tag: 'keyword' });
  });

  it('does not treat an input shadowing an enum name as an enum receiver', () => {
    const result = tokens(`enum direction:
  increase
func Copy:
  inputs:
    direction Quote (1..1)
  output:
    result string (1..1)
  set result: direction -> value`);
    expect(result).toContainEqual({ text: 'direction', tag: 'propertyName' });
    expect(result).toContainEqual({ text: 'value', tag: 'propertyName' });
    expect(result).not.toContainEqual({ text: 'value', tag: 'variableName.constant' });
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

  it('keeps annotation-named references in list and inline-function expression roles', () => {
    for (const expression of [
      '[calculation, other]',
      'items extract [calculation -> amount]',
      'items extract calculation [calculation -> amount]',
      'set result:\n  [calculation,\n   other]',
      'alias selected:\n  [calculation]',
      '[[calculation, other]]'
    ]) {
      const result = tokens(expression);
      expect(
        result.filter(({ tag }) => tag === 'annotation'),
        expression
      ).toEqual([]);
      if (expression.includes('-> amount'))
        expect(result, expression).toContainEqual({ text: 'amount', tag: 'propertyName' });
      expect(result, expression).toContainEqual({ text: 'calculation', tag: 'variableName' });
    }
    const result = tokens(
      'func Example:\n  [calculation]\n  set result:\n    [calculation]\ntype Next:\n  [calculation]'
    );
    expect(result.filter(({ tag }) => tag === 'annotation')).toEqual([
      { text: 'calculation', tag: 'annotation' },
      { text: 'calculation', tag: 'annotation' }
    ]);
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

  it('renders Rune and TypeScript roles through the same shared highlight rules', () => {
    function highlights(source: string, language: Extension) {
      const state = EditorState.create({ doc: source, extensions: [language] });
      const tree = ensureSyntaxTree(state, source.length, 1000)!;
      const ranges: { text: string; style: string }[] = [];
      highlightTree(tree, studioEditorHighlightStyle, (from, to, style) => {
        ranges.push({ text: source.slice(from, to), style });
      });
      return ranges;
    }
    const rune = highlights(
      `type money:
  amount number (1..1)
enum direction:
  increase
func increaseCash:
  inputs:
    cash money (1..1)
  output:
    result money (1..1)
  set result: money { amount: ApplyChange(cash -> amount) }`,
      runeDslLanguage()
    );
    const typescript = highlights(
      'type money = {amount: number}; function increaseCash(cash: money) { return ApplyChange(cash.amount); }',
      javascript({ typescript: true })
    );
    for (const text of ['money', 'increaseCash', 'amount', 'ApplyChange']) {
      const runeStyles = new Set(rune.filter((range) => range.text === text).map((range) => range.style));
      const tsStyles = new Set(typescript.filter((range) => range.text === text).map((range) => range.style));
      expect(runeStyles, text).toEqual(tsStyles);
      expect(runeStyles.size, text).toBeGreaterThan(0);
    }
    expect(rune).toContainEqual({
      text: 'increase',
      style: studioEditorHighlightStyle.style([tags.constant(tags.variableName)])
    });
  });
});
