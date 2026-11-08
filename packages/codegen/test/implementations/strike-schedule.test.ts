// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { URI } from 'langium';
import { Temporal } from '@js-temporal/polyfill';
import { assertValidDocuments, createRuneDslServices } from '@rune-langium/core';
import { generateSelected, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import {
  strikeScheduleCases,
  strikeScheduleFiles,
  strikeScheduleIdentity,
  strikeScheduleDirectory
} from '../../../../test/helpers/cdm-strike-schedule.js';

async function documents(withImplementation = true) {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const docs = strikeScheduleFiles(withImplementation).map(({ uri, content }) =>
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

it('pins the handwritten Java algorithm and retains its original source/license bytes', () => {
  const sources: { references: { name: string; sha256: string }[] } = JSON.parse(
    readFileSync(resolve(strikeScheduleDirectory, 'sources.json'), 'utf8')
  );
  const oracle: { files: { name: string; sha256: string }[] } = JSON.parse(
    readFileSync(resolve(strikeScheduleDirectory, 'java-oracle.json'), 'utf8')
  );
  expect(oracle.files).toHaveLength(1);
  const reference = oracle.files[0]!;
  expect(sources.references).toContainEqual(
    expect.objectContaining({ name: reference.name, sha256: reference.sha256 })
  );
  for (const asset of sources.references)
    expect(
      createHash('sha256')
        .update(readFileSync(resolve(strikeScheduleDirectory, asset.name)))
        .digest('hex')
    ).toBe(asset.sha256);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'preserves positional mapping and explicit partial rows in strict %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      docs,
      { namespaces: ['example.strike'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(selected.outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const output = selected.outputs.find((output) => output.funcs.some((fn) => fn.name === 'StrikeSchedule'))!;
    const fn = output.funcs.find((fn) => fn.name === 'StrikeSchedule')!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: output.relativePath });
    for (const test of strikeScheduleCases) {
      const prices = structuredClone(test.inputs.fpmlStrikePricePerUnitStepList);
      const dates = test.inputs.fpmlCommodityStrikePriceDateList.map((date) => Temporal.PlainDate.from(date));
      const unchanged = JSON.stringify([prices, dates]);
      const result = module[fn.exportName!]!(prices, dates);
      expect(JSON.parse(JSON.stringify(result)), test.id).toEqual(test.expected);
      expect(JSON.stringify([prices, dates]), test.id).toBe(unchanged);
    }
  }
);

it('executes the same Rune implementation and partial results in Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const fn = python.bindings.get(strikeScheduleIdentity)!;
  const results = runPython(
    strikeScheduleCases.map((test) => ({ expression: `${fn}(data)`, data: test.inputs })),
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual(strikeScheduleCases.map((test) => ({ value: test.expected })));
});

it('restores direct unavailability when the workspace override is absent', async () => {
  const missing = await documents(false);
  expect(
    generatePreviewSchemas(missing).find((schema) => schema.targetId === strikeScheduleIdentity)?.executionUnavailable
  ).toBeTruthy();
});
