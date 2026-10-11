// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOutputStore } from '../../src/store/output-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import { useTelemetrySettingsStore } from '../../src/store/telemetry-settings.js';
import { installTelemetryShipper, resetTelemetryShipperForTests } from '../../src/services/telemetry-shipper.js';
import { createTelemetryClient, MAX_SPAN_DURATION_MS } from '../../src/services/telemetry.js';

describe('installTelemetryShipper', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });
    useTelemetrySettingsStore.setState({ enabled: true, hydrated: true });
    resetTelemetryShipperForTests();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.useRealTimers();
  });

  it('flushes buffered spans before page exit and removes the listener on teardown', () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('before reload', 'error', { op: 'clientError' });
    window.dispatchEvent(new Event('pagehide'));
    expect(emit).toHaveBeenCalledTimes(1);
    uninstall();
    uninstall = undefined;
    useOutputStore.getState().addLine('after teardown', 'error', { op: 'clientError' });
    window.dispatchEvent(new Event('pagehide'));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('splits a large backfill into schema-valid batches without dropping spans', () => {
    for (let i = 0; i < 105; i++) useOutputStore.getState().addLine('error', 'error', { op: 'clientError' });
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit }, { backfillPreInstall: true });
    expect(emit.mock.calls.flatMap(([event]) => event.spans)).toHaveLength(105);
    expect(emit.mock.calls.every(([event]) => event.spans.length <= 50)).toBe(true);
  });

  it('does not flush buffered spans after consent is withdrawn', () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('before opt-out', 'error', { op: 'clientError' });
    useTelemetrySettingsStore.setState({ enabled: false });
    window.dispatchEvent(new Event('pagehide'));
    uninstall();
    uninstall = undefined;
    expect(emit).not.toHaveBeenCalled();
  });

  it('ships an error entry at 100% sample rate on the next flush tick', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('boom', 'error', { op: 'clientError', subject: 'sig' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([expect.objectContaining({ op: 'clientError', level: 'error' })])
      })
    );
  });

  it('threads the error/warn dedup signature through to the shipped span, distinct from subject', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    // modelLoad is on the subject allowlist (see below) so this exercises
    // signature-threading without conflating it with the allowlist itself.
    useOutputStore
      .getState()
      .addLine('boom', 'error', { op: 'modelLoad', subject: 'cdm', signature: 'boom @ app.js:1' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([
          expect.objectContaining({ op: 'modelLoad', subject: 'cdm', signature: 'boom @ app.js:1' })
        ])
      })
    );
  });

  it('ships subject for an allowlisted op (modelLoad — a curated model id, never scratch content)', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    // 'error' severity for a deterministic 100% sample rate — 'info' is
    // only sampled at 2% and would make this test flaky.
    useOutputStore.getState().addLine('load failed', 'error', { op: 'modelLoad', subject: 'cdm' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([expect.objectContaining({ op: 'modelLoad', subject: 'cdm' })])
      })
    );
  });

  it('drops subject for a non-allowlisted output-store op', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('boom', 'error', { op: 'someOtherOp', subject: 'not-vetted' });
    await vi.advanceTimersByTimeAsync(15_000);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const span = spans.find((s: { op: string }) => s.op === 'someOtherOp');
    expect(span).toBeDefined();
    expect(span.subject).toBeUndefined();
  });

  it('drops subject for activity-store entries whose op is not allowlisted — e.g. functionExecute, whose subject is a user-authored model function name', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    // ok:false -> level 'error' (100% sample rate) for a deterministic test;
    // ok:true would map to 'info' (2% sampled) and be flaky.
    useActivityStore
      .getState()
      .addActivity('functionExecute', false, 'myScratchFunc failed', { subject: 'myScratchFunc' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledTimes(1);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const span = spans.find((s: { op: string }) => s.op === 'functionExecute');
    expect(span).toBeDefined();
    expect(span.subject).toBeUndefined();
  });

  it('ships subject for activity-store entries on an allowlisted op', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useActivityStore.getState().addActivity('modelLoad', false, 'cdm load failed', { subject: 'cdm' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([expect.objectContaining({ op: 'modelLoad', subject: 'cdm' })])
      })
    );
  });

  it('drops subject for a modelLoad entry whose subject is a custom-URL model id, not a real curated id', async () => {
    // Codex P1 (round 5): modelLoad also fires for custom-URL sources
    // (createCustomModelSource in model-registry.ts), whose id is
    // `custom-${hashUrl(repoUrl)}` — a dictionary-matchable hash of the
    // user's own repo URL, not a curated id. The op-name allowlist alone
    // isn't enough; the subject VALUE must be checked against the real
    // curated id set too.
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('load failed', 'error', { op: 'modelLoad', subject: 'custom-1a2b3c' });
    await vi.advanceTimersByTimeAsync(15_000);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const span = spans.find((s: { op: string }) => s.op === 'modelLoad');
    expect(span).toBeDefined();
    expect(span.subject).toBeUndefined();
  });

  it('deduplicates a paired output-store + activity-store entry sharing the same opId (e.g. a failed model load publishes to both)', async () => {
    // Codex P2 (round 5): model-store.ts's load-failure path calls both
    // addLine (severity 'error') and addActivity (ok:false -> level
    // 'error') with the SAME opId — both clear the 100% error sample rate,
    // so without dedup this would ship as two spans, double-counting one
    // real failure in the server-side duration histogram.
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('load failed', 'error', { op: 'modelLoad', durationMs: 500, opId: 777 });
    useActivityStore.getState().addActivity('modelLoad', false, 'cdm load failed', { durationMs: 500, opId: 777 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledTimes(1);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const matching = spans.filter((s: { opId?: number }) => s.opId === 777);
    expect(matching).toHaveLength(1);
  });

  it('does not deduplicate distinct opIds', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('one', 'error', { op: 'modelLoad', opId: 1 });
    useOutputStore.getState().addLine('two', 'error', { op: 'modelLoad', opId: 2 });
    await vi.advanceTimersByTimeAsync(15_000);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    expect(spans).toHaveLength(2);
  });

  it('does not ship anything when telemetry is disabled', async () => {
    useTelemetrySettingsStore.setState({ enabled: false, hydrated: true });
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('boom', 'error', { op: 'clientError' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('rounds a fractional durationMs (as performance.now() deltas always are) — the wire schema requires an integer', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('loaded', 'error', { op: 'modelLoad', durationMs: 1234.5678 });
    await vi.advanceTimersByTimeAsync(15_000);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const span = spans.find((s: { op: string }) => s.op === 'modelLoad');
    expect(span).toBeDefined();
    expect(Number.isInteger(span.durationMs)).toBe(true);
    expect(span.durationMs).toBe(1235);
  });

  it('a fractional durationMs no longer fails REAL schema validation, so the batch actually reaches fetch()', async () => {
    // Regression for the actual bug: createTelemetryClient's emit() runs
    // Zod schema validation (durationMs must be an integer) BEFORE the
    // network call. Before this fix, that validation threw for any batch
    // containing a fractional duration, and installTelemetryShipper's
    // flush() swallows the rejection — so the ONLY externally-observable
    // symptom is that fetch() never gets called (the batch silently
    // vanishes). Asserting fetch WAS called, with an integer durationMs in
    // the body, is what actually distinguishes "bug present" (never
    // called) from "bug fixed" (called).
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createTelemetryClient({
      endpoint: 'https://example.invalid/rune-studio/api/telemetry/v1/event',
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'test'
    });
    uninstall = installTelemetryShipper(client);
    useOutputStore.getState().addLine('loaded', 'error', { op: 'modelLoad', durationMs: 42.999 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const span = body.spans.find((s: { op: string }) => s.op === 'modelLoad');
    expect(Number.isInteger(span.durationMs)).toBe(true);
    vi.unstubAllGlobals();
  });

  // Regression for the sibling failure mode Codex flagged in the same PR
  // review round: an instrumented call with no abort timeout (e.g.
  // transport-provider.ts's mintSessionToken fetch) can in principle stay
  // pending past the wire schema's 600_000ms (10 min) max before finally
  // rejecting. toSpan() only rounded, never clamped — an out-of-range
  // durationMs fails REAL schema validation the same way a fractional one
  // did above, silently dropping the whole batch.
  it('clamps a durationMs exceeding the wire schema max instead of shipping it unclamped', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useOutputStore.getState().addLine('boom', 'error', { op: 'mintSessionToken', durationMs: 999_999 });
    await vi.advanceTimersByTimeAsync(15_000);
    const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
    const span = spans.find((s: { op: string }) => s.op === 'mintSessionToken');
    expect(span).toBeDefined();
    expect(span.durationMs).toBe(MAX_SPAN_DURATION_MS);
  });

  it('an over-max durationMs no longer fails REAL schema validation, so the batch actually reaches fetch()', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createTelemetryClient({
      endpoint: 'https://example.invalid/rune-studio/api/telemetry/v1/event',
      enabled: true,
      studioVersion: '0.1.0',
      uaClass: 'test'
    });
    uninstall = installTelemetryShipper(client);
    useOutputStore.getState().addLine('boom', 'error', { op: 'mintSessionToken', durationMs: 999_999 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    const span = body.spans.find((s: { op: string }) => s.op === 'mintSessionToken');
    expect(span.durationMs).toBe(MAX_SPAN_DURATION_MS);
    vi.unstubAllGlobals();
  });

  it('flushes early once the buffer reaches 20 entries without waiting for the timer', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    for (let i = 0; i < 20; i++) {
      useOutputStore.getState().addLine(`err ${i}`, 'error', { op: 'clientError' });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].spans).toHaveLength(20);
  });

  it('still picks up a new entry after the underlying store rotates (front-trims) its array', async () => {
    // Seed a few entries so the watermark advances past 0, then simulate
    // ring-buffer rotation: the store's array "shrinks" (old entries
    // trimmed from the front) while a new entry with a higher `id` than
    // anything previously seen is appended. A length-based watermark
    // (`lines.length <= lastOutputLen`) would treat this as "no growth"
    // and silently drop the new entry; the id-based watermark must not.
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });

    useOutputStore.getState().addLine('one', 'error', { op: 'first' });
    useOutputStore.getState().addLine('two', 'error', { op: 'second' });
    useOutputStore.getState().addLine('three', 'error', { op: 'third' });
    // Advance past the flush so these don't get counted twice, and clear the
    // mock so only the post-rotation entry is asserted below.
    await vi.advanceTimersByTimeAsync(15_000);
    emit.mockClear();

    // `_idCounter` in output-store.ts is a module-level counter shared across
    // the whole test file (never reset by `setState({ lines: [] })`), so we
    // can't hardcode an id here — derive the next id relative to whatever the
    // counter has actually reached. Simulate rotation: the array shrinks to
    // just ONE entry (as if everything before it had been trimmed from the
    // front), but that entry's id is higher than the last-seen watermark.
    const lastSeenId = useOutputStore.getState().lines.at(-1)?.id ?? 0;
    useOutputStore.setState({
      lines: [{ id: lastSeenId + 1, text: 'rotated-in', severity: 'error', ts: performance.now(), op: 'afterRotation' }]
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([expect.objectContaining({ op: 'afterRotation', level: 'error' })])
      })
    );
  });

  // Regression coverage for the App.tsx boot-order race: for a returning
  // user, hydrateTelemetrySettings() resolving (and this shipper's effect
  // installing) can lag behind a namespace-tagged span that already
  // completed and landed in the Activity store — see this file's own
  // "hasInstalledBefore" comment in telemetry-shipper.ts. Caught via PR
  // review on rune-langium#486's connect-phase instrumentation, whose
  // whole point is capturing exactly this kind of cold-start span.
  it('ships an activity-store entry that arrived BEFORE the first-ever install of a session, when backfillPreInstall is explicitly requested', async () => {
    // Simulate the race directly: the entry lands in the store first,
    // exactly as it would while the app is still waiting on
    // hydrateTelemetrySettings() to resolve for a RETURNING, already-
    // consenting user. `ok: false` (-> level 'error') for a deterministic
    // 100%-sampled assertion, matching this file's other sample-rate-
    // sensitive tests.
    useActivityStore.getState().addActivity('lsp', false, 'connectPagesFunctionLsp', { durationMs: 42 });

    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit }, { backfillPreInstall: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'op_spans',
        spans: expect.arrayContaining([expect.objectContaining({ op: 'lsp', durationMs: 42, level: 'error' })])
      })
    );
  });

  // Regression for the privacy-adjacent gap the first version of the fix
  // above had (caught in the same PR review round): a FRESH, first-time
  // explicit opt-in this session must NEVER backfill — any activity
  // predates the user's consent. This is App.tsx omitting
  // backfillPreInstall (the safe default), not a hydration race.
  it('does NOT ship a pre-install entry when backfillPreInstall is omitted (the default) — a fresh explicit opt-in, not a hydration race', async () => {
    useActivityStore.getState().addActivity('lsp', false, 'connectPagesFunctionLsp', { durationMs: 42 });

    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('does NOT re-ship a backlog on a re-toggle (second) install, even if backfillPreInstall is passed again', async () => {
    const firstEmit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit: firstEmit }, { backfillPreInstall: true });
    // User toggles telemetry off — App.tsx's effect teardown runs.
    uninstall();
    uninstall = undefined;

    // While off, an entry accumulates (e.g. a background reconnect).
    useActivityStore.getState().addActivity('lsp', true, 'connectPagesFunctionLsp', { durationMs: 99 });

    // User toggles telemetry back on — a SECOND install in the same
    // session, deliberately NOT calling resetTelemetryShipperForTests()
    // (that's test-only scaffolding for simulating a fresh session).
    // Passing backfillPreInstall: true again proves the guard is really
    // "only the first install ever" (hasInstalledBefore), not just
    // whichever flag value was passed most recently.
    const secondEmit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit: secondEmit }, { backfillPreInstall: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(secondEmit).not.toHaveBeenCalled();
  });

  // Regression for the sibling finding in the same review round: the
  // Activity sink previously stored only record.namespace as the shipped
  // span's op, collapsing every op sharing a namespace (e.g.
  // mintSessionToken/openPagesFunctionWs/connectPagesFunctionLsp, all
  // namespace: 'lsp') into one indistinguishable telemetry sample.
  it('ships the real op name, not the coarser namespace tag, when an activity entry carries one', async () => {
    const emit = vi.fn(async () => {});
    uninstall = installTelemetryShipper({ emit });
    useActivityStore.getState().addActivity('lsp', false, 'connect failed', { durationMs: 7, op: 'mintSessionToken' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        spans: expect.arrayContaining([expect.objectContaining({ op: 'mintSessionToken' })])
      })
    );
  });

  // Connect-phase ops (mintSessionToken/openPagesFunctionWs/
  // connectPagesFunctionLsp/lsp) are inherently low-frequency — once per
  // page load or reconnect, never per-hover — so they bypass the normal
  // level-based sampling entirely (FULL_SAMPLE_OPS in telemetry-shipper.ts)
  // rather than getting lost in the 2% 'info' rate that makes sense for
  // high-frequency events. Math.random mocked to a value that would fail
  // EVERY level's rate (including 'warn' at 20%) to prove these ops really
  // bypass the random check, not just get lucky.
  describe('FULL_SAMPLE_OPS — always-100%-sampled low-frequency connect ops', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("ships a successful (info-level) connect-phase span even when Math.random would fail every level's rate", async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const emit = vi.fn(async () => {});
      uninstall = installTelemetryShipper({ emit });
      useActivityStore.getState().addActivity('lsp', true, 'connected', { durationMs: 996, op: 'openPagesFunctionWs' });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          spans: expect.arrayContaining([expect.objectContaining({ op: 'openPagesFunctionWs', level: 'info' })])
        })
      );
    });

    it('does NOT bypass sampling for an ordinary info-level op with the same Math.random mock', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const emit = vi.fn(async () => {});
      uninstall = installTelemetryShipper({ emit });
      useActivityStore.getState().addActivity('modelLoad', true, 'loaded', { durationMs: 12 });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(emit).not.toHaveBeenCalled();
    });

    it('ships every connect-phase op name in the allowlist', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const emit = vi.fn(async () => {});
      uninstall = installTelemetryShipper({ emit });
      useActivityStore.getState().addActivity('lsp', true, 'connected', { op: 'lsp' });
      useActivityStore.getState().addActivity('lsp', true, 'minted', { op: 'mintSessionToken' });
      useActivityStore.getState().addActivity('lsp', true, 'ws opened', { op: 'openPagesFunctionWs' });
      useActivityStore.getState().addActivity('lsp', true, 'connected', { op: 'connectPagesFunctionLsp' });
      await vi.advanceTimersByTimeAsync(15_000);
      const spans = emit.mock.calls[0]?.[0]?.spans ?? [];
      const shippedOps = spans.map((s: { op: string }) => s.op).sort();
      expect(shippedOps).toEqual(['connectPagesFunctionLsp', 'lsp', 'mintSessionToken', 'openPagesFunctionWs']);
    });
  });
});
