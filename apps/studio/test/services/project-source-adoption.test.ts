// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectSnapshot, createProjectDraftSnapshot } from '@rune-langium/project-config';
import { adoptSavedProjectSources } from '../../src/services/project-source-adoption.js';
it('adopts explicit saved source additions/changes/removals without overwriting live edits or restoring unsaved deletions', async () => {
  const previous = await createProjectSnapshot(
    'sources',
    new Map([
      ['rune-config.yml', 'model: {name: Source adoption}'],
      ['build-config.yml', 'schemaVersion: 1'],
      ['model/clean.rosetta', 'namespace clean'],
      ['model/edited.rosetta', 'namespace before'],
      ['model/deleted.rosetta', 'namespace deleted'],
      ['model/removed.rosetta', 'namespace removed']
    ]),
    () => []
  );
  const next = await createProjectDraftSnapshot(
    previous,
    new Map([
      ['model/clean.rosetta', 'namespace updated'],
      ['model/edited.rosetta', 'namespace disk'],
      ['model/deleted.rosetta', 'namespace changed on disk'],
      ['model/removed.rosetta', null],
      ['model/implementations/cdm/new.rosetta', 'override namespace cdm.example']
    ]),
    () => []
  );
  const live = [
    { path: 'model/clean.rosetta', name: 'clean.rosetta', content: 'namespace clean', dirty: false },
    { path: 'model/edited.rosetta', name: 'edited.rosetta', content: 'namespace unsaved', dirty: true },
    { path: 'model/removed.rosetta', name: 'removed.rosetta', content: 'namespace removed', dirty: false }
  ];
  const adopted = adoptSavedProjectSources(previous, next, live);
  expect(adopted.find((file) => file.path === 'model/clean.rosetta')?.content).toBe('namespace updated');
  expect(adopted.find((file) => file.path === 'model/edited.rosetta')).toBe(live[1]);
  expect(adopted.some((file) => ['model/removed.rosetta', 'model/deleted.rosetta'].includes(file.path))).toBe(false);
  expect(adopted.find((file) => file.path === 'model/implementations/cdm/new.rosetta')?.dirty).toBe(false);
  expect(adoptSavedProjectSources(next, next, adopted)).toBe(adopted);
});
