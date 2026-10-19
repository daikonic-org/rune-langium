// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedCacheClient } from '../../src/services/curated-cache-client.js';

const seed = {
  key: JSON.stringify(['cdm', 'artifacts/2026-10-18-aaaaaaaaaaaa/ns/example.json.gz']),
  bundleId: 'cdm',
  version: 'b'.repeat(64),
  namespace: 'example'
};
const clients: ReturnType<typeof createCuratedCacheClient>[] = [];
const shared: FakeSharedWorker[] = [];
const dedicated: FakeWorker[] = [];
class FakeSharedWorker {
  port = { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() };
  onerror?: () => void;
  constructor() {
    shared.push(this);
  }
}
class FakeWorker {
  postMessage = vi.fn();
  terminate = vi.fn();
  onerror?: () => void;
  constructor() {
    dedicated.push(this);
  }
}
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('SharedWorker', FakeSharedWorker);
  vi.stubGlobal('Worker', FakeWorker);
  const client = createCuratedCacheClient();
  clients.push(client);
  return client;
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
  shared.length = 0;
  dedicated.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('lazily starts the shared worker with only validated public manifest metadata', () => {
  const client = setup();
  client.seed(undefined);
  expect(shared).toHaveLength(0);
  client.seed([{ ...seed, content: 'private workspace file' }]);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.port.postMessage).toHaveBeenCalledWith({ type: 'seed', seeds: [seed] });
});

it('keeps overlapping foreground operations paused until all are released, with renewable leases', async () => {
  const client = setup();
  const first = client.foreground();
  client.seed([seed]);
  const second = client.foreground();
  const port = shared[0]!.port;
  await vi.advanceTimersByTimeAsync(5000);
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'foreground', active: true });
  first();
  first();
  expect(port.postMessage).not.toHaveBeenCalledWith({ type: 'foreground', active: false });
  second();
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'foreground', active: false });
  const calls = port.postMessage.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15000);
  expect(port.postMessage.mock.calls).toHaveLength(calls);
});

it('joins the shared worker before a foreground-only tab has received manifest seeds', () => {
  const client = setup();
  const release = client.foreground();
  expect(shared).toHaveLength(1);
  expect(shared[0]!.port.postMessage).toHaveBeenLastCalledWith({ type: 'foreground', active: true });
  release();
  expect(shared[0]!.port.postMessage).toHaveBeenLastCalledWith({ type: 'foreground', active: false });
});

it('falls back to a dedicated worker when sharing fails, then disables speculation if that also fails', () => {
  const client = setup();
  client.seed([seed]);
  shared[0]!.onerror!();
  expect(shared[0]!.port.close).toHaveBeenCalled();
  expect(dedicated).toHaveLength(1);
  expect(dedicated[0]!.postMessage).toHaveBeenCalledWith({ type: 'seed', seeds: [seed] });
  dedicated[0]!.onerror!();
  client.seed([seed]);
  expect(dedicated).toHaveLength(1);
});

it('uses the same worker implementation when SharedWorker is unavailable', () => {
  const client = setup();
  vi.stubGlobal('SharedWorker', undefined);
  client.seed([seed]);
  expect(dedicated).toHaveLength(1);
  expect(shared).toHaveLength(0);
});

it('does not speculate on a data-saving connection', () => {
  const client = setup();
  vi.stubGlobal('navigator', { connection: { saveData: true } });
  client.seed([seed]);
  expect(shared).toHaveLength(0);
  expect(dedicated).toHaveLength(0);
});

it('disconnects background ownership during navigation and resumes without losing foreground priority', () => {
  const client = setup();
  client.seed([seed]);
  const release = client.foreground();
  client.suspend();
  expect(shared[0]!.port.close).toHaveBeenCalled();
  client.resume();
  expect(shared).toHaveLength(2);
  expect(shared[1]!.port.postMessage).toHaveBeenLastCalledWith({ type: 'foreground', active: true });
  release();
  client.dispose();
  client.resume();
  expect(shared).toHaveLength(2);
});
