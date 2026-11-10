// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { URI } from 'langium';
import { BASICTYPES_ROSETTA, createRuneDslServices, assertValidDocuments } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('initializes a namespace cycle before downstream enum consumers in a single-file Zod bundle', async () => {
  const { RuneDsl } = createRuneDslServices();
  const texts = [
    BASICTYPES_ROSETTA,
    `namespace a
import b.B
enum Kind:
 Allowed
typeAlias DeferredB: B`,
    `namespace b
import a.Kind
type B:
 kind Kind (1..1)`,
    `namespace z
import a.Kind
type Consumer:
 kind Kind (1..1)`
  ];
  const documents = texts.map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      text,
      URI.parse(`inmemory:///namespace-cycle-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
  assertValidDocuments(documents);
  const outputs = await generate(documents, { target: 'zod', zod: { layout: 'single-file' } });
  const module =
    compileGeneratedTypeScript<Record<string, { safeParse(input: unknown): { success: boolean } }>>(outputs);
  expect(module.ConsumerSchema!.safeParse({ kind: 'Allowed' }).success).toBe(true);
  expect(module.ConsumerSchema!.safeParse({ kind: 'Unknown' }).success).toBe(false);
  expect(module.DeferredBSchema!.safeParse({ kind: 'Allowed' }).success).toBe(true);
});

it.each([
  ['per-namespace', false, false],
  ['per-namespace', true, true],
  ['barrel', false, true],
  ['single-file', false, true]
] as const)(
  'initializes cross-namespace base classes in %s output (inline %s, decorators %s)',
  async (layout, inlineHelpers, decorators) => {
    const { RuneDsl } = createRuneDslServices();
    const texts = [
      BASICTYPES_ROSETTA,
      ...['alpha', 'beta'].map((namespace, index) => {
        const other = index === 0 ? 'beta' : 'alpha';
        return `namespace ${namespace}
type Base:
 value int (1..1)
 other ${other}.Child (0..1)
type Child extends ${other}.Base:
 extra int (1..1)
typeAlias InputAlias: Child
func Build:
 inputs: value int (1..1)
 output: result Child (1..1)
 set result: Child { value: value, extra: value + ${index} }
`;
      })
    ];
    const documents = texts.map((text, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse('inmemory:///namespace-inheritance-' + index + '.rosetta')
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
    assertValidDocuments(documents);

    const outputs = await generate(documents, {
      target: 'typescript',
      strict: true,
      typescript: { layout, inlineHelpers, decorators, inputChecks: true }
    });
    const entry = layout === 'single-file' ? 'model' : layout === 'barrel' ? 'index' : undefined;
    const alphaImports = entry
      ? '__rune$alpha$Child as AlphaChild, __rune$alpha$Base as AlphaBase, __rune$alpha$Build as AlphaBuild, type __rune$alpha$InputAlias as AlphaInput'
      : 'Child as AlphaChild, Base as AlphaBase, Build as AlphaBuild, type InputAlias as AlphaInput';
    const betaImports = entry
      ? '__rune$beta$Child as BetaChild, __rune$beta$Base as BetaBase, __rune$beta$Build as BetaBuild'
      : 'Child as BetaChild, Base as BetaBase, Build as BetaBuild';
    const verification = {
      relativePath: 'verification.ts',
      content: `import { ${alphaImports} } from './${entry ?? 'alpha'}.js';
import { ${betaImports} } from './${entry ?? 'beta'}.js';
const alpha: AlphaInput = new AlphaChild({ value: 1, extra: 2 });
const beta = new BetaChild({ value: 3, extra: 4 });
export const checks = [alpha instanceof BetaBase, beta instanceof AlphaBase, AlphaBuild(5).extra, BetaBuild(5).extra];
`,
      sourceMap: [],
      diagnostics: [],
      funcs: []
    };
    const runtime = compileGeneratedTypeScript<Record<string, unknown>>([...outputs, verification], {
      entry: verification.relativePath
    });
    expect(runtime.checks).toEqual([true, true, 5, 6]);
    for (const namespace of ['alpha', 'beta']) {
      const output = outputs.find((item) => item.relativePath === namespace + '.ts');
      if (entry === undefined) {
        expect(output?.funcs[0]).toMatchObject({ exportName: 'Build', inputCheckExportName: '$rune$check$Build' });
        expect(output?.content).toContain("from './rune_component_");
      }
    }
  },
  20_000
);
