// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestCodegenDownload } from '../../src/services/codegen-download-client.js';

class DownloadWorker {
  static current: DownloadWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    DownloadWorker.current = this;
  }
}

const body = { files: [], target: 'typescript', curatedBundles: [{ id: 'cdm', version: 'latest' }] };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', DownloadWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('returns the transferred artifact and releases the worker', async () => {
  const result = requestCodegenDownload(body);
  const worker = DownloadWorker.current;
  expect(worker.postMessage).toHaveBeenCalledWith(body);
  worker.onmessage?.({
    data: {
      body: new TextEncoder().encode('generated').buffer,
      status: 200,
      headers: [['Content-Disposition', 'attachment; filename="cdm.zip"']]
    }
  });
  const response = await result;
  expect(await response.text()).toBe('generated');
  expect(response.headers.get('Content-Disposition')).toContain('cdm.zip');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('uses the Pages endpoint when curated source arrays are empty', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('generated'));
  vi.stubGlobal('fetch', fetchMock);
  const userOnlyBody = { ...body, curatedBundles: [], curatedDocs: [] };

  await expect(requestCodegenDownload(userOnlyBody)).resolves.toBeInstanceOf(Response);

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/codegen',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(userOnlyBody) })
  );
});

it.each(['error', 'messageerror', 'reply', 'timeout'])('settles and releases on %s', async (kind) => {
  const result = requestCodegenDownload(body);
  const rejected = expect(result).rejects.toThrow();
  const worker = DownloadWorker.current;
  if (kind === 'error') worker.onerror?.({ message: 'crashed' });
  if (kind === 'messageerror') worker.onmessageerror?.();
  if (kind === 'reply') worker.onmessage?.({ data: { error: 'build failed' } });
  if (kind === 'timeout') await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a curated request and releases its worker', async () => {
  const controller = new AbortController();
  const result = requestCodegenDownload(body, controller.signal);
  const worker = DownloadWorker.current;

  controller.abort();

  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps a managed snapshot in structured-clone transport even without legacy curated sources', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const managed = {
    files: [],
    target: 'typescript',
    project: { snapshot: { files: new Map([['model/a.rosetta', 'namespace a']]) } }
  };
  const result = requestCodegenDownload(managed);
  const worker = DownloadWorker.current;
  expect(worker.postMessage).toHaveBeenCalledWith(managed);
  worker.onmessage?.({ data: { body: new ArrayBuffer(0), status: 200, headers: [] } });
  await result;
  expect(fetchMock).not.toHaveBeenCalled();
});
