// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generatePreviewSchemas } from '@rune-langium/codegen/export';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import {
  periodRangeCaller,
  periodRangeDirectory,
  periodRangeIdentity,
  periodRangePath
} from '../../../test/helpers/cdm-period-range.js';

it('copies one editable override and leaves the upstream declaration unavailable when removed', async () => {
  const project = await createCuratedRuneProject(periodRangeDirectory, periodRangeCaller);
  expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta')).sort()).toEqual([
    'model/implementations/cdm/date-difference.rosetta',
    'model/implementations/cdm/gregorian.rosetta',
    'model/implementations/cdm/leap-year-date-difference.rosetta',
    periodRangePath
  ]);
  expect((await buildEffectiveProject(project.installed, project.references)).diagnostics).toEqual([]);
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
