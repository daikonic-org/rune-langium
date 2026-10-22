// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewSessionClient } from '../../src/services/preview-session-client.js';
import type { InstanceReadiness } from '../../src/services/instance-readiness.js';

class FakeWorker extends EventTarget {
  readonly posted: Array<Record<string, unknown>> = [];
  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
  }
  reply(message: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

function readiness(): InstanceReadiness {
  return { ensure: vi.fn(async () => 1), hydrateSchemaDependencies: vi.fn(async () => false), dispose: vi.fn() };
}

afterEach(() => vi.useRealTimers());

describe('createPreviewSessionClient', () => {
  it('bounds projection rendering to 30 seconds and permits a correlated retry', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = createPreviewSessionClient(worker as unknown as Worker, readiness());
    const subject = {
      uri: 'file:///test.rosetta',
      nodeId: 'test.Calculate#RosettaFunction',
      region: { from: 30, to: 45 }
    };
    const pending = expect(
      client.project('typescript', subject, 'function', 'namespace test', new AbortController().signal)
    ).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    const retry = client.project('typescript', subject, 'function', 'namespace test', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.posted).toHaveLength(2);
    const projection = { language: 'typescript', subject, code: 'return true;', sourceMap: [], requiredHelpers: [] };
    worker.reply({
      type: 'projection:result',
      requestId: worker.posted[0]!.requestId,
      projection: { ...projection, code: 'stale' }
    });
    worker.reply({ type: 'projection:result', requestId: worker.posted[1]!.requestId, projection });
    await expect(retry).resolves.toEqual(projection);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('projects from the acknowledged linked source and correlates replies', async () => {
    const worker = new FakeWorker();
    const ready = readiness();
    const client = createPreviewSessionClient(worker as unknown as Worker, ready);
    const subject = {
      uri: 'file:///test.rosetta',
      nodeId: 'test.Calculate#RosettaFunction',
      region: { from: 30, to: 45 }
    };
    const result = client.project('typescript', subject, 'function', 'namespace test', new AbortController().signal);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    expect(ready.ensure).toHaveBeenCalledWith('test.Calculate', expect.any(AbortSignal));
    expect(worker.posted[0]).toMatchObject({
      type: 'projection:generate',
      language: 'typescript',
      subject,
      source: 'namespace test',
      filesRevision: 1
    });
    const projection = {
      language: 'typescript',
      subject,
      code: 'export function Calculate(): number { return 1; }',
      sourceMap: [],
      requiredHelpers: []
    };
    worker.reply({ type: 'projection:result', requestId: worker.posted[0].requestId, projection });
    await expect(result).resolves.toEqual(projection);
    client.dispose();
  });
  it('keeps simultaneous execution replies correlated when they arrive in reverse order', async () => {
    const worker = new FakeWorker();
    const first = createPreviewSessionClient(worker as unknown as Worker, readiness());
    const second = createPreviewSessionClient(worker as unknown as Worker, readiness());
    const a = first.execute('test.Rename', { name: 'A' }, new AbortController().signal);
    const b = second.execute('test.Rename', { name: 'B' }, new AbortController().signal);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));

    worker.reply({
      type: 'preview:execute-result',
      requestId: worker.posted[1].requestId,
      funcName: 'test.Rename',
      output: 'B'
    });
    worker.reply({
      type: 'preview:execute-result',
      requestId: worker.posted[0].requestId,
      funcName: 'test.Rename',
      output: 'A'
    });

    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('rejects an aborted request and ignores its eventual reply', async () => {
    const worker = new FakeWorker();
    const client = createPreviewSessionClient(worker as unknown as Worker, readiness());
    const controller = new AbortController();
    const result = client.execute('test.Rename', {}, controller.signal);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    worker.reply({
      type: 'preview:execute-result',
      requestId: worker.posted[0].requestId,
      funcName: 'test.Rename',
      output: 'late'
    });
  });

  it('rejects pending requests when the worker fails', async () => {
    const worker = new FakeWorker();
    const client = createPreviewSessionClient(worker as unknown as Worker, readiness());
    const result = client.execute('test.Rename', {}, new AbortController().signal);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));

    worker.dispatchEvent(new Event('error'));

    await expect(result).rejects.toThrow('Function execution worker is unavailable.');
  });
});

it('correlates input-check replies independently and reports unavailable validation', async () => {
  const worker = new FakeWorker();
  const client = createPreviewSessionClient(worker as unknown as Worker, readiness());
  const promise = client.validate('test.Run', { value: 1 }, new AbortController().signal, true);
  await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
  expect(worker.posted[0]).toMatchObject({ type: 'instance:validate', typeFqn: 'test.Run', functionInputs: true });
  worker.reply({
    type: 'instance:validateResult',
    requestId: worker.posted[0]!.requestId,
    diagnostics: [{ path: 'value', message: 'Required' }]
  });
  await expect(promise).resolves.toEqual([{ path: 'value', message: 'Required' }]);
  const failure = client.validate('test.Run', {}, new AbortController().signal, true);
  const rejection = expect(failure).rejects.toThrow('Not linked');
  await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
  worker.reply({
    type: 'instance:validateResult',
    requestId: worker.posted[1]!.requestId,
    diagnostics: [],
    unavailable: 'Not linked'
  });
  await rejection;
  client.dispose();
});
