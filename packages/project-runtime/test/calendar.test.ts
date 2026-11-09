// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generatePreviewSchemas } from '@rune-langium/codegen/export';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import {
  calendarCaller,
  calendarDirectory,
  calendarFunctions,
  calendarNamespace
} from '../../../test/helpers/cdm-calendar.js';

it('installs one editable source per calendar override with shared support files', async () => {
  const project = await createCuratedRuneProject(calendarDirectory, calendarCaller);
  expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta')).sort()).toEqual(
    [
      'add-days',
      'date-difference',
      'day-of-week',
      'gregorian',
      'leap-year-date-difference',
      'resolve-adjustable-date',
      'weekend-adjustment'
    ].map((name) => `model/implementations/cdm/${name}.rosetta`)
  );
  expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
  const graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  const schemas = generatePreviewSchemas([...graph.documents]);
  for (const targetId of [
    ...calendarFunctions.map((name) => `${calendarNamespace}.${name}`),
    'example.calendar.AdjustWeekend'
  ]) {
    const schema = schemas.find((entry) => entry.targetId === targetId);
    expect(schema, targetId).toBeDefined();
    expect(schema?.executionUnavailable, targetId).toBeUndefined();
  }
});
