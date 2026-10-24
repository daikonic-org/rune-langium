// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createProjectSnapshot } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
/** One synthetic project shared by preview, export and host-boundary journeys. */
export async function projectOverrideInput() {
  const local =
    'namespace custom\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 2';
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Demo}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            {
              kind: 'declaration',
              source: { model: 'cdm', namespace: 'ref', kind: 'RosettaFunction', name: 'Compute' },
              replacement: { model: 'local', namespace: 'custom', kind: 'RosettaFunction', name: 'Compute' }
            }
          ]
        })
      ],
      ['model/custom.rosetta', local]
    ]),
    () => []
  );
  const files = [{ name: 'custom.rosetta', path: 'model/custom.rosetta', content: local, dirty: false }];
  const input = await captureProjectRuntimeInput(snapshot, files, [
    {
      uri: 'cdm/functions.rosetta',
      content:
        'namespace ref\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 1\nfunc Caller:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: Compute(amount)'
    }
  ]);
  return { input, snapshot, files };
}
