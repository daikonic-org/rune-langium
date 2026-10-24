// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { validateTargetOptions, getGeneratorCapabilities, getTargetLayouts } from '../../src/options/target-options.js';
import { ExcelOptionsSchema } from '../../src/options/excel-options.js';
import { OpenApiOptionsSchema } from '../../src/options/openapi-options.js';

describe('project generator options', () => {
  it('keeps multiple configurations of the same generator independent', () => {
    const first = validateTargetOptions('sql', { dialect: 'postgres', inheritance: 'table-per-type' });
    const second = validateTargetOptions('sql', { dialect: 'sqlserver', inheritance: 'single-table' });
    expect(first.value).toEqual({ dialect: 'postgres', inheritance: 'table-per-type' });
    expect(second.value).toEqual({ dialect: 'sqlserver', inheritance: 'single-table' });
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });
  it.each([
    ['sql', { dialect: 'mysql' }],
    ['sql', { inheritance: 'invalid' }],
    ['sql', { enumStrategy: 'none' }],
    ['sql', { layout: 'barrel' }],
    ['json-schema', { layout: 'barrel' }],
    ['typescript', { inputChecks: 'yes' }],
    ['typescript', null],
    ['typescript', []],
    ['typescript', { unknownKnob: true }]
  ])('diagnoses invalid %s options', (target, options) => {
    const result = validateTargetOptions(target, options);
    expect(result.value).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it('uses the existing Excel schema to resolve defaults', () => {
    const options = { sheets: { types: false } };
    expect(validateTargetOptions('excel', options)).toEqual({ value: ExcelOptionsSchema.parse(options), errors: [] });
  });
  it('uses the existing OpenAPI schema for valid and invalid formats', () => {
    const options = { format: 'yaml', crud: { types: ['Trade'] } };
    expect(validateTargetOptions('openapi', options)).toEqual({
      value: OpenApiOptionsSchema.parse(options),
      errors: []
    });
    expect(validateTargetOptions('openapi', { format: 'toml' }).value).toBeUndefined();
  });
  it('reports unavailable generators without silently choosing another', () => {
    expect(getGeneratorCapabilities().find((target) => target.id === 'graphql')?.available).toBe(false);
    expect(validateTargetOptions('graphql', {}).value).toBeUndefined();
    expect(validateTargetOptions('not-installed', {}).value).toBeUndefined();
    expect(validateTargetOptions('toString', {}).value).toBeUndefined();
    expect(validateTargetOptions('', {}).value).toBeUndefined();
  });
  it('shares actual supported layout choices with UI consumers', () => {
    expect(getTargetLayouts('typescript')).toEqual(['per-namespace', 'barrel', 'single-file']);
    expect(getTargetLayouts('sql')).toEqual(['per-namespace', 'single-file']);
    expect(getTargetLayouts('excel')).toEqual([]);
  });
});
