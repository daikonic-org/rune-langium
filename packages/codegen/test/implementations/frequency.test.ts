// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI } from 'langium';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertValidDocuments, createRuneDslServices } from '@rune-langium/core';
import { generateSelected, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import {
  frequencyCases,
  frequencyDirectory,
  frequencyFiles,
  frequencyIdentity,
  strataFrequencyCases
} from '../../../../test/helpers/cdm-frequency.js';

async function documents(withImplementation = true) {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const docs = frequencyFiles(withImplementation).map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  return docs;
}
let docs: Awaited<ReturnType<typeof documents>>;
beforeAll(async () => {
  docs = await documents();
});

it('preserves the independent handwritten Strata source and license with verified hashes', () => {
  const manifest: { files: { name: string; sha256: string }[] } = JSON.parse(
    readFileSync(resolve(frequencyDirectory, 'strata.json'), 'utf8')
  );
  expect(manifest.files.map((asset) => asset.name)).toContain('java/Frequency.java');
  for (const asset of manifest.files) {
    const bytes = readFileSync(resolve(frequencyDirectory, asset.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    if (asset.name.startsWith('strata-'))
      expect(
        readFileSync(
          resolve(
            import.meta.dirname,
            '../../../../packages/project-runtime/src/curated-implementations/rune',
            asset.name
          )
        )
      ).toEqual(bytes);
  }
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'executes the Rune frequency contract through a selected caller in strict %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      {
        namespaces: [],
        declarations: [{ namespace: 'example.frequency', name: 'AnnualPeriods', kind: 'RosettaFunction' }]
      },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(selected.outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const output = selected.outputs.find((output) => output.funcs.some((fn) => fn.name === 'AnnualPeriods'))!;
    const fn = output.funcs.find((fn) => fn.name === 'AnnualPeriods')!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: output.relativePath });
    for (const test of frequencyCases) {
      const unchanged = JSON.stringify(test.inputs);
      const invoke = () => module[fn.exportName!]!(test.inputs.frequency);
      if (test.expectedError) expect(invoke, test.id).toThrow(new RegExp(test.expectedError, 'i'));
      else expect(invoke(), test.id).toBe(test.expected);
      expect(JSON.stringify(test.inputs), test.id).toBe(unchanged);
    }
    const library = selected.outputs.find((output) => output.funcs.some((fn) => fn.name === 'EventsPerYear'))!;
    const strata = compileGeneratedTypeScript(selected.outputs, { entry: library.relativePath });
    const invokeLibrary = (name: string, ...inputs: unknown[]) => {
      const fn = library.funcs.find((fn) => fn.name === name)!;
      return strata[fn.exportName!]!(...inputs);
    };
    for (const test of strataFrequencyCases) {
      const invoke = () =>
        invokeLibrary('EventsPerYear', test.term ? invokeLibrary('Term') : invokeLibrary('OfPeriod', test.period));
      if (test.expectedError) expect(invoke, test.id).toThrow(new RegExp(test.expectedError, 'i'));
      else expect(invoke(), test.id).toBe(test.expected);
    }
  }
);

it('executes the same Rune contract in standalone Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const fn = python.bindings.get('example.frequency.AnnualPeriods')!;
  const results = runPython(
    [
      ...frequencyCases.map((test) => ({ expression: `${fn}(data['frequency'])`, data: test.inputs })),
      ...strataFrequencyCases.map((test) => ({
        expression: `${python.bindings.get('com.opengamma.strata.basics.schedule.EventsPerYear')}(${
          test.term
            ? python.bindings.get('com.opengamma.strata.basics.schedule.Term') + '()'
            : python.bindings.get('com.opengamma.strata.basics.schedule.OfPeriod') + "(data['period'])"
        })`,
        data: { period: test.period }
      }))
    ],
    python.code,
    { includeRuntime: false }
  );
  for (const [index, test] of [...frequencyCases, ...strataFrequencyCases].entries()) {
    if (test.expectedError)
      expect(results[index], test.id).toMatchObject({
        error: expect.stringMatching(new RegExp(test.expectedError, 'i'))
      });
    else expect(results[index], test.id).toEqual({ value: test.expected });
  }
});

it('reports the missing implementation after the ordinary Rune override is removed', async () => {
  for (const withImplementation of [true, false]) {
    const documents_ = await documents(withImplementation);
    const schemas = generatePreviewSchemas(documents_);
    const schema = schemas.find((schema) => schema.targetId === frequencyIdentity);
    expect(schema).toBeDefined();
    expect(Boolean(schema?.executionUnavailable), `withImplementation=${withImplementation}`).toBe(!withImplementation);
  }
});
