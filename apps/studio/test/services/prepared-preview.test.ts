// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { executePreparedWorkflow } from '../../src/services/prepared-preview.js';
import type { PreparedWorkflowData } from '../../src/services/prepared-workflow.js';

class TestWorker extends EventTarget implements Worker {
  onmessage = null;
  onmessageerror = null;
  onerror = null;
  posted: Record<string, unknown>[] = [];
  terminate = vi.fn();
  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
  }
  reply(message: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}
async function fixture() {
  const base = await createProjectSnapshot(
    'prepared',
    new Map([['rune-config.yml', 'model: {name: Prepared}']]),
    () => []
  );
  const project = await captureProjectRuntimeInput(base, [], []);
  const data: PreparedWorkflowData = {
    base,
    project,
    sources: {},
    receipt: {
      schemaVersion: 1,
      projectRevision: base.revision,
      executionId: crypto.randomUUID(),
      queryCount: 1,
      driverRevision: 'a'.repeat(64),
      moduleRevision: 'b'.repeat(64),
      sourceRevisions: {}
    }
  };
  const worker = new TestWorker();
  const abort = new AbortController();
  return {
    data,
    worker,
    abort,
    execute: () => executePreparedWorkflow(data, 'prepared.Calculate', { amount: 100 }, abort.signal, () => worker)
  };
}
function message(worker: TestWorker, type: string) {
  const found = worker.posted.find((entry) => entry.type === type);
  if (!found) throw new Error('Missing message: ' + type);
  return found;
}
afterEach(() => vi.useRealTimers());

it('requires a matching prepared snapshot acknowledgement and correlates results before disposing the worker', async () => {
  const f = await fixture();
  const output = f.execute();
  const install = message(f.worker, 'preview:setFiles');
  const ready = {
    type: 'preview:files-ready',
    requestId: install.requestId,
    filesRevision: 1,
    projectReceipt: f.data.project.receipt
  };
  f.worker.reply({ ...ready, requestId: 'another-install' });
  expect(f.worker.posted).toHaveLength(1);
  f.worker.reply(ready);
  await vi.waitFor(() => expect(f.worker.posted).toHaveLength(2));
  const request = message(f.worker, 'preview:execute');
  expect(request).toMatchObject({ inputs: { amount: 100 }, projectReceipt: f.data.project.receipt });
  f.worker.reply({
    type: 'preview:execute-result',
    requestId: 'another-run',
    output: -1,
    projectReceipt: f.data.project.receipt
  });
  f.worker.reply({
    type: 'preview:execute-result',
    requestId: request.requestId,
    output: 43.3,
    projectReceipt: f.data.project.receipt
  });
  await expect(output).resolves.toBe(43.3);
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});

it('rejects a mismatched installation without executing a function', async () => {
  const f = await fixture();
  const result = expect(f.execute()).rejects.toThrow('different revision');
  f.worker.reply({
    type: 'preview:files-ready',
    requestId: message(f.worker, 'preview:setFiles').requestId,
    filesRevision: 1,
    projectReceipt: { ...f.data.project.receipt, revision: 'f'.repeat(64) }
  });
  await result;
  expect(f.worker.posted).toHaveLength(1);
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});

it.each(['preparing', 'calculating'])(
  'disposes a canceled worker while %s and ignores late messages',
  async (phase) => {
    const f = await fixture();
    const pending = f.execute();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (phase === 'calculating') {
      f.worker.reply({
        type: 'preview:files-ready',
        requestId: message(f.worker, 'preview:setFiles').requestId,
        filesRevision: 1,
        projectReceipt: f.data.project.receipt
      });
      await vi.waitFor(() => expect(f.worker.posted).toHaveLength(2));
    }
    f.abort.abort();
    await rejected;
    expect(f.worker.terminate).toHaveBeenCalledOnce();
    f.worker.reply({
      type: 'preview:execute-result',
      requestId: f.worker.posted.at(-1)?.requestId,
      output: 'late',
      projectReceipt: f.data.project.receipt
    });
  }
);

it('cleans up startup failures and its timeout', async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const result = expect(f.execute()).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000);
  await result;
  expect(f.worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  const other = await fixture();
  const failed = expect(other.execute()).rejects.toThrow('unavailable');
  other.worker.dispatchEvent(new Event('error'));
  await failed;
  expect(other.worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not create an already canceled worker and cleans up a failed installation post', async () => {
  const f = await fixture(),
    createWorker = vi.fn(() => f.worker);
  f.abort.abort();
  await expect(
    executePreparedWorkflow(f.data, 'prepared.Calculate', {}, f.abort.signal, createWorker)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(createWorker).not.toHaveBeenCalled();
  vi.spyOn(f.worker, 'postMessage').mockImplementation(() => {
    throw new Error('post failed');
  });
  await expect(
    executePreparedWorkflow(f.data, 'prepared.Calculate', {}, new AbortController().signal, createWorker)
  ).rejects.toThrow('post failed');
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});
