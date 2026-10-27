// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect, vi } from 'vitest';
import { createProjectWorkerBridge } from '../../src/services/project-worker-bridge.js';
const receipt = { revision: '1'.repeat(64), lockDigest: '2'.repeat(64), overridesDigest: '3'.repeat(64) };
it('rejects serialization text from a previous applied project', () => {
  const raw = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker;
  let state = { managed: true, receipt };
  const bridge = createProjectWorkerBridge(raw, () => state),
    listener = vi.fn();
  bridge.addEventListener('message', listener);
  bridge.postMessage({ type: 'instance:serialize', requestId: 'save', data: {} });
  expect(raw.postMessage).toHaveBeenCalledWith(expect.objectContaining({ projectReceipt: receipt }));
  state = { managed: true, receipt: { ...receipt, revision: '4'.repeat(64) } };
  raw.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'instance:serializeResult', requestId: 'save', text: 'stale', projectReceipt: receipt }
    })
  );
  expect(listener.mock.calls[0]![0].data).toMatchObject({
    type: 'instance:serializeResult',
    error: expect.stringMatching(/changed/)
  });
  expect(listener.mock.calls[0]![0].data).not.toHaveProperty('text');
  bridge.terminate();
});
it('tags every consumer request and rejects a stale semantic response without accepting its payload', () => {
  const events = new EventTarget();
  const raw = Object.assign(events, { postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker;
  let state = { managed: true, receipt };
  const worker = createProjectWorkerBridge(raw, () => state);
  const listener = vi.fn();
  worker.addEventListener('message', listener);
  worker.postMessage({ type: 'preview:execute', funcName: 'ref.Caller', inputs: { amount: 10 }, requestId: 'one' });
  expect(raw.postMessage).toHaveBeenCalledWith(expect.objectContaining({ projectReceipt: receipt }));
  state = { managed: true, receipt: { ...receipt, revision: '4'.repeat(64) } };
  raw.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'preview:execute-result', requestId: 'one', output: 11, projectReceipt: receipt }
    })
  );
  expect(listener).toHaveBeenCalledOnce();
  expect(listener.mock.calls[0]![0].data).toMatchObject({ type: 'preview:execute-error', requestId: 'one' });
  expect(listener.mock.calls[0]![0].data).not.toHaveProperty('output');
  worker.removeEventListener('message', listener);
  raw.dispatchEvent(
    new MessageEvent('message', { data: { type: 'preview:files-ready', requestId: 'install', filesRevision: 1 } })
  );
  expect(listener).toHaveBeenCalledOnce();
  worker.terminate();
  expect(raw.terminate).toHaveBeenCalledOnce();
});
it('keeps legacy message shapes and blocks managed requests until capture is available', () => {
  const raw = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker;
  let state: { managed: boolean; receipt?: typeof receipt } = { managed: false };
  const worker = createProjectWorkerBridge(raw, () => state);
  const message = { type: 'preview:generate', targetId: 'ref.Trade', requestId: 'one' };
  worker.postMessage(message);
  expect(raw.postMessage).toHaveBeenCalledWith(message);
  state = { managed: true };
  expect(() => worker.postMessage(message)).toThrow(/project/i);
  expect(raw.postMessage).toHaveBeenCalledTimes(1);
  worker.terminate();
});
it('guards object decoding with the exact project receipt and rejects late payloads', () => {
  const raw = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() }) as unknown as Worker;
  let state = { managed: true, receipt };
  const worker = createProjectWorkerBridge(raw, () => state),
    listener = vi.fn();
  worker.addEventListener('message', listener);
  worker.postMessage({ type: 'instance:decode', typeFqn: 'ref.Trade', data: { amount: 10 }, requestId: 'decode' });
  expect(raw.postMessage).toHaveBeenCalledWith(expect.objectContaining({ projectReceipt: receipt }));
  state = { managed: true, receipt: { ...receipt, revision: '4'.repeat(64) } };
  raw.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'instance:decodeResult', requestId: 'decode', data: { amount: 10 }, projectReceipt: receipt }
    })
  );
  expect(listener.mock.calls[0]![0].data).toMatchObject({
    type: 'instance:decodeResult',
    requestId: 'decode',
    error: expect.stringContaining('Project changed')
  });
  expect(listener.mock.calls[0]![0].data).not.toHaveProperty('data');
  worker.terminate();
});
