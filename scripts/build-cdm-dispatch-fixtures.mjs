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
const calendarFunctions = [
  'AddDays',
  'DateDifference',
  'DayOfWeek',
  'LeapYearDateDifference',
  'ResolveAdjustableDate',
  'ResolveAdjustableDates'
];
const suites = [
  {
    directory: 'cdm-fpml-keys',
    declarations: ['CreateAssetKey', 'CreateKey', 'CreateKeyForQuotedCurrencyPair'].map((name) => ({
      namespace: 'cdm.ingest.fpml.confirmation.pricequantity',
      name,
      kind: 'RosettaFunction'
    })),
    supportDeclarations: [
      ...['CreateQuantityKey', 'CreateQuotedCurrencyPairKey'].map((name) => ({
        namespace: 'cdm.ingest.fpml.confirmation.pricequantity',
        name,
        kind: 'RosettaFunction'
      })),
      ...['IdentifiedAsset', 'Cash', 'Security'].map((name) => ({
        namespace: 'fpml.consolidated.asset',
        name,
        kind: 'Data'
      })),
      { namespace: 'fpml.consolidated.com', name: 'CommodityLeg', kind: 'Data' },
      { namespace: 'fpml.consolidated.fx', name: 'CrossRate', kind: 'Data' }
    ],
    references: ['CreateAssetKey', 'CreateKey', 'CreateKeyForQuotedCurrencyPair']
  },
  {
    directory: 'cdm-observation-resolution',
    declarations: [
      { namespace: 'cdm.observable.event', name: 'ResolveObservation', kind: 'RosettaFunction' },
      { namespace: 'cdm.product.asset', name: 'ResolveRateIndex', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.observable.event', name: 'ResolveObservationAverage', kind: 'RosettaFunction' }
    ],
    references: ['ResolveRateIndex'],
    supportReferences: [
      'rosetta-source/src/test/java/cdm/observable/event/functions/ResolveObservationAverageTest.java',
      'rosetta-source/src/test/java/cdm/product/common/schedule/functions/ResolveRateIndexImpl.java'
    ]
  },
  {
    directory: 'cdm-valuation-times',
    declarations: [
      { namespace: 'cdm.base.datetime', name: 'TimeZoneFromBusinessCenterTime', kind: 'RosettaFunction' },
      { namespace: 'cdm.observable.common', name: 'ResolveTimeZoneFromTimeType', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.event.common', name: 'ResolvePerformanceValuationTime', kind: 'RosettaFunction' },
      { namespace: 'cdm.base.datetime', name: 'ToTime', kind: 'RosettaFunction' }
    ],
    references: []
  },
  {
    directory: 'cdm-floating-rate-metadata',
    declarations: [
      { namespace: 'cdm.observable.asset.fro', name: 'FloatingRateIndexMetadata', kind: 'RosettaFunction' },
      {
        namespace: 'cdm.event.instructioncomposition.reset',
        name: 'ExtractFloatingRateOptionData',
        kind: 'RosettaFunction'
      }
    ],
    supportDeclarations: [
      { namespace: 'cdm.observable.asset.fro', name: 'ValidateFloatingRateIndexName', kind: 'RosettaFunction' }
    ],
    references: [],
    resources: ['floating-rate-index-3-10.json']
  },
  {
    directory: 'cdm-market-observations',
    declarations: [
      { namespace: 'cdm.observable.asset.calculatedrate', name: 'IndexValueObservation', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.instructioncomposition.reset', name: 'GetMarketRates', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      {
        namespace: 'cdm.observable.asset.calculatedrate',
        name: 'IndexValueObservationMultiple',
        kind: 'RosettaFunction'
      }
    ],
    references: ['IndexValueObservation'],
    supportReferences: [
      'rosetta-source/src/main/java/cdm/observable/asset/fro/functions/IndexValueObservationEmptyDataProvider.java',
      'rosetta-source/src/test/java/cdm/observable/asset/fro/functions/IndexValueObservationTestDataProvider.java',
      'rosetta-source/src/test/java/cdm/observable/asset/fro/functions/IndexValueObservationMultipleTest.java',
      'rosetta-source/src/test/java/cdm/product/asset/floatingrate/functions/FloatingRateTestHelper.java'
    ]
  },
  {
    directory: 'cdm-billing-summary',
    declarations: [{ namespace: 'cdm.event.common', name: 'Create_BillingSummary', kind: 'RosettaFunction' }],
    references: []
  },
  {
    directory: 'cdm-floating-rate-reset',
    sharedFixture: 'cdm-billing-summary',
    declarations: [
      { namespace: 'cdm.product.asset.floatingrate', name: 'ProcessFloatingRateReset', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.observable.asset.calculatedrate', name: 'ApplyCompoundedIndexFormula', kind: 'RosettaFunction' }
    ],
    references: []
  },
  {
    directory: 'cdm-collateral-portfolio',
    sharedFixture: 'cdm-billing-summary',
    declarations: [
      { namespace: 'cdm.product.collateral', name: 'CheckEligibilityForProduct', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.position', name: 'EvaluatePortfolioState', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.product.collateral', name: 'CheckEligibilityByDetails', kind: 'RosettaFunction' }
    ],
    references: []
  },
  {
    directory: 'cdm-equity-settlement',
    sharedFixture: 'cdm-billing-summary',
    declarations: [
      { namespace: 'cdm.event.common', name: 'NewFloatingPayout', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.common', name: 'ResolveCashSettlementDate', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.event.common', name: 'NewEquitySwapProduct', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.common', name: 'EquityCashSettlementAmount', kind: 'RosettaFunction' },
      ...['DayOfWeek', 'AddDays'].map((name) => ({ namespace: 'cdm.base.datetime', name, kind: 'RosettaFunction' }))
    ],
    references: []
  },
  {
    directory: 'cdm-reset-forward-rates',
    sharedFixture: 'cdm-billing-summary',
    declarations: [
      { namespace: 'cdm.event.common', name: 'ResolveReset', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.position', name: 'InterpolateForwardRate', kind: 'RosettaFunction' }
    ],
    supportDeclarations: [
      { namespace: 'cdm.event.position', name: 'FxMarkToMarket', kind: 'RosettaFunction' },
      { namespace: 'cdm.base.datetime', name: 'DateDifference', kind: 'RosettaFunction' }
    ],
    references: []
  },
  {
    directory: 'cdm-business-calendars',
    declarations: [
      { namespace: 'cdm.base.datetime', name: 'BusinessCenterHolidays', kind: 'RosettaFunction' },
      { namespace: 'cdm.event.instructioncomposition.reset', name: 'GetNonBusinessDates', kind: 'RosettaFunction' }
    ],
    references: [],
    supportReferences: [
      'rosetta-source/src/main/java/cdm/base/datetime/functions/BusinessCenterHolidaysEmptyDataProvider.java'
    ],
    resources: ['business-center-9-3.json']
  },
  {
    directory: 'cdm-calendar',
    declarations: calendarFunctions.map((name) => ({
      namespace: 'cdm.base.datetime',
      name,
      kind: 'RosettaFunction'
    })),
    references: calendarFunctions,
    supportReferences: ['rosetta-source/src/main/java/cdm/product/common/schedule/functions/AdjustableDateUtils.java']
  },
  {
    directory: 'cdm-commodity-periods',
    declarations: [
      {
        namespace: 'cdm.ingest.fpml.confirmation.product.commodityoption',
        name: 'CalculateCommodityCalculationPeriods',
        kind: 'RosettaFunction'
      }
    ],
    references: ['CalculateCommodityCalculationPeriods']
  },
  {
    directory: 'cdm-code-list-loader',
    declarations: ['LoadCodeList', 'ValidateFpMLCodingSchemeDomain'].map((name) => ({
      namespace: 'cdm.base.staticdata.codelist',
      name,
      kind: 'RosettaFunction'
    })),
    references: ['LoadCodeList', 'ValidateFpMLCodingSchemeDomain'],
    resources: [
      'credit-event-type-1-0.json',
      'currency-1-0.json',
      'loan-legal-action-type-1-0.json',
      'option-type-1-0.json',
      'set-of-schemes-2-20.json'
    ]
  },
  {
    directory: 'cdm-strata-schedules',
    declarations: ['CalculationPeriod', 'CalculationPeriods'].map((name) => ({
      namespace: 'cdm.product.common.schedule',
      name,
      kind: 'RosettaFunction'
    })),
    supportDeclarations: [
      { namespace: 'cdm.product.common.schedule', name: 'CalculationPeriodRange', kind: 'RosettaFunction' },
      ...['AddDays', 'DateDifference', 'DayOfWeek', 'LeapYearDateDifference', 'ResolveAdjustableDate'].map((name) => ({
        namespace: 'cdm.base.datetime',
        name,
        kind: 'RosettaFunction'
      }))
    ],
    references: ['CalculationPeriod', 'CalculationPeriods'],
    supportReferences: [
      'rosetta-source/src/main/java/cdm/product/common/schedule/functions/AdjustableDateUtils.java',
      'rosetta-source/src/main/java/cdm/product/common/schedule/functions/CdmToStrataMapper.java'
    ],
    resources: ['business-center-9-3.json']
  },
  {
    directory: 'cdm-period-range',
    declarations: [
      { namespace: 'cdm.product.common.schedule', name: 'CalculationPeriodRange', kind: 'RosettaFunction' },
      { namespace: 'cdm.product.asset.calculation', name: 'Create_CalculationPeriodBase', kind: 'RosettaFunction' },
      ...['DateDifference', 'LeapYearDateDifference'].map((name) => ({
        namespace: 'cdm.base.datetime',
        name,
        kind: 'RosettaFunction'
      }))
    ],
    references: ['CalculationPeriodRange']
  },
  {
    directory: 'cdm-vectors',
    declarations: ['VectorOperation', 'VectorGrowthOperation'].map((name) => ({
      namespace: 'cdm.base.math',
      name,
      kind: 'RosettaFunction'
    })),
    references: ['VectorOperation', 'VectorGrowthOperation'],
    supportReferences: ['rosetta-source/src/main/java/cdm/base/math/functions/ArithmeticOpImpl.java']
  },
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
const fixtureHashes = new Map();
for (const suite of suites) {
  const destination = resolve(root, 'test/fixtures/third-party', suite.directory);
  const declarations = suite.declarations;
  const selection = resolveExportSelection(documents, {
    namespaces: [],
    declarations: [...declarations, ...(suite.supportDeclarations ?? [])]
  });
  if (selection.unknown.length || selection.unknownNamespaces.length)
    throw new Error('Dispatch fixture roots are unresolved.');
  const files = [];
  const sharedHashes = fixtureHashes.get(suite.sharedFixture);
  if (suite.sharedFixture && !sharedHashes) throw new Error('Shared dispatch fixture must precede its consumer.');
  if (values.write) await mkdir(destination, { recursive: true });
  for (const slice of referenceFixtureSlices(documents, selection.documents)) {
    const origin = origins.get(slice.uri);
    const sha256 = createHash('sha256').update(slice.content).digest('hex');
    const sharedFixture = sharedHashes?.get(slice.name) === sha256 ? suite.sharedFixture : undefined;
    const path = sharedFixture
      ? resolve(destination, '..', sharedFixture, slice.name)
      : resolve(destination, slice.name);
    if (values.write && !sharedFixture) await writeFile(path, slice.content);
    else if ((await readFile(path, 'utf8')) !== slice.content)
      throw new Error('Dispatch fixture changed: ' + slice.name);
    files.push({
      name: slice.name,
      upstream: origin,
      sha256,
      ...(sharedFixture ? { sharedFixture } : {})
    });
  }
  fixtureHashes.set(
    suite.directory,
    new Map(files.filter((file) => !file.sharedFixture).map((file) => [file.name, file.sha256]))
  );
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
    ...inventory.referenceFiles.filter((entry) => javaPaths.has(entry.path)),
    ...(suite.resources ?? []).map((name) => {
      const asset = inventory.resourceFiles.find((entry) => basename(entry.path) === name);
      if (!asset) throw new Error('Missing pinned fixture resource: ' + name);
      return asset;
    })
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
      : asset.path.endsWith('.json')
        ? 'resources/' + basename(asset.path)
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
