// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors
import { expect, it } from 'vitest';
import {
  parseWorkspace,
  isRosettaFunction,
  COMPOSITION_MODEL_SOURCE,
  describeFunctionComposition
} from '../../src/index.js';

const header = `namespace test.compositions
import rune.studio.*
func Twice:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
`;
async function describe(source: string, marker = COMPOSITION_MODEL_SOURCE) {
  const parsed = await parseWorkspace([
    { uri: 'memory:///composition-marker.rosetta', content: marker },
    { uri: 'memory:///composition.rosetta', content: source }
  ]);
  expect(parsed.every((entry) => !entry.hasErrors)).toBe(true);
  const func = parsed[1]!.value.elements.find(isRosettaFunction)!;
  return { func, result: describeFunctionComposition(func), source };
}
it('uses the exact linked annotation identity and does not infer eligibility from names', async () => {
  const { result } = await describe(header + ' set result: value * 2');
  expect(result).toMatchObject({ optedIn: true, supported: true });
  const wrong = await describe(
    (header + ' set result: value').replace('rune.studio', 'other'),
    COMPOSITION_MODEL_SOURCE.replace('rune.studio', 'other')
  );
  expect(wrong.result.optedIn).toBe(false);
  expect((await describe((header + ' set result: value').replace(' [composition]\n', ''))).result.optedIn).toBe(false);
});
it('projects dependencies and exact expression ranges without modifying source or trivia', async () => {
  const source =
    header +
    ' // keep this\n alias scaled: value * 2\n condition Positive: value > 0\n set result: scaled\n post-condition Good: result > 0\n\nfunc Neighbor:\n output: next number (1..1)\n set next: 7';
  const { result } = await describe(source);
  expect(result.supported).toBe(true);
  expect(result.steps.map((step) => [step.id, step.dependencies])).toEqual([
    ['input:value', []],
    ['alias:scaled', ['input:value']],
    ['return', ['alias:scaled']]
  ]);
  expect(
    result.steps.filter((step) => step.region).map((step) => source.slice(step.region!.from, step.region!.to))
  ).toEqual(['value * 2', 'scaled']);
});
it.each([
  ['nested assignments', ' set result: value\n set result: 3'],
  ['accumulation', ' add result: value'],
  ['unresolved references', ' alias scaled: missing\n set result: scaled'],
  ['forward dependencies', ' alias a: b\n alias b: value\n set result: a']
])('retains %s in Source with located reasons', async (_, body) => {
  const { result, source } = await describe(header + body);
  expect(result).toMatchObject({ optedIn: true, supported: false });
  expect(result.reasons.length).toBeGreaterThan(0);
  expect(result.reasons.every((reason) => reason.region.from >= 0 && reason.region.to <= source.length)).toBe(true);
});
it('retains scoped per-item calls and their canonical callee signature', async () => {
  const { result } = await describe(
    header.replace('func Twice:', 'func Times:').replace('(1..1)\n output:', '(1..*)\n output:') +
      ' alias scaled: value extract [ Double(item) ]\n set result: scaled\nfunc Double:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value * 2'
  );
  expect(result.supported).toBe(true);
  expect(result.steps[1]).toMatchObject({
    kind: 'each',
    dependencies: ['input:value'],
    call: { identity: 'test.compositions.Double', inputs: [{ name: 'value', type: 'number' }] }
  });
});

it('identifies variable arguments and shared producers from resolved references', async () => {
  const { result } = await describe(
    header +
      ` alias initialValue: value
 alias next: Double(initialValue)
 alias shared: next
 set result: shared
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2`
  );
  expect(result.supported).toBe(true);
  expect(result.steps[1]).toMatchObject({ variableSource: 'input:value', parameter: { type: 'number' } });
  expect(result.steps[2]?.call?.argumentVariables).toEqual(['alias:initialValue']);
  expect(result.steps[3]).toMatchObject({ variableSource: 'alias:next' });
});

it('keeps implicit item and explicitly named per-item arguments scoped to their node', async () => {
  for (const [body, name] of [
    ['value extract [ Double(item) ]', 'item'],
    ['value extract entry [ Double(entry) ]', 'entry']
  ]) {
    const { result } = await describe(
      header.replace('value number (1..1)', 'value number (1..*)') +
        ` alias mapped: ${body}
 set result: mapped
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2`
    );
    expect(result.supported).toBe(true);
    expect(result.steps[1]?.locals).toEqual([name]);
    expect(result.steps[1]?.call?.argumentVariables).toEqual([`local:alias:mapped:${name}`]);
  }
});

it('rejects reading the function output before its definition', async () => {
  const { result } = await describe(header + ' alias recursive: result + 1\n set result: recursive');
  expect(result.supported).toBe(false);
  expect(result.reasons.some((reason) => reason.code === 'forward-reference')).toBe(true);
});

it('keeps incomplete call signatures in Source rather than showing unbindable ports', async () => {
  const { result } = await describe(
    header +
      ` alias incomplete: Double()
 set result: incomplete
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2`
  );
  expect(result.supported).toBe(false);
  expect(result.reasons[0]?.message).toContain('positional call argument');
});
