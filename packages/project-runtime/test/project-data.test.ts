// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { serializeProjectData } from '../src/capabilities.js';
it('does not save an explicitly requested unsupported example codec as plain JSON', async () => {
  const snapshot = await createProjectSnapshot('p', new Map([['rune-config.yml', 'model: {name: Example}']]), () => []);
  expect(() => serializeProjectData(snapshot, { amount: 10.12345 }, 'XML')).toThrow(/codec|format/i);
  expect(serializeProjectData(snapshot, { amount: 10.12345 }, 'JSON')).toContain('10.12345');
});
