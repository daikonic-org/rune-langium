#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createRuneDslServices, addLegacyAnnotations, setProjectDocumentModel } from '../packages/core/dist/index.js';
import { URI } from '../packages/core/node_modules/langium/lib/index.js';
import { resolveExportSelection } from '../packages/codegen/dist/src/export.js';
import { nativeSourceBlobHash } from './lib/native-implementation-inventory.mjs';
import { referenceFixtureSlices } from './lib/reference-fixture-slices.mjs';

const { values } = parseArgs({ options: { 'cache-dir': { type: 'string' }, write: { type: 'boolean' } } });
const root = resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await readFile(resolve(root, 'docs/implementations/native-coverage.json'), 'utf8'));
const sources = JSON.parse(
  await readFile(resolve(root, 'scripts/fixtures/native-implementation-sources.json'), 'utf8')
);
if (JSON.stringify(inventory.sources) !== JSON.stringify(sources))
  throw new Error('Dispatch fixtures require the audited cohort.');
const cache = resolve(root, values['cache-dir'] ?? 'dist/native-implementation-audit');
const suites = [
  {
    directory: 'cdm-rounding',
    declarations: ['RoundToPrecision', 'RoundToNearest', 'RoundToSignificantFigures'].map((name) => ({
      namespace: 'cdm.base.math',
      name,
      kind: 'RosettaFunction'
    })),
    references: ['RoundToPrecision', 'RoundToNearest', 'RoundToSignificantFigures']
  },
  {
    directory: 'cdm-dispatch',
    declarations: ['DayCountBasis', 'YearFraction'].map((name) => ({
      namespace: 'cdm.base.datetime.daycount',
      name,
      kind: 'RosettaFunction'
    })),
    references: ['DateDifference', 'LeapYearDateDifference']
  },
  {
    directory: 'cdm-calculation-period',
    declarations: [
      { namespace: 'cdm.observable.asset.calculatedrate', name: 'ComputeCalculationPeriod', kind: 'RosettaFunction' }
    ],
    references: ['ComputeCalculationPeriod'],
    supportReferences: [
      'rosetta-source/src/test/java/cdm/observable/asset/calculatedrate/functions/CalculatedRateTestHelper.java',
      'rosetta-source/src/test/java/cdm/product/asset/floatingrate/functions/FloatingRateTestHelper.java'
    ]
  },
  {
    directory: 'cdm-frequency',
    declarations: [{ namespace: 'cdm.product.common.schedule', name: 'PeriodsInYear', kind: 'RosettaFunction' }],
    references: [],
    supportReferences: ['rosetta-source/src/main/java/cdm/product/common/schedule/functions/CdmToStrataMapper.java']
  },
  {
    directory: 'cdm-strike-schedule',
    declarations: [
      {
        namespace: 'cdm.ingest.fpml.confirmation.pricequantity',
        name: 'MapCommodityOptionStrikePriceSchedule',
        kind: 'RosettaFunction'
      }
    ],
    references: ['MapCommodityOptionStrikePriceSchedule']
  }
];
const { RuneDsl } = createRuneDslServices();
const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
const documents = [],
  origins = new Map();
for (const file of inventory.files) {
  const source = sources.find((entry) => entry.model === file.model);
  if (!source) throw new Error('Unknown dispatch fixture model.');
  const content = await readFile(resolve(cache, source.model, source.commit, file.path), 'utf8');
  if (nativeSourceBlobHash(content) !== file.blob) throw new Error('Dispatch source checksum mismatch: ' + file.path);
  const uri = URI.parse(`file:///${source.model}/${file.path}`);
  let document = factory.fromString(content, uri);
  if (source.model === 'rune-dsl' && file.path.endsWith('/annotations.rosetta'))
    document = addLegacyAnnotations(document, factory);
  RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
  setProjectDocumentModel(RuneDsl, uri, source.model);
  documents.push(document);
  origins.set(uri.toString(), { ...file, sha256: createHash('sha256').update(content).digest('hex') });
}
await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false, eagerLinking: true });
for (const suite of suites) {
  const destination = resolve(root, 'test/fixtures/third-party', suite.directory);
  const declarations = suite.declarations;
  const selection = resolveExportSelection(documents, { namespaces: [], declarations });
  if (selection.unknown.length || selection.unknownNamespaces.length)
    throw new Error('Dispatch fixture roots are unresolved.');
  const files = [];
  if (values.write) await mkdir(destination, { recursive: true });
  for (const slice of referenceFixtureSlices(documents, selection.documents)) {
    const origin = origins.get(slice.uri);
    const path = resolve(destination, slice.name);
    if (values.write) await writeFile(path, slice.content);
    else if ((await readFile(path, 'utf8')) !== slice.content)
      throw new Error('Dispatch fixture changed: ' + slice.name);
    files.push({
      name: slice.name,
      upstream: origin,
      sha256: createHash('sha256').update(slice.content).digest('hex')
    });
  }
  const references = [];
  const javaPaths = new Set(
    inventory.functions
      .filter((entry) => suite.references.includes(entry.symbol.name))
      .flatMap((entry) =>
        [...entry.referenceJava.implementations, ...entry.referenceJava.tests].map((reference) => reference.path)
      )
  );
  for (const path of suite.supportReferences ?? []) javaPaths.add(path);
  const assets = [
    ...inventory.notices.filter((entry) => files.some((file) => file.upstream.model === entry.model)),
    ...inventory.referenceFiles.filter((entry) => javaPaths.has(entry.path))
  ];
  for (const asset of assets) {
    const source = sources.find((entry) => entry.model === asset.model);
    const content = await readFile(resolve(cache, source.model, source.commit, asset.path), 'utf8');
    if (
      nativeSourceBlobHash(content) !== asset.blob ||
      createHash('sha256').update(content).digest('hex') !== asset.sha256
    )
      throw new Error('Dispatch reference checksum mismatch: ' + asset.path);
    const name = asset.path.endsWith('.java')
      ? 'java/' + basename(asset.path)
      : asset.model + '-' + basename(asset.path);
    const path = resolve(destination, name);
    if (values.write) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    } else if ((await readFile(path, 'utf8')) !== content) throw new Error('Dispatch reference changed: ' + name);
    references.push({ name, upstream: asset, sha256: asset.sha256 });
  }
  const manifest =
    JSON.stringify(
      {
        schemaVersion: 1,
        sources,
        declarations,
        files,
        references,
        normalization:
          'Original namespace/import header and unmodified CST declaration bodies; inter-declaration whitespace only. Java and notice files are unmodified.'
      },
      null,
      2
    ) + '\n';
  const path = resolve(destination, 'sources.json');
  if (values.write) await writeFile(path, manifest);
  else if ((await readFile(path, 'utf8')) !== manifest) throw new Error('Dispatch fixture manifest changed.');
  console.log(
    `${values.write ? 'Wrote' : 'Verified'} ${suite.directory}: ${files.length} pinned dispatch files, ${selection.included.length} declaration identities.`
  );
}
