// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, expect, it } from 'vitest';
import { recordOperation } from '../../src/services/operation-feedback.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import { useOutputStore } from '../../src/store/output-store.js';

beforeEach(() => {
  useActivityStore.getState().clearEntries();
  useOutputStore.getState().clearLines();
});
it('records correlated operation start and completion without toast lifecycle events', () => {
  const opId = recordOperation('curated', 'Loading two namespaces');
  recordOperation('curated', 'Loaded two namespaces', 'success', { opId, durationMs: 42 });
  const activity = useActivityStore.getState().entries;
  const output = useOutputStore.getState().lines;
  expect(activity).toHaveLength(2);
  expect(output).toHaveLength(2);
  expect(activity.every((entry) => entry.opId === opId)).toBe(true);
  expect(output.every((entry) => entry.opId === opId)).toBe(true);
  expect(activity[1]).toMatchObject({ durationMs: 42 });
  expect(output[1]).toMatchObject({ durationMs: 42 });
  expect(output.every((entry) => !entry.text.includes('toast'))).toBe(true);
});

it.each([
  ['info', true],
  ['success', true],
  ['warn', false],
  ['error', false]
] as const)('records %s with the appropriate activity outcome and output severity', (level, ok) => {
  const opId = recordOperation('layout', 'Layout operation', level, { durationMs: 12 });
  expect(useActivityStore.getState().entries).toEqual([expect.objectContaining({ ok, opId, durationMs: 12 })]);
  expect(useOutputStore.getState().lines).toEqual([expect.objectContaining({ severity: level, opId, durationMs: 12 })]);
});
