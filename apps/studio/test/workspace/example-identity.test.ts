// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { resolveExampleType } from '../../src/workspace/example-identity.js';
import type { WorkspaceState } from '../../src/shell/providers/workspace-context.js';
const state = {
  files: [
    { path: 'local.rosetta', name: 'local', dirty: false, content: '' },
    {
      path: 'ref.rosetta',
      name: 'ref',
      dirty: false,
      content: '',
      refOnly: true,
      bundleId: 'cdm',
      namespace: 'example',
      exports: [{ type: 'Data', name: 'Trade', path: '/0' }]
    }
  ],
  parsedModels: [
    {
      filePath: 'local.rosetta',
      model: {
        name: 'example',
        elements: [
          { $type: 'Data', name: 'Trade' },
          { $type: 'RosettaEnumeration', name: 'Status' }
        ]
      }
    }
  ],
  deferredExports: []
} as unknown as WorkspaceState;
it('uses the declared owner and kind rather than guessing ambiguous FQNs', () => {
  expect(resolveExampleType(state, { typeFqn: 'example.Trade' })).toBeUndefined();
  const typeIdentity = { model: 'cdm', namespace: 'example', kind: 'Data', name: 'Trade' };
  expect(resolveExampleType(state, { typeFqn: 'example.Trade', typeIdentity })).toEqual(typeIdentity);
  expect(resolveExampleType(state, { typeFqn: 'example.Status' })).toEqual({
    model: 'local',
    namespace: 'example',
    kind: 'RosettaEnumeration',
    name: 'Status'
  });
  expect(resolveExampleType(state, { typeFqn: 'missing.Money' })).toBeUndefined();
});
