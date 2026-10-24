// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { collectProjectLspInput } from '../../src/services/project-lsp-input.js';
it('uses the authoritative scoped source capture and refuses an older parser snapshot', async () => {
  const source = 'namespace custom\ntype Trade:\n amount number (1..1)';
  const files = [{ name: 'trade.rosetta', path: 'model/trade.rosetta', content: source, dirty: false }];
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      ['build-config.yml', 'schemaVersion: 1\nsources: [model/**/*.rosetta]'],
      ['model/trade.rosetta', source]
    ]),
    () => []
  );
  const input = await captureProjectRuntimeInput(snapshot, files, []);
  const model = { $type: 'RosettaModel' as const, name: 'custom', elements: [], imports: [], version: '' };
  const parsed = [{ filePath: files[0]!.path, source, model, serializedModelJson: JSON.stringify(model) }];
  const result = collectProjectLspInput(input, parsed, new Map(), files[0]!.path);
  expect(result.models.map((value) => value.uri)).toEqual(['file:///workspace/model/trade.rosetta']);
  expect(result.resolution).toBe(input.resolution);
  expect(() =>
    collectProjectLspInput(input, [{ ...parsed[0]!, source: source + '\n' }], new Map(), files[0]!.path)
  ).toThrow(/current source/i);
});
