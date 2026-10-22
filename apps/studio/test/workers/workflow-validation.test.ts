// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => vi.unstubAllGlobals());
it('checks function inputs and aliases without running assignments or postconditions', async () => {
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      {
        uri: 'file:///flow.rosetta',
        content: `namespace workflow
func Calculate:
 inputs:
  value number (1..1)
 output:
  result number (1..1)
 alias doubled: value * 2
 condition Positive:
  doubled > 0
 set result: value
 post-condition Never:
  result < 0`
      }
    ]
  });
  const check = async (requestId: string, inputs: Record<string, unknown>, execute = false) => {
    worker.dispatch(
      execute
        ? { type: 'preview:execute', funcName: 'workflow.Calculate', inputs, requestId }
        : { type: 'instance:validate', typeFqn: 'workflow.Calculate', data: inputs, requestId, functionInputs: true }
    );
    await vi.waitFor(
      () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
      { timeout: 10000 }
    );
    return worker.scope.postMessage.mock.calls.map(([msg]) => msg).find((msg) => msg.requestId === requestId);
  };
  expect((await check('valid', { value: 2 })).diagnostics).toEqual([]);
  expect((await check('negative', { value: -2 })).diagnostics[0].message).toContain('Positive');
  expect((await check('missing', {})).diagnostics[0].path).toBe('value');
  expect(await check('run', { value: 2 }, true)).toMatchObject({
    type: 'preview:execute-error',
    error: expect.stringContaining('Never')
  });
  expect(worker.scope.postMessage.mock.calls.some(([msg]) => msg.type === 'preview:execute-result')).toBe(false);
}, 15000);
