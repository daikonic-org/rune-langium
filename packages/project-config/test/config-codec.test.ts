// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import {
  discoverProjectConfig,
  parseBuildConfig,
  parseStudioConfig,
  updateBuildConfig,
  updateStudioConfig,
  normalizeProject,
  mergeNamespaceConfig,
  parseProjectLock
} from '../src/index.js';

const text = `# Project build\nschemaVersion: 1\nx-project: retained\ntargets:\n  reporting:\n    generator: sql\n    options:\n      dialect: postgres # database\n      x-option: keep\n    output: generated/postgres\n`;
const document = { path: 'build-config.yml', text };

describe('portable configuration', () => {
  it('opens .yaml files without silently inventing a default target', () => {
    const found = discoverProjectConfig(new Map([['build-config.yaml', text]]));
    expect(found.build?.path).toBe('build-config.yaml');
    const result = parseBuildConfig(found.build!);
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.value!.targets)).toEqual(['reporting']);
    expect(result.value).not.toHaveProperty('defaultTarget');
    expect(result.value!.sources).toEqual(['model/**/*.rosetta']);
  });

  it.each(['build-config', 'studio-config'])('diagnoses competing %s spellings', (base) => {
    const result = discoverProjectConfig(
      new Map([
        [`${base}.yml`, text],
        [`${base}.yaml`, text]
      ])
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('CONFIG_AMBIGUOUS');
    expect(base === 'build-config' ? result.build : result.studio).toBeUndefined();
  });

  it.each([
    ['schemaVersion: 1\nschemaVersion: 1\n', 'CONFIG_DUPLICATE_KEY'],
    ['schemaVersion: 1\ntargets: [', 'CONFIG_SYNTAX'],
    ['schemaVersion: 2\n', 'CONFIG_SCHEMA'],
    ['schemaVersion: 1\ntargets: null\n', 'CONFIG_SCHEMA'],
    ['schemaVersion: 1\ncopy: &copy {a: 1}\nother: *copy\n', 'CONFIG_ALIAS'],
    ['schemaVersion: 1\n<<: {targets: {}}\n', 'CONFIG_ALIAS'],
    [
      'schemaVersion: 1\nreferences:\n  cdm:\n    repository: https://github.com/finos/common-domain-model\n',
      'CONFIG_SCHEMA'
    ]
  ])('refuses ambiguous or unsupported input %s', (invalid, code) => {
    const result = parseBuildConfig({ ...document, text: invalid });
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === code && d.path === document.path)).toBe(true);
    expect(() => updateBuildConfig({ ...document, text: invalid }, parseBuildConfig(document).value!)).toThrow();
  });

  it('preserves unknown fields and comments when changing saved options', () => {
    const value = parseBuildConfig(document).value!;
    value.targets.reporting!.options.dialect = 'sqlserver';
    const updated = updateBuildConfig(document, value);
    expect(updated).toContain('# Project build');
    expect(updated).toContain('x-project: retained');
    expect(updated).toContain('# database');
    expect(updated).toContain('x-option: keep');
    expect(parseBuildConfig({ ...document, text: updated }).value!.targets.reporting!.options.dialect).toBe(
      'sqlserver'
    );
  });

  it('removes deleted named targets while preserving unrelated extension fields', () => {
    const value = parseBuildConfig(document).value!;
    delete value.targets.reporting;
    const updated = updateBuildConfig(document, value);
    expect(parseBuildConfig({ ...document, text: updated }).value!.targets).toEqual({});
    expect(updated).toContain('x-project: retained');
  });

  it('refuses writing an invalid replacement configuration', () => {
    const value = parseBuildConfig(document).value!;
    value.targets.reporting!.generator = '';
    expect(() => updateBuildConfig(document, value)).toThrow();
  });

  it('clears an optional target namespace override without losing extension fields', () => {
    const scoped = {
      ...document,
      text: text.replace('    generator: sql', '    x-target: preserve\n    namespaces: [legacy.*]\n    generator: sql')
    };
    const value = parseBuildConfig(scoped).value!;
    delete value.targets.reporting!.namespaces;
    const updated = updateBuildConfig(scoped, value);
    expect(parseBuildConfig({ ...scoped, text: updated }).value!.targets.reporting).not.toHaveProperty('namespaces');
    expect(updated).toContain('x-target: preserve');
  });

  it('round-trips Studio directories without writing private state', () => {
    const studio = {
      path: 'studio-config.yaml',
      text: '# display\nschemaVersion: 1\nx-share: yes\nexamples: examples\n'
    };
    const value = parseStudioConfig(studio).value!;
    expect(value.layouts).toBe('layouts');
    const result = updateStudioConfig(studio, { ...value, workflows: 'saved-flows' });
    expect(result).toContain('# display');
    expect(result).toContain('x-share: yes');
    expect(parseStudioConfig({ ...studio, text: result }).value!.workflows).toBe('saved-flows');
    expect(result).not.toMatch(/token|dockview|activeTab/);
  });

  it('keeps Rune serialization and namespace defaults separate from build targets', () => {
    const files = new Map([
      ['build-config.yml', 'schemaVersion: 1\ntargets: {}\n'],
      [
        'rune-config.yml',
        'model:\n  name: Bond model\n  defaultSerialisationFormat: RUNE_JSON\ngenerators:\n  namespaces: [cdm.*]\n'
      ]
    ]);
    const before = files.get('rune-config.yml');
    const project = normalizeProject(files, () => []);
    expect(project.rune).toMatchObject({
      model: { name: 'Bond model', defaultSerialisationFormat: 'RUNE_JSON' },
      generators: { namespaces: ['cdm.*'] }
    });
    expect(project.build.targets).toEqual({});
    expect(files.get('rune-config.yml')).toBe(before);
  });

  it('reads an explicitly configured upstream path and propagates validator errors', () => {
    const files = new Map([
      [
        'build-config.yml',
        text.replace('schemaVersion: 1', 'schemaVersion: 1\nruneConfig: resources/rune-config.yaml')
      ],
      ['resources/rune-config.yaml', 'model: {name: Custom}\n']
    ]);
    const project = normalizeProject(files, (target) =>
      target.generator === 'sql'
        ? [{ code: 'TARGET_UNAVAILABLE', severity: 'error', path: 'targets.reporting', message: 'not installed' }]
        : []
    );
    expect(project.rune).toMatchObject({ model: { name: 'Custom' } });
    expect(project.diagnostics.map((d) => d.code)).toContain('TARGET_UNAVAILABLE');
  });

  it('keeps malformed Rune configuration visibly invalid', () => {
    const project = normalizeProject(new Map([['rune-config.yml', 'model: [']]), () => []);
    expect(project.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('retains an empty source-browsing project without choosing a target', () => {
    const project = normalizeProject(new Map(), () => []);
    expect(project.build.targets).toEqual({});
    expect(project.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('merges namespace entries by ID with whole-entry project precedence', () => {
    const result = mergeNamespaceConfig(
      [
        { id: 'fpml', namespace: 'fpml.*', readOnly: true, origin: { modelImport: 'xsd' } },
        { namespace: 'other.*', readOnly: true }
      ],
      [{ id: 'fpml', namespace: 'local.fpml.*', readOnly: false }]
    );
    expect(result).toEqual([
      { id: 'fpml', namespace: 'local.fpml.*', readOnly: false },
      { namespace: 'other.*', readOnly: true }
    ]);
  });

  it('validates dependency lock JSON without inferring missing identities', () => {
    const lock = {
      schemaVersion: 1,
      configHash: 'a'.repeat(64),
      toolchain: { 'rune-langium': '0.1.0' },
      references: {}
    };
    expect(parseProjectLock({ path: 'build-config.lock.json', text: JSON.stringify(lock) }).value).toEqual(lock);
    expect(
      parseProjectLock({ path: 'build-config.lock.json', text: JSON.stringify({ ...lock, schemaVersion: 2 }) }).value
    ).toBeUndefined();
    expect(parseProjectLock({ path: 'build-config.lock.json', text: '{' }).diagnostics[0]?.severity).toBe('error');
  });
});
