// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { validateOutputPaths } from '../src/output-paths.js';

const target = (output: string) => ({ generator: 'sql', options: {}, output });
describe('portable output destinations', () => {
  it.each([
    '../model',
    '/tmp/generated',
    'C:\\generated',
    'C:relative',
    '\\\\server\\share',
    'generated/../../model',
    '.',
    '',
    'generated\\..\\model',
    '.git',
    '.studio/private'
  ])('rejects unsafe destination %s', (output) => {
    expect(validateOutputPaths({ report: target(output) }, []).some((d) => d.severity === 'error')).toBe(true);
  });
  it('rejects nested and case-ambiguous target outputs', () => {
    expect(
      validateOutputPaths({ a: target('generated'), b: target('generated/sql') }, []).some(
        (d) => d.code === 'OUTPUT_COLLISION'
      )
    ).toBe(true);
    expect(
      validateOutputPaths({ a: target('generated/sql'), b: target('GENERATED/SQL') }, []).some(
        (d) => d.code === 'OUTPUT_COLLISION'
      )
    ).toBe(true);
  });
  it.each(['model', 'model/output', 'examples', 'build-config.yml', 'resources'])(
    'protects repository-managed paths %s',
    (output) => {
      const diagnostics = validateOutputPaths({ report: target(output) }, [
        'model/**/*.rosetta',
        'examples',
        'build-config.yml',
        'resources'
      ]);
      expect(diagnostics.some((d) => d.code === 'OUTPUT_PROTECTED')).toBe(true);
    }
  );
  it('protects a source nested under an output directory', () => {
    expect(
      validateOutputPaths({ report: target('generated') }, ['generated/model/source.rosetta']).some(
        (d) => d.code === 'OUTPUT_PROTECTED'
      )
    ).toBe(true);
  });
  it('permits sibling directories and does not confuse string prefixes', () => {
    expect(
      validateOutputPaths({ a: target('./generated/sql/'), b: target('generated/sqlserver') }, [
        'model',
        'examples',
        'generated/source'
      ])
    ).toEqual([]);
  });
});
