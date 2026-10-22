// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA } from '@rune-langium/core';
import { URI } from 'langium';
import { generate, generatePreviewSchemas } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('checks canonical aliases and preconditions without executing assignments or postconditions', async () => {
  const { RuneDsl } = createRuneDslServices();
  const docs = [
    BASICTYPES_ROSETTA,
    `namespace flow
func Calculate:
 inputs:
  value number (1..1)
 output:
  result number (1..1)
 alias doubled: value * 2
 condition Positive:
  doubled > 0
 set result: value
 post-condition Never:
  result < 0`
  ].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///flow-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  expect(docs.flatMap((d) => d.parseResult.parserErrors)).toEqual([]);
  const outputs = await generate(docs, {
    target: 'typescript',
    typescript: { layout: 'single-file', inputChecks: true }
  });
  const generated = outputs.flatMap((o) => o.funcs).find((f) => f.name === 'Calculate')!;
  expect(generated.inputCheckExportName).toBeTruthy();
  const exports = compileGeneratedTypeScript(outputs);
  const check = exports[generated.inputCheckExportName!] as (value: number) => void;
  expect(() => check(2)).not.toThrow();
  expect(() => check(-2)).toThrow(/Positive/);
  const execute = exports[generated.exportName!] as (value: number) => number;
  expect(() => execute(2)).toThrow(/Never/);
  const result = generatePreviewSchemas(docs).find((s) => s.targetId === 'flow.Calculate')?.result;
  expect(result).toMatchObject({ path: 'result', kind: 'number' });
  const ordinary = await generate(docs, { target: 'typescript' });
  expect(ordinary.flatMap((o) => o.funcs).every((f) => !f.inputCheckExportName)).toBe(true);
});
