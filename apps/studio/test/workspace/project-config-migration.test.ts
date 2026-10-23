// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { parseBuildConfig } from '@rune-langium/project-config';
import { previewProjectConfigMigration } from '../../src/workspace/migrations/project-config.js';

describe('explicit migration preview', () => {
  it('previews legacy generator options as named targets without writing preferences or choosing a default', () => {
    const files = new Map([['model/a.rosetta', 'namespace a']]);
    const preview = previewProjectConfigMigration({
      files,
      revisions: new Map(),
      workspaceName: 'Example',
      targetOptions: { sql: { dialect: 'postgresql' }, typescript: { layout: 'barrel' } },
      references: []
    });
    const build = preview.writes.find((write) => write.path === 'build-config.yml')!;
    const parsed = parseBuildConfig({ path: build.path, text: build.text }).value!;
    expect(parsed.targets.sql?.options).toEqual({ dialect: 'postgresql' });
    expect(parsed.targets.typescript?.options).toEqual({ layout: 'barrel' });
    expect(build.expectedRevision).toBeNull();
    expect(parsed).not.toHaveProperty('defaultTarget');
    expect(files.has('build-config.yml')).toBe(false);
    expect(preview.writes.some((write) => write.path === 'rune-config.yml')).toBe(true);
  });
  it('preserves repository target settings over same-name browser preferences', () => {
    const text =
      'schemaVersion: 1\ntargets:\n  sql:\n    generator: sql\n    options:\n      dialect: sqlite\n    output: generated/sql\n';
    const preview = previewProjectConfigMigration({
      files: new Map([
        ['build-config.yaml', text],
        ['rune-config.yml', 'model: {}']
      ]),
      revisions: new Map([['build-config.yaml', 'original']]),
      workspaceName: 'Example',
      targetOptions: { sql: { dialect: 'postgresql' } },
      references: []
    });
    expect(preview.writes).toEqual([]);
  });
  it('leaves floating legacy reference bindings unresolved rather than inventing a release tag', () => {
    const preview = previewProjectConfigMigration({
      files: new Map(),
      revisions: new Map(),
      workspaceName: 'Example',
      targetOptions: {},
      references: [{ model: 'cdm', repository: 'finos/common-domain-model' }]
    });
    expect(preview.diagnostics.some((issue) => issue.code === 'MIGRATION_RELEASE_REQUIRED')).toBe(true);
    const build = preview.writes.find((write) => write.path === 'build-config.yml')!;
    expect(parseBuildConfig({ path: build.path, text: build.text }).value?.references).toEqual({});
  });
  it('does not rewrite ambiguous companion files', () => {
    const preview = previewProjectConfigMigration({
      files: new Map([
        ['build-config.yml', 'schemaVersion: 1'],
        ['build-config.yaml', 'schemaVersion: 1']
      ]),
      revisions: new Map(),
      workspaceName: 'Example',
      targetOptions: { sql: {} },
      references: []
    });
    expect(preview.writes).toEqual([]);
    expect(preview.diagnostics.some((issue) => issue.code === 'CONFIG_AMBIGUOUS')).toBe(true);
  });
});
