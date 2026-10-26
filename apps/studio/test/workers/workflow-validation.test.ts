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

it('accepts omitted zero-minimum collections in examples and retains Schedule conditions', async () => {
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      {
        uri: 'file:///cash.rosetta',
        content: `namespace example
type DatedValue:
 value number (1..1)
type Schedule:
 value number (0..1)
 datedValue DatedValue (0..*)
 condition ValueOrDatedValue:
  value exists or datedValue exists
func IncreaseCash:
 inputs:
  cash Schedule (1..1)
  change number (1..1)
 output:
  result number (1..1)
 condition SingleCashValue: <"Supply a single cash value without dated values.">
  cash -> value exists and cash -> datedValue is absent
 set result: cash -> value + change`
      }
    ]
  });
  const check = async (requestId: string, data: Record<string, unknown>, functionInputs = false) => {
    worker.dispatch({
      type: 'instance:validate',
      typeFqn: functionInputs ? 'example.IncreaseCash' : 'example.Schedule',
      data,
      functionInputs,
      requestId
    });
    await vi.waitFor(
      () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
      { timeout: 10000 }
    );
    return worker.scope.postMessage.mock.calls.map(([msg]) => msg).find((msg) => msg.requestId === requestId);
  };
  expect((await check('fresh-example', { value: 1000 })).diagnostics).toEqual([]);
  expect((await check('empty-example', {})).diagnostics).toEqual([
    expect.objectContaining({ conditionName: 'ValueOrDatedValue' })
  ]);
  expect((await check('fresh-function', { cash: { value: 1000 }, change: 250 }, true)).diagnostics).toEqual([]);
  expect(
    (await check('edited-function', { cash: { value: 1000, datedValue: [{ value: 10000 }] }, change: 250 }, true))
      .diagnostics[0].message
  ).toContain('SingleCashValue');
  expect(
    (await check('described-function', { cash: { value: 1000, datedValue: [{ value: 10000 }] }, change: 250 }, true))
      .diagnostics[0]
  ).toMatchObject({
    conditionName: 'SingleCashValue',
    conditionDescription: 'Supply a single cash value without dated values.',
    conditionSource: expect.stringContaining('cash -> datedValue is absent')
  });
}, 15000);
