// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inspectCapturedDeclarations } from '../../src/services/curated-declaration-client.js';
import type { InspectNamespaceRequest, InspectNamespaceResponse } from '../../src/workers/parser-worker.js';

class DeclarationWorker {
  static instances: DeclarationWorker[] = [];
  onmessage?: (event: { data: Partial<InspectNamespaceResponse> }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    DeclarationWorker.instances.push(this);
  }
}
const documents: InspectNamespaceRequest['documents'] = [{ uri: 'file:///selected', serializedModel: '{}' }];
const response: InspectNamespaceResponse = { type: 'inspectNamespaceResult', id: 'declaration', models: [] };
beforeEach(() => {
  DeclarationWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('Worker', DeclarationWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('returns the isolated snapshot and releases its worker and deadline', async () => {
  const pending = inspectCapturedDeclarations(documents, new AbortController().signal);
  const worker = DeclarationWorker.instances[0]!;
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'inspectNamespace', id: 'declaration', documents });
  worker.onmessage?.({ data: response });
  expect(await pending).toBe(response.models);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start a worker for a cancelled selection', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Selection changed'));
  await expect(inspectCapturedDeclarations(documents, controller.signal)).rejects.toThrow('Selection changed');
  expect(DeclarationWorker.instances).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases the worker if posting the captured documents fails', async () => {
  class BrokenWorker extends DeclarationWorker {
    override postMessage = vi.fn(() => {
      throw new Error('Could not clone capture');
    });
  }
  vi.stubGlobal('Worker', BrokenWorker);
  await expect(inspectCapturedDeclarations(documents, new AbortController().signal)).rejects.toThrow(
    'Could not clone capture'
  );
  expect(DeclarationWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('terminates a cancelled read without poisoning a replacement or accepting its late reply', async () => {
  const controller = new AbortController();
  const first = inspectCapturedDeclarations(documents, controller.signal);
  const rejected = expect(first).rejects.toThrow('Selection changed');
  const old = DeclarationWorker.instances[0]!;
  controller.abort(new Error('Selection changed'));
  await rejected;
  expect(old.terminate).toHaveBeenCalledOnce();
  const replacement = inspectCapturedDeclarations(documents, new AbortController().signal);
  old.onmessage?.({ data: { ...response, error: 'late stale result' } });
  const current = DeclarationWorker.instances[1]!;
  current.onmessage?.({ data: response });
  expect(await replacement).toBe(response.models);
  expect(current.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['error', 'messageerror', 'reply', 'invalid', 'timeout'])(
  'releases the worker and deadline after %s',
  async (kind) => {
    const pending = inspectCapturedDeclarations(documents, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow();
    const worker = DeclarationWorker.instances[0]!;
    if (kind === 'error') worker.onerror?.({ message: 'crashed' });
    if (kind === 'messageerror') worker.onmessageerror?.();
    if (kind === 'reply') worker.onmessage?.({ data: { ...response, error: 'invalid snapshot' } });
    if (kind === 'invalid') worker.onmessage?.({ data: { id: 'declaration' } });
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  }
);
