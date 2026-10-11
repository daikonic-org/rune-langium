// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T020 — telemetry client tests.
 * Asserts the wire shape, opt-out behaviour, and dev-mode no-op per
 * contracts/telemetry-event.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTelemetryClient,
  resolveTelemetryEndpoint,
  TELEMETRY_ENDPOINT_PROD,
  type TelemetryEvent,
  type TelemetryClient
} from '../../src/services/telemetry.js';

const ENDPOINT = 'https://example.test/api/telemetry/v1/event';

describe('telemetry client (T020)', () => {
  const clients: TelemetryClient[] = [];
  const client = () => {
    const t = createTelemetryClient({ endpoint: ENDPOINT, enabled: true, studioVersion: 'test', uaClass: 'test' });
    clients.push(t);
    return t;
  };

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  });
  afterEach(() => {
    for (const t of clients.splice(0)) t.dispose?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('posts a curated_load_attempt event with the documented envelope', async () => {
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    await t.emit({ event: 'curated_load_attempt', modelId: 'cdm' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '{}');
    expect(body).toMatchObject({
      event: 'curated_load_attempt',
      modelId: 'cdm',
      studio_version: '0.1.0',
      ua_class: 'Chromium 130'
    });
  });

  it('rejects an event that fails the schema (extra field)', async () => {
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    // @ts-expect-error — intentional extra field
    await expect(t.emit({ event: 'curated_load_attempt', modelId: 'cdm', userId: 'x' })).rejects.toThrow(/schema/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: false,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    await t.emit({ event: 'workspace_open_success' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the endpoint hostname is localhost', async () => {
    const t = createTelemetryClient({
      endpoint: 'http://localhost:8080/v1/event',
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    await t.emit({ event: 'workspace_open_success' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('swallows a non-2xx response (telemetry MUST NOT block the user)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    await expect(t.emit({ event: 'workspace_open_success' })).resolves.toBeUndefined();
  });

  it('retries rejected batches after the server delay and queues subsequent events', async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ retry_after_s: 5 }), { status: 429 }));
    const t = client();
    await t.emit({ event: 'workspace_open_success' });
    await t.emit({ event: 'workspace_restore_success' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const events = fetchSpy.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).event);
    expect(events).toEqual(['workspace_open_success', 'workspace_open_success', 'workspace_restore_success']);
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ keepalive: true, credentials: 'omit' });
  });

  it('bounds retries and discards pending events on disposal or opt-out', async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }));
    const t = client();
    await t.emit({ event: 'workspace_open_success' });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await t.emit({ event: 'workspace_restore_success' });
    t.dispose?.();
    const count = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(fetchSpy).toHaveBeenCalledTimes(count);
  });

  it('swallows a network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'Chromium 130'
    });
    await expect(t.emit({ event: 'workspace_restore_failure' } satisfies TelemetryEvent)).resolves.toBeUndefined();
  });

  it('bounds a stalled request without replaying it and continues the queue', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const t = client();
    const first = t.emit({ event: 'workspace_open_success' });
    await t.emit({ event: 'workspace_restore_success' });
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string).event).toBe('workspace_restore_success');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops retries after consent is withdrawn, including when consent later returns', async () => {
    vi.useFakeTimers();
    let enabled = true;
    const t = createTelemetryClient({
      endpoint: ENDPOINT,
      enabled: true,
      studioVersion: 'test',
      uaClass: 'test',
      isEnabled: () => enabled
    });
    clients.push(t);
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '5' } }));
    await t.emit({ event: 'workspace_open_success' });
    enabled = false;
    await vi.advanceTimersByTimeAsync(5000);
    enabled = true;
    await t.emit({ event: 'workspace_restore_success' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string).event).toBe('workspace_restore_success');
  });

  it('does not retry early when Retry-After exceeds the timer range', async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '3000000' } }));
    await client().emit({ event: 'workspace_open_success' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveTelemetryEndpoint (T113)', () => {
  it('returns the production worker URL for the daikonic.dev origin', () => {
    expect(resolveTelemetryEndpoint('https://www.daikonic.dev')).toBe(TELEMETRY_ENDPOINT_PROD);
  });

  it('returns a localhost URL when origin is dev/localhost (no-op path)', () => {
    expect(resolveTelemetryEndpoint('http://localhost:5173')).toBe(
      'http://localhost:5173/rune-studio/api/telemetry/v1/event'
    );
    expect(resolveTelemetryEndpoint('http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173/rune-studio/api/telemetry/v1/event'
    );
  });

  it('falls back to production for an unparseable origin', () => {
    expect(resolveTelemetryEndpoint('not a url')).toBe(TELEMETRY_ENDPOINT_PROD);
  });

  it('maps file: URLs to a known-localhost URL (file: origin is the string "null")', () => {
    // `new URL('file:///x/index.html').origin === 'null'` — naïve template
    // interpolation produced the malformed `null/rune-studio/...`.
    const result = resolveTelemetryEndpoint('file:///Users/me/index.html');
    expect(result).not.toMatch(/^null\//);
    expect(result).toBe('http://localhost/rune-studio/api/telemetry/v1/event');
  });
});
