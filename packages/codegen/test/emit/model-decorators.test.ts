// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { runtimeHelperSource } from '../../src/helpers.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace decorated
annotation metadata:
 reference string (0..1)
type Base:
 ^label string (0..1)
type Child extends Base:
 override ^label string (1..1)
 next Child (0..1)
type Holder:
 child Child (0..1)
  [metadata reference]
choice Selected:
 Child
type Tagged extends Selected:
 note string (0..1)
`;

it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
  'uses the same model definitions with decorators and registration calls (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      source,
      URI.parse('inmemory:///decorated.rosetta')
    );
    const basic = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      BASICTYPES_ROSETTA,
      URI.parse('inmemory:///basic.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([basic, document]);
    assertValidDocuments([document]);
    const options = layout === 'inline' ? { inlineHelpers: true } : { layout };
    const decorated = await generate(document, { target: 'typescript', typescript: options });
    const model = decorated.find((output) => output.content.includes('export class Base '))!;
    expect(model.content).toContain('@RuneObject.model(');
    expect(model.content).toContain('@RuneObject.field(');
    expect(model.content).not.toMatch(/const __selections|const __deep|this\.define\(/);
    const outputs = await generate(document, { target: 'typescript', typescript: { ...options, decorators: false } });
    const calls = outputs.find((output) => output.relativePath === model.relativePath)!;
    expect(calls.content).not.toContain('@RuneObject.');
    expect(calls.content).toContain('RuneObject.decorate(Child,');
    const api = compileGeneratedTypeScript<{ run: () => unknown }>(
      outputs.map((output) =>
        output === calls
          ? {
              ...output,
              content:
                output.content +
                `
export function run() {
 const child = Child.from({ label: 'first', next: { label: 'second' } });
 const holder = Holder.from({ child: { value: child, externalReference: 'child-1' } });
 const tagged = Tagged.from({ child, note: 'tag' });
 return [child instanceof Base, child._.label, holder.toJSON({ format: 'RUNE_JSON' }), tagged.toJSON()];
}`
            }
          : output
      ),
      { entry: calls.relativePath }
    );
    expect(api.run()).toEqual([
      true,
      'first',
      {
        '@type': 'decorated.Holder',
        child: {
          '@type': 'decorated.Child',
          '@ref:external': 'child-1',
          label: 'first',
          next: { '@type': 'decorated.Child', label: 'second', next: undefined }
        }
      },
      { child: { label: 'first', next: { label: 'second', next: undefined } }, note: 'tag' }
    ]);
  }
);

it('registers decorators without traversing linked field types during module evaluation', () => {
  const content = `${runtimeHelperSource(true, true, true, true)}
let reads = 0;
@RuneObject.model({ identity: 'decorator.Lazy' })
class Lazy extends RuneObject {
 static readonly [key: symbol]: () => RuneValueType;
 @RuneObject.field({ min: 0, max: 1, type: () => { reads++; return runeModel(Lazy); }, check: (value: unknown) => value instanceof Lazy })
 child?: Lazy;
}
export function run() {
 const before = reads;
 const first = runeModel(Lazy).selections;
 const after = reads;
 return [before, after > 0, first === runeModel(Lazy).selections];
}`;
  const api = compileGeneratedTypeScript<{ run: () => unknown }>([
    { relativePath: 'lazy.ts', content, diagnostics: [], sourceMap: [], funcs: [] }
  ]);
  expect(api.run()).toEqual([0, true, true]);
});
