// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generateSelected } from '@rune-langium/codegen/export';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import {
  strikeScheduleDirectory,
  strikeScheduleCaller,
  strikeScheduleCases
} from '../../../test/helpers/cdm-strike-schedule.js';
import { Temporal } from '@js-temporal/polyfill';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';

it(
  'installs one Rune strike mapper and its support source from the verified CDM/FpML bundle',
  async () => {
    const project = await createCuratedRuneProject(strikeScheduleDirectory, strikeScheduleCaller);
    expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([
      'model/implementations/cdm/strike-schedule-state.rosetta',
      'model/implementations/cdm/strike-schedule.rosetta'
    ]);
    expect(project.installed.lock?.references.fpml?.release).toBe('3.13.0');
    expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.strike'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    const module = compileGeneratedTypeScript(outputs);
    const fn = outputs.flatMap((file) => file.funcs).find((fn) => fn.name === 'StrikeSchedule')!;
    for (const test of strikeScheduleCases)
      expect(
        JSON.parse(
          JSON.stringify(
            module[fn.exportName!]!(
              test.inputs.fpmlStrikePricePerUnitStepList,
              test.inputs.fpmlCommodityStrikePriceDateList.map((date) => Temporal.PlainDate.from(date))
            )
          )
        ),
        test.id
      ).toEqual(test.expected);
    const path = 'model/implementations/cdm/strike-schedule.rosetta';
    const edited = await createProjectDraftSnapshot(
      project.installed,
      new Map([[path, project.installed.files.get(path)! + '\n// local edit\n']]),
      () => []
    );
    const refreshed = await prepareCuratedImplementationSources(edited, project.references);
    expect(refreshed.changes.has(path)).toBe(false);
    expect(refreshed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED', path })
    );
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
