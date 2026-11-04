// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => vi.unstubAllGlobals());

it('converts time and pattern inputs, executes native values and serializes pattern output', async () => {
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      {
        uri: 'file:///patterns.rosetta',
        content: `namespace patterns
type Settings:
 at time (1..1)
 expression pattern (1..1)
func Copy:
 inputs: settings Settings (1..1)
 output: result Settings (1..1)
 set result: settings
func Same:
 inputs:
  left pattern (1..1)
  right pattern (1..1)
 output: result boolean (1..1)
 set result: left = right`
      }
    ]
  });
  const cases = [
    {
      funcName: 'patterns.Copy',
      inputs: { settings: { at: '12:34:56', expression: '^x+$' } },
      output: { at: '12:34:56', expression: '^x+$' }
    },
    { funcName: 'patterns.Same', inputs: { left: 'x', right: 'y' }, output: false },
    { funcName: 'patterns.Same', inputs: { left: 'x', right: 'x' }, output: true }
  ];
  for (const [index, value] of cases.entries()) {
    const requestId = `pattern-${index}`;
    worker.dispatch({ type: 'preview:execute', requestId, funcName: value.funcName, inputs: value.inputs });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ requestId, type: 'preview:execute-result', output: value.output })
        ),
      { timeout: 15000 }
    );
  }
  worker.dispatch({
    type: 'preview:execute',
    requestId: 'invalid-pattern',
    funcName: 'patterns.Same',
    inputs: { left: '[', right: 'x' }
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'invalid-pattern',
          type: 'preview:execute-error',
          error: expect.stringContaining('Invalid pattern')
        })
      ),
    { timeout: 15000 }
  );
});
