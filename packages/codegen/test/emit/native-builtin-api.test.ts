// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import {
  createRuneDslServices,
  BASICTYPES_ROSETTA,
  assertValidDocuments,
  isRosettaFunction,
  isRosettaModel
} from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { renderSourceTypeScriptExpression } from '../../src/projection/source-typescript-expression.js';
import { parseSourceTs } from '../../src/lens/typescript/source-lens.js';
import { renderExpression } from '../../src/emit/rosetta/render-expression.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace nativeBuiltins
typeAlias Expression: pattern
type Settings:
 at time (1..1)
 expression Expression (1..1)
 alternatives pattern (0..*)
func Copy:
 inputs: settings Settings (1..1)
 output: result Settings (1..1)
 set result: settings
func Fixed:
 output: result pattern (1..1)
 set result: "^a/b[0-9]+$"
func Text:
 output: result string (1..1)
 set result: "^a/b[0-9]+$"
func Same:
 inputs:
  left pattern (1..1)
  right pattern (1..1)
 output: result boolean (1..1)
 set result: left = right
func Unique:
 inputs: values pattern (0..*)
 output: result pattern (0..*)
 set result: values distinct
func Construct:
 inputs: at time (1..1)
 output: result Settings (1..1)
 set result: Settings { at: at, expression: "^x+$", alternatives: ["a", "b"] }
`;

interface Value {
  at: { toString(): string };
  expression: RegExp;
  alternatives: RegExp[];
}
type View = Value & { toJSON(options?: { format: 'RUNE_JSON' }): unknown };
type Api = {
  Settings: {
    fromJSON(value: unknown, options?: { format: 'RUNE_JSON' }): View;
    is(value: unknown): boolean;
    from(value: Value): View;
  };
  Copy(value: Value): Value;
  Fixed(): RegExp;
  Text(): string;
  Same(left: RegExp, right: RegExp): boolean;
  Unique(values: RegExp[]): RegExp[];
  Construct(at: unknown): Value;
};

it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
  'uses native time and pattern implementations (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const docs = [BASICTYPES_ROSETTA, source].map((text, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///native-${i}.rosetta`))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, {
      target: 'typescript',
      typescript: layout === 'inline' ? { inlineHelpers: true } : { layout }
    });
    const builtin = outputs.find((output) => output.content.includes('export type pattern = RegExp;'))!;
    expect(builtin.content).toContain('export type time = Temporal.PlainTime;');
    const model = outputs.find((output) => output.content.includes('export class Settings '))!;
    expect(model.content).toContain('expression: RegExp;');
    expect(model.content).toContain('/^a\\/b[0-9]+$/');
    expect(model.content).toMatch(/return ['"]\^a\/b\[0-9\]\+\$['"]/);
    const api = compileGeneratedTypeScript<Api>(outputs, {
      entry: model.relativePath,
      assertions: `
const value: Settings.Shape = { at: Temporal.PlainTime.from('12:34:56'), expression: /x/, alternatives: [/y/] };
const copy: Settings.Shape = Copy(value);
const expr: RegExp = Settings.from(value).expression;
// @ts-expect-error plain strings are not native pattern values
const invalid: Settings.Shape = { ...value, expression: 'x' };
`
    });
    const json = { at: '12:34:56', expression: '^x+$', alternatives: ['a', 'b'] };
    const view = api.Settings.fromJSON(json);
    const value = view;
    expect(value.at.toString()).toBe('12:34:56');
    expect(value.expression).toBeInstanceOf(RegExp);
    expect(value.expression.test('xxx')).toBe(true);
    expect(value.alternatives.map((value) => value.source)).toEqual(['a', 'b']);
    expect(api.Copy(value).expression).toBe(value.expression);
    expect(api.Settings.is(value)).toBe(true);
    expect(api.Settings.is({ ...value, expression: 'x' })).toBe(false);
    expect(api.Fixed().test('a/b123')).toBe(true);
    expect(api.Text()).toBe('^a/b[0-9]+$');
    expect(api.Same(/x/, /x/)).toBe(true);
    expect(api.Same(/x/, /y/)).toBe(false);
    expect(api.Unique([/x/, /y/, /x/]).map((value) => value.source)).toEqual(['x', 'y']);
    expect(api.Construct(value.at).expression.source).toBe('^x+$');
    expect(JSON.parse(JSON.stringify(view.toJSON()))).toEqual(json);
    const wire = view.toJSON({ format: 'RUNE_JSON' });
    expect(wire).toEqual({ '@type': 'nativeBuiltins.Settings', ...json });
    expect(api.Settings.fromJSON(wire, { format: 'RUNE_JSON' }).toJSON({ format: 'RUNE_JSON' })).toEqual(wire);
    expect(() => api.Settings.fromJSON({ ...json, expression: '[' })).toThrow();
    expect(() => api.Settings.fromJSON({ ...json, at: '25:00' })).toThrow();
    expect(() => api.Settings.from({ ...value, expression: /x/i }).toJSON({ format: 'RUNE_JSON' })).toThrow(/flags/);

    const root = docs[1]!.parseResult.value;
    if (!isRosettaModel(root)) throw Error('Missing model');
    const fixed = root.elements.find((node) => isRosettaFunction(node) && node.name === 'Fixed');
    expect(isRosettaFunction(fixed)).toBe(true);
    if (!isRosettaFunction(fixed)) throw Error('Missing Fixed function');
    const projection = renderSourceTypeScriptExpression(fixed.operations[0]!.expression);
    expect(projection.code).toContain('/^a\\/b[0-9]+$/');
    const edited = await parseSourceTs('/^b+$/');
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(renderExpression(edited.node)).toBe('"^b+$"');
    expect((await parseSourceTs('/x/i')).ok).toBe(false);
  }
);
