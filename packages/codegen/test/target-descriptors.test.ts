// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for TARGET_DESCRIPTORS (018 Phase 0 Task 0.3).
 *
 * This is the single source of truth that studio UI surfaces read to
 * render the targets table; the contract+extension pairs locked in by
 * these tests are part of the public API.
 */

import { describe, it, expect } from 'vitest';
import { TARGET_DESCRIPTORS } from '../src/export.js';

describe('TARGET_DESCRIPTORS', () => {
  it('lists all supported export targets', () => {
    expect(Object.keys(TARGET_DESCRIPTORS).sort()).toEqual([
      'excel',
      'graphql',
      'json-schema',
      'markdown',
      'openapi',
      'python',
      'sql',
      'typescript',
      'xsd',
      'zod'
    ]);
  });

  it('marks Excel, GraphQL, and Python as whole-model', () => {
    expect(TARGET_DESCRIPTORS.excel.contract).toBe('whole-model');
    expect(TARGET_DESCRIPTORS.graphql.contract).toBe('whole-model');
    expect(TARGET_DESCRIPTORS.python.contract).toBe('whole-model');
  });

  it('marks the others as namespace contract', () => {
    for (const t of ['zod', 'typescript', 'json-schema', 'sql', 'markdown', 'openapi'] as const) {
      expect(TARGET_DESCRIPTORS[t].contract).toBe('namespace');
    }
  });

  it('provides explicit MIME types for Excel and GraphQL', () => {
    expect(TARGET_DESCRIPTORS.excel.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(TARGET_DESCRIPTORS.graphql.mimeType).toBe('application/graphql');
  });

  it('omits mimeType for text targets (downstream infers from extension)', () => {
    expect(TARGET_DESCRIPTORS.zod.mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS.typescript.mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS['json-schema'].mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS.sql.mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS.markdown.mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS.openapi.mimeType).toBeUndefined();
    expect(TARGET_DESCRIPTORS.python.mimeType).toBeUndefined();
  });

  it('extensions match the spec', () => {
    expect(TARGET_DESCRIPTORS.zod.extension).toBe('.zod.ts');
    expect(TARGET_DESCRIPTORS.typescript.extension).toBe('.ts');
    expect(TARGET_DESCRIPTORS['json-schema'].extension).toBe('.schema.json');
    expect(TARGET_DESCRIPTORS.sql.extension).toBe('.sql');
    expect(TARGET_DESCRIPTORS.markdown.extension).toBe('.md');
    expect(TARGET_DESCRIPTORS.excel.extension).toBe('.xlsx');
    expect(TARGET_DESCRIPTORS.graphql.extension).toBe('.graphql');
    expect(TARGET_DESCRIPTORS.openapi.extension).toBe('.openapi.json');
    expect(TARGET_DESCRIPTORS.python.extension).toBe('.py');
  });

  it('every entry has a non-empty label + desc (UI rendering invariants)', () => {
    for (const [id, d] of Object.entries(TARGET_DESCRIPTORS)) {
      expect(d.label, `${id} label`).not.toBe('');
      expect(d.desc, `${id} desc`).not.toBe('');
    }
  });
});
