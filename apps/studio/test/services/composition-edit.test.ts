// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { expect, it } from 'vitest';
import {
  COMPOSITION_MODEL_SOURCE,
  describeFunctionComposition,
  isRosettaFunction,
  parseWorkspace
} from '@rune-langium/core';
import { ExpressionDocument } from '../../src/services/expression-document.js';
import {
  compositionReference,
  compositionAliasEdit,
  compositionExpressionEdit,
  compositionArgumentsText,
  compositionCandidate,
  compositionSourceEdit,
  reorderCompositionVariables,
  compositionBindingCycle
} from '../../src/services/composition-edit.js';

it.each(['\n', '\r\n'])(
  'preserves comments, metadata, conditions, neighbors and newline bytes (%j)',
  async (newline) => {
    let source = `namespace example
import rune.studio.*
func Twice:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 // preserve alias documentation
 alias scaled: value * 2
 condition Positive: value > 0
 set result: scaled
 post-condition Valid: result > 0

func Neighbor:
 output: result number (1..1)
 set result: 9
`.replaceAll('\n', newline);
    const parsed = await parseWorkspace([
      { uri: 'memory:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE },
      { uri: 'memory:///owner.rosetta', content: source }
    ]);
    const owner = parsed[1]!.value.elements.find(isRosettaFunction)!;
    const composition = describeFunctionComposition(owner);
    const documents = new ExpressionDocument({
      getGeneration: () => 1,
      getFile: () => ({ path: 'owner', content: source }),
      onContentChange: (_, value) => {
        source = value;
      }
    });

    const binding = documents.capture('owner', 'example.Twice#RosettaFunction', { from: 0, to: source.length })!;
    const alias = composition.steps[1]!;
    const original = source;
    expect(documents.applyDocumentEdit(compositionExpressionEdit(binding, alias.region!, 'value * 3')).ok).toBe(true);
    expect(source).toBe(original.replace('value * 2', 'value * 3'));
    expect(documents.applyDocumentEdit(compositionExpressionEdit(binding, alias.region!, 'value * 4'))).toEqual({
      ok: false,
      reason: 'stale'
    });
    const current = documents.capture('owner', binding.nodeId, { from: 0, to: source.length })!;
    const offset = source.length - original.length;
    const updated = { ...composition, insertion: composition.insertion! + offset };
    expect(documents.applyDocumentEdit(compositionAliasEdit(current, updated, 'extra', 'scaled + 1')).ok).toBe(true);
    expect(source).toContain(`alias extra: scaled + 1${newline} condition Positive: value > 0`);
    expect(source).toContain('// preserve alias documentation');
    expect(source).toContain(`condition Positive: value > 0${newline}`);
    expect(source).toContain(`post-condition Valid: result > 0${newline}`);
    expect(source.endsWith(original.slice(original.indexOf('func Neighbor:')))).toBe(true);
  }
);

it('retains exact call spelling/trivia on a no-op and refuses silently dropped comments', () => {
  const source = 'Double( value /* keep */,\n other )';
  const documents = new ExpressionDocument({
    getGeneration: () => 1,
    getFile: () => ({ path: 'call', content: source }),
    onContentChange: () => {}
  });
  const binding = documents.capture('call', 'owner', { from: 0, to: source.length })!;
  const region = { from: 0, to: source.length };
  const argument = { from: source.indexOf('other'), to: source.indexOf('other') + 'other'.length };
  expect(compositionArgumentsText(binding, region, [{ region: argument, value: 'other' }])).toBe(source);
  const changed = compositionArgumentsText(binding, region, [{ region: argument, value: 'other + 1' }]);
  expect(changed).toBe(source.replace('other', 'other + 1'));
  expect(compositionExpressionEdit(binding, region, changed).replacement).toBe(changed);
  expect(() => compositionExpressionEdit(binding, region, 'Double(value, other)')).toThrow('comments');
});

it.each(['\n', '\r\n'])(
  'rebinds a variable atomically, moving exact source blocks while preserving consumers (%j)',
  async (newline) => {
    const original = `namespace binding
import rune.studio.*
func Owner:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 // earlier variable and its annotation
 alias earlier: value /* keep earlier */ + 10
 // keep later's documentation with later
 alias later: value * 2 /* trailing
 comment */
 // keep condition documentation here
 condition Positive: value > 0
 set result: earlier + later
 post-condition Good: result > 0

func Neighbor:
 output: result number (1..1)
 set result: 7
`.replaceAll('\n', newline);
    let source = original;
    const facts = async (content: string) => {
      const parsed = await parseWorkspace([
        { uri: 'memory:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE },
        { uri: 'memory:///owner.rosetta', content }
      ]);
      expect(parsed.every((entry) => !entry.hasErrors)).toBe(true);
      return describeFunctionComposition(parsed[1]!.value.elements.find(isRosettaFunction)!);
    };
    const current = await facts(source);
    const documents = new ExpressionDocument({
      getGeneration: () => 1,
      getFile: () => ({ path: 'owner', content: source }),
      onContentChange: (_, value) => {
        source = value;
      }
    });
    const binding = documents.capture('owner', 'binding.Owner#RosettaFunction', { from: 0, to: source.length })!;
    const earlier = current.steps.find((step) => step.id === 'alias:earlier')!;
    // An internal expression comment cannot be silently discarded by rebinding.
    expect(() => compositionExpressionEdit(binding, earlier.region!, 'later')).toThrow('comments');
    const candidate = compositionCandidate(binding, [
      compositionExpressionEdit(binding, earlier.region!, 'later /* keep earlier */')
    ]);
    expect(source).toBe(original);
    const ordered = reorderCompositionVariables(candidate, await facts(candidate));
    expect((await facts(ordered)).supported).toBe(true);
    expect(ordered.indexOf('alias later:')).toBeLessThan(ordered.indexOf('alias earlier:'));
    expect(ordered).toContain(
      `// keep later's documentation with later${newline} alias later: value * 2 /* trailing${newline} comment */`
    );
    expect(ordered).toContain(
      `// earlier variable and its annotation${newline} alias earlier: later /* keep earlier */`
    );
    expect(ordered.slice(ordered.indexOf(' // keep condition documentation'))).toBe(
      original.slice(original.indexOf(' // keep condition documentation'))
    );
    expect(documents.applyDocumentEdit(compositionSourceEdit(binding, ordered)).ok).toBe(true);
    expect(source).toBe(ordered);
    expect(source).toContain('set result: earlier + later');
  }
);

it('rejects transitive variable and output cycles without writing source', async () => {
  const source = `namespace cycles
import rune.studio.*
func Owner:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 alias initialValue: value + 1
 alias nextValue: initialValue * 2
 set result: nextValue
`;
  const parsed = await parseWorkspace([
    { uri: 'memory:///marker.rosetta', content: COMPOSITION_MODEL_SOURCE },
    { uri: 'memory:///cycle.rosetta', content: source }
  ]);
  const composition = describeFunctionComposition(parsed[1]!.value.elements.find(isRosettaFunction)!);
  expect(compositionBindingCycle(composition, 'alias:initialValue', 'alias:nextValue')).toBe(true);
  expect(compositionBindingCycle(composition, 'alias:initialValue', 'return')).toBe(true);
  expect(compositionBindingCycle(composition, 'alias:nextValue', 'input:value')).toBe(false);
  const cyclic = {
    ...composition,
    steps: composition.steps.map((step) =>
      step.id === 'alias:initialValue' ? { ...step, dependencies: ['alias:nextValue'] } : step
    )
  };
  expect(() => reorderCompositionVariables(source, cyclic)).toThrow('cycle');
});

it('uses canonical Rune spelling for escaped variable names instead of pasting their display label', () => {
  expect(compositionReference('value')).toBe('value');
  expect(compositionReference('first')).toBe('^first');
  expect(compositionReference('item')).toBe('^item');
  expect(compositionReference('^first')).toBe('^first');
});
