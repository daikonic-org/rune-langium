// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { projectFileRevision } from '@rune-langium/project-config';
import { Temporal } from '@js-temporal/polyfill';
import { generateSelected, generatePythonModule } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { createBenchmarkProject, benchmarkIndex } from '../../../test/helpers/benchmark-project.js';
import { marketDeclarations } from '../../../test/helpers/cdm-market-observations.js';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import {
  fetchBenchmarkSnapshot,
  benchmarkSnapshotId,
  benchmarkTerms,
  renderBenchmarkSelection,
  fetchBenchmarkSelection
} from '../src/market-data.js';

async function selectionFixture() {
  const original = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, {
    fetcher: benchmarkFetch,
    now: () => '2026-11-13T12:00:00.000Z'
  });
  const content = original.content.replace('4.33', '4.55');
  const corrected = {
    ...original,
    content,
    source: { ...original.source, retrievedAt: '2026-11-14T12:00:00.000Z', sha256: await projectFileRevision(content) }
  };
  const manifest = {
    schemaVersion: 1,
    decoder: 'benchmark-v1',
    window: benchmarkWindow,
    datasets: [
      {
        series: 'sofr',
        generation: 2,
        terms: benchmarkTerms('sofr'),
        snapshots: [
          { id: await benchmarkSnapshotId(original), dates: ['2026-11-03'] },
          { id: await benchmarkSnapshotId(corrected), dates: ['2026-11-02'] }
        ]
      }
    ]
  };
  return { original, corrected, manifest };
}

it(
  'executes an explicit multi-capture revision selection in strict TypeScript and standalone Python',
  async () => {
    const { original, corrected, manifest } = await selectionFixture();
    const project = await createBenchmarkProject([original, corrected], manifest);
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: [...marketDeclarations] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'GetMarketRates'))!;
    const fn = entry.funcs.find((fn) => fn.name === 'GetMarketRates')!;
    const module = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    const result = module[fn.exportName!]!(
      benchmarkIndex('sofr').floatingRateIndex,
      ['2026-11-03', '2026-11-02', '2026-11-03'].map((date) => Temporal.PlainDate.from(date))
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual([
      { date: '2026-11-03', value: 0.0432 },
      { date: '2026-11-02', value: 0.0455 },
      { date: '2026-11-03', value: 0.0432 }
    ]);
    const python = generatePythonModule(graph.documents);
    const binding = python.bindings.get('cdm.observable.asset.calculatedrate.IndexValueObservation');
    expect(
      runPython(
        [
          {
            expression: `${binding}(data)`,
            data: { observationDate: '2026-11-02', interestRateIndex: benchmarkIndex('sofr') }
          }
        ],
        python.code,
        { includeRuntime: false }
      )
    ).toEqual([{ value: 0.0455 }]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('rejects implicit overlap, missing captures and changed snapshot provenance', async () => {
  const { original, corrected, manifest } = await selectionFixture();
  await expect(renderBenchmarkSelection(manifest, [original])).rejects.toThrow('exactly');
  const first = manifest.datasets[0]!.snapshots[0]!;
  first.dates.push('2026-11-02');
  await expect(renderBenchmarkSelection(manifest, [original, corrected])).rejects.toThrow('Duplicate');
  first.dates.pop();
  await expect(
    renderBenchmarkSelection(manifest, [
      { ...original, source: { ...original.source, retrievedAt: '2026-11-12T12:00:00.000Z' } },
      corrected
    ])
  ).rejects.toThrow('Unexpected');
});

it('rejects unsafe catalog origins before requesting anything', async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error('Should not fetch.');
  };
  await expect(fetchBenchmarkSelection('http://example.com', ['sofr'], benchmarkWindow, { fetcher })).rejects.toThrow(
    'HTTPS'
  );
  await expect(
    fetchBenchmarkSelection('https://user:password@example.com', ['sofr'], benchmarkWindow, { fetcher })
  ).rejects.toThrow('HTTPS');
});
