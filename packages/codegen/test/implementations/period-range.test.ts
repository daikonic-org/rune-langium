// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { createProjectDraftSnapshot } from '../../../project-config/src/index.js';
import { buildEffectiveProject } from '../../../project-runtime/src/effective-project.js';
import { prepareCuratedImplementationSources } from '../../../project-runtime/src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import {
  periodRangeCaller,
  periodRangeCases,
  periodRangeDirectory,
  periodRangeIdentity,
  periodRangePath
} from '../../../../test/helpers/cdm-period-range.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';
import { generatePreviewSchemas, generateSelected } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

let project: Awaited<ReturnType<typeof createCuratedRuneProject>>;
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
const codeListWarning = expect.objectContaining({
  code: 'native-implementation-unavailable',
  severity: 'warning',
  message: expect.stringContaining('cdm.base.staticdata.codelist.LoadCodeList')
});

beforeAll(async () => {
  project = await createCuratedRuneProject(periodRangeDirectory, periodRangeCaller);
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'matches the handwritten range constructor through the installed override in strict %s TypeScript',
  async (layout) => {
    const selected = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.periodrange'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(selected.outputs.flatMap((file) => file.diagnostics)).toEqual([codeListWarning]);
    const file = selected.outputs.find((output) => output.funcs.some((fn) => fn.name === 'BuildPeriodRange'))!;
    const module = compileGeneratedTypeScript(selected.outputs, { entry: file.relativePath });
    const range = module[file.funcs.find((fn) => fn.name === 'BuildPeriodRange')!.exportName!]!;
    for (const test of periodRangeCases) {
      const { startDate, endDate, dateAdjustments } = test.inputs;
      const invoke = () =>
        range(
          startDate === undefined ? undefined : Temporal.PlainDate.from(startDate),
          endDate === undefined ? undefined : Temporal.PlainDate.from(endDate),
          dateAdjustments
        );
      if (test.expectedError) expect(invoke, test.id).toThrow(test.expectedError);
      else expect(JSON.parse(JSON.stringify(invoke())), test.id).toEqual(test.expected);
    }
    const bounds = module[file.funcs.find((fn) => fn.name === 'RangeBounds')!.exportName!]!;
    expect(
      JSON.parse(JSON.stringify(bounds(Temporal.PlainDate.from('2024-02-28'), Temporal.PlainDate.from('2024-03-01'))))
    ).toEqual({
      adjustedStartDate: '2024-02-28',
      adjustedEndDate: '2024-03-01'
    });
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('executes the same range cases and upstream period adapter in standalone Python', () => {
  const python = generatePythonModule([...graph.documents]);
  expect(python.diagnostics).toEqual([codeListWarning]);
  const range = python.bindings.get('example.periodrange.BuildPeriodRange')!;
  const bounds = python.bindings.get('example.periodrange.RangeBounds')!;
  expect(
    runPython(
      [
        ...periodRangeCases.map((test) => ({ expression: `${range}(data)`, data: test.inputs })),
        { expression: `${bounds}('2024-02-28', '2024-03-01')` }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([
    ...periodRangeCases.map((test) =>
      test.expectedError ? { error: expect.stringContaining(test.expectedError) } : { value: test.expected }
    ),
    { value: { adjustedStartDate: '2024-02-28', adjustedEndDate: '2024-03-01' } }
  ]);
});

it('copies one editable override and leaves the upstream declaration unavailable when removed', async () => {
  expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([periodRangePath]);
  expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
  const edited = await createProjectDraftSnapshot(
    project.installed,
    new Map([[periodRangePath, project.installed.files.get(periodRangePath)! + '\n// Local note\n']]),
    () => []
  );
  const refresh = await prepareCuratedImplementationSources(edited, project.references);
  expect(refresh.changes.has(periodRangePath)).toBe(false);
  expect(refresh.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED', path: periodRangePath })
  );
  const removed = await createProjectDraftSnapshot(project.installed, new Map([[periodRangePath, null]]), () => []);
  const bare = await buildEffectiveProject(removed, project.references);
  expect(bare.diagnostics).toEqual([]);
  expect(
    generatePreviewSchemas([...bare.documents]).find((schema) => schema.targetId === periodRangeIdentity)
      ?.executionUnavailable
  ).toBeTruthy();
});
