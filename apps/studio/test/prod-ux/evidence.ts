// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, ConsoleMessage, Request, Response } from '@playwright/test';
import type { OpLogEntry } from '../../src/services/op-log.js';
import { waitForEntranceAnimations } from './readiness.js';
import { buildTimingsRollup, type TimingRecord } from './timings.js';
import { captureNetworkResponse, type NetworkRecord } from './network-evidence.js';

export interface Checkpoint {
  name: string;
  screenshot: string;
  tMs: number;
}

export interface SoftFinding {
  ledgerId: string;
  detail: string;
}

/** One root's closure-walk result, as recorded into the manifest by J18. */
export interface TypeClosureRecord {
  rootFqn: string;
  rootKind: 'curated' | 'scratch';
  visitedCount: number;
  mappedCount: number;
  unmapped: string[];
  hydrationsTriggered: number;
  truncated: boolean;
  typeClosureWalkMs: number;
}

export interface CapturedOpLogEntry extends OpLogEntry {
  /** Page navigation identity; optional for older evidence bundles. */
  navigationGeneration?: number;
}

export interface JourneyRecord {
  id: string;
  title: string;
  verdict: 'PASS' | 'DEGRADED' | 'FAIL' | 'BLOCKED';
  durationMs: number;
  checkpoints: Checkpoint[];
  consoleErrors: string[];
  failedRequests: string[];
  softFindings: SoftFinding[];
  /** Playwright TestInfo.retry — 0 on the first attempt, 1+ on a retry. */
  retry: number;
  /** window.__runeStudioOpLog snapshot captured at journey teardown. */
  opLog: CapturedOpLogEntry[];
  /**
   * Earlier, superseded attempt(s) for this same journey id (e.g. a FAIL that
   * was then retried and passed). Never silently discarded — see
   * appendJourneyRecord.
   */
  previousAttempts?: JourneyRecord[];
  /** Populated only by J18 (data-type closure mapping) — one entry per walked root. */
  typeClosure?: TypeClosureRecord[];
  network?: NetworkRecord[];
}

/** Exported so test suites (e.g. fixtures.test.ts) can back up/restore the on-disk manifest around their own writes. */
export const REPORT_DIR = process.env.PROD_UX_REPORT_DIR || path.join(process.cwd(), 'test/prod-ux/report');

/**
 * Upper bound on how long `finish()` waits for in-flight response-body reads.
 * A stalled or continuously-streamed response body must not block teardown
 * forever — after this timeout, `finish()` proceeds with whatever's already
 * recorded (the status-only line, for any entry whose body hadn't finished).
 */
const BODY_READ_TIMEOUT_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EvidenceCollector {
  private readonly startedAt: number;
  private readonly consoleErrors: string[] = [];
  private readonly failedRequests: string[] = [];
  private readonly checkpoints: Checkpoint[] = [];
  private readonly softFindings: SoftFinding[] = [];
  private readonly network: NetworkRecord[] = [];
  private typeClosureRecords: TypeClosureRecord[] = [];
  private seq = 0;
  private timingSeq = 0;
  /** In-flight response-body reads from the `response` handler below — awaited by `finish()` so a body that's still being read when the journey ends isn't silently dropped. */
  private readonly pendingBodyReads: Promise<void>[] = [];
  /**
   * Op-log/perf-log entries a journey explicitly captured mid-run (see
   * fixtures.ts's `captureOpLogSnapshot`) — survives a `page.reload()`
   * because it lives here (Node/Playwright process), not in the page,
   * unlike a fresh `readOpLog`/`readPerfLog` call after the fact. Merged
   * into `finish()`'s final opLog, deduped against it so an entry snapshot
   * both mid-run and again at teardown (e.g. a journey that never
   * reloads) isn't double-counted.
   */
  private readonly accumulatedOpLog: CapturedOpLogEntry[] = [];
  private readonly seenOpLogKeys = new Set<string>();
  /**
   * Bumped by `markNavigation()`, and folded into `recordOpLog`'s dedup
   * key — see that method's doc comment for why sourceId/ts/message alone
   * aren't a safe cross-navigation identity.
   */
  private navigationGeneration = 0;

  constructor(
    private readonly page: Page,
    private readonly journeyId: string,
    private readonly title: string,
    /** Playwright TestInfo.retry — 0 on the first attempt, 1+ on a retry. */
    private readonly retry = 0
  ) {
    this.startedAt = Date.now();
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        this.consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err: Error) => {
      this.consoleErrors.push(`[pageerror] ${err.message}`);
    });
    page.on('requestfailed', (req: Request) => {
      this.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
    // requestfailed only fires for network-level failures (DNS, connection
    // refused, aborted) — a first-party request that COMPLETES with a 4xx/5xx
    // status (e.g. a Worker returning 500) never fires it. Catch those here.
    page.on('response', (response: Response) => {
      const pathname = new URL(response.url()).pathname;
      if (/^\/api\/(parse|curated-source|codegen)$/.test(pathname) || /^\/curated\/.*\.json$/.test(pathname)) {
        this.pendingBodyReads.push(
          captureNetworkResponse(response)
            .then((record) => {
              this.network.push(record);
            })
            .catch(() => {})
        );
      }
      const status = response.status();
      if (status < 400) return;
      let sameOrigin = false;
      try {
        sameOrigin = new URL(response.url()).origin === new URL(this.page.url()).origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) return;
      const line = `${response.request().method()} ${response.url()} — HTTP ${status}`;
      const index = this.failedRequests.push(line) - 1;
      // Best-effort: append the response body (e.g. Pages Functions' `{ ok:
      // false, diagnostics, error }` envelopes) so a triager doesn't have to
      // manually reproduce the request to see WHY it failed — a truncated
      // console.error (browser-side [Object] serialization) was previously
      // the only signal, which required exactly that. Chrome's DevTools
      // protocol can legitimately evict a response body from its buffer
      // before this read runs, so this is genuinely best-effort — silently
      // fall back to the status-only line above on failure rather than
      // throwing out of an event handler.
      if ((response.headers()['content-type'] ?? '').includes('application/json')) {
        this.pendingBodyReads.push(
          response
            .text()
            .then((body) => {
              this.failedRequests[index] = `${line} — ${body.slice(0, 4000)}`;
            })
            .catch(() => {
              // Body unavailable (evicted/consumed) — the status-only line already recorded stands.
            })
        );
      }
    });
  }

  async checkpoint(name: string): Promise<void> {
    this.seq += 1;
    // journeyId can contain a `:` (e.g. "J13:generate", from computeJourneyId's
    // sub-test disambiguation) — filesystem-legal on macOS/Linux where this
    // runs locally, but actions/upload-artifact rejects `:` in any uploaded
    // path unconditionally (NTFS-safety rule), which silently fails the
    // nightly CI upload. Sanitize ONLY the directory name — never the
    // manifest's own journeyId/`id` field, which stays exactly as computed.
    const safeJourneyId = this.journeyId.replaceAll(':', '-');
    const dir = path.join(REPORT_DIR, 'screenshots', safeJourneyId, `attempt${this.retry}`);
    await mkdir(dir, { recursive: true });
    const fileName = `${String(this.seq).padStart(2, '0')}-${name}.png`;
    const screenshotPath = path.join(dir, fileName);
    await waitForEntranceAnimations(this.page);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    this.checkpoints.push({
      name,
      screenshot: path.relative(REPORT_DIR, screenshotPath),
      tMs: Date.now() - this.startedAt
    });
  }

  recordTiming(op: string, subject: string, durationMs: number): void {
    this.recordOpLog([
      {
        op,
        subject,
        durationMs,
        panel: 'perf',
        sourceId: --this.timingSeq,
        level: 'info',
        message: 'Journey wall-clock measurement',
        ts: Date.now() - this.startedAt
      }
    ]);
  }

  async measure<T>(op: string, subject: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await action();
    } finally {
      this.recordTiming(op, subject, Date.now() - startedAt);
    }
  }

  softFinding(ledgerId: string, detail: string): void {
    this.softFindings.push({ ledgerId, detail });
  }

  /**
   * Folds op-log/perf-log entries into this collector's own accumulator —
   * call via fixtures.ts's `captureOpLogSnapshot` right before a
   * `page.reload()` (or anything else that tears down the page's JS
   * context) so entries produced before that point still reach the
   * persisted manifest instead of being silently wiped along with the
   * page's in-memory op-log/perf-log stores.
   *
   * Every `entry.ts` here is a `performance.now()` value, which is
   * relative to the PAGE's own navigation — its origin resets on
   * `page.reload()`. Entries from one `recordOpLog` call are comparable
   * among themselves (same page context, sorted here), but NOT
   * comparable against entries from a DIFFERENT call that happened across
   * a reload — a small post-reload `ts` is not "earlier" than a large
   * pre-reload one. Call order is the only ordering signal that survives
   * a reload (this collector accumulates in the order the journey called
   * it, which is always chronological test-execution order), so entries
   * are appended in per-call sorted batches, never globally re-sorted by
   * `ts` across calls — see `finish()`.
   */
  recordOpLog(entries: readonly OpLogEntry[]): void {
    const sorted = [...entries].sort((a, b) => a.ts - b.ts);
    for (const entry of sorted) {
      // sourceId (op-log.ts's OutputLine.id / ActivityEntry.id / perf-log's
      // opId — see its doc comment) is the real per-entry identity: unlike
      // `opId` (often absent) or `message` (two distinct entries — e.g.
      // two diagnostics with the same code — can share identical text),
      // it's guaranteed unique among entries produced by the SAME page
      // navigation. It alone isn't enough across a `page.reload()` though:
      // the underlying id counters reset on reload just like
      // performance.now() does, so a post-reload entry can legitimately
      // reuse a pre-reload entry's sourceId — and ts/message aren't safe
      // tie-breakers either: a fixed startup log line firing at a similar
      // early performance.now() offset on every load can genuinely repeat
      // sourceId, ts (clamped), AND message across two navigations
      // (correction: an earlier version of this comment called that
      // "vanishingly unlikely" — it isn't, for exactly this boilerplate-
      // message case). navigationGeneration (bumped by `markNavigation`,
      // which a journey calls right after each `page.reload()`) is the
      // only thing that's actually guaranteed to differ across
      // navigations, so it anchors the key instead of relying on
      // probabilistic collision-avoidance.
      const key = `${this.navigationGeneration}:${entry.panel}:${entry.op}:${entry.sourceId}:${entry.ts}:${entry.message}`;
      if (this.seenOpLogKeys.has(key)) continue;
      this.seenOpLogKeys.add(key);
      this.accumulatedOpLog.push({ ...entry, navigationGeneration: this.navigationGeneration });
    }
  }

  /**
   * Call right after any `page.reload()` (or other navigation that tears
   * down the page's JS context) — bumps `navigationGeneration` so
   * `recordOpLog`'s dedup key can't mistake a NEW navigation's entry for a
   * duplicate of one from BEFORE the reload, even if they happen to share
   * every other field (sourceId, ts, message all reset/repeat per
   * navigation in the same way).
   */
  markNavigation(): void {
    this.navigationGeneration += 1;
  }

  /**
   * Records J18's per-root closure-walk results for inclusion in the next
   * `finish()` call. A setter rather than a `finish()` parameter — the
   * generic `checkout` fixture teardown in fixtures.ts always calls
   * `collector.finish(verdict)` with no knowledge of `typeClosure`
   * (a J18-specific field); routing it through mutable state here means
   * that teardown call picks it up automatically, with no risk of the
   * double-manifest-append a J18-local `finish()`/`appendJourneyRecord`
   * call would otherwise create.
   */
  setTypeClosure(records: TypeClosureRecord[]): void {
    this.typeClosureRecords = records;
  }

  /** True once at least one soft finding has been recorded — used by the
   *  fixture teardown to downgrade an otherwise-clean PASS to DEGRADED. */
  get hasSoftFindings(): boolean {
    return this.softFindings.length > 0;
  }

  /**
   * The full op-log accumulated so far via `recordOpLog` — including any
   * pre-reload entries a journey explicitly captured mid-run. The fixture
   * teardown reads this (after its own final `recordOpLog` call) to
   * compute the DEGRADED verdict via `exceedsBudget`, so a budget
   * violation captured before a reload isn't silently invisible to the
   * verdict just because it wasn't in the LAST `readCombinedOpLog` call —
   * `finish()`'s returned record and the verdict passed into it must
   * agree on the same underlying log.
   */
  get opLog(): CapturedOpLogEntry[] {
    return [...this.accumulatedOpLog];
  }

  async finish(verdict: JourneyRecord['verdict']): Promise<JourneyRecord> {
    // Response bodies can still be mid-read when the journey ends (e.g. a slow
    // or streaming error response) — wait for them so failedRequests carries
    // the full body instead of silently falling back to the status-only line.
    // Bounded: see BODY_READ_TIMEOUT_MS — a body that never completes must
    // not block this record from ever being written.
    await Promise.race([Promise.all(this.pendingBodyReads), delay(BODY_READ_TIMEOUT_MS)]);
    // No opLog parameter here (unlike an earlier version) — callers must
    // `recordOpLog` everything BEFORE calling finish(), and use `.opLog`
    // to compute the verdict from the SAME merged data finish() returns.
    // Passing a separate fresh-read `opLog` in here (merged only as a
    // final step) let the verdict be computed from a different, smaller
    // set than what the manifest ultimately recorded.
    const mergedOpLog = this.opLog;
    return {
      id: this.journeyId,
      title: this.title,
      verdict,
      durationMs: Date.now() - this.startedAt,
      checkpoints: this.checkpoints,
      consoleErrors: this.consoleErrors,
      failedRequests: this.failedRequests,
      softFindings: this.softFindings,
      retry: this.retry,
      opLog: mergedOpLog,
      network: this.network,
      typeClosure: this.typeClosureRecords.length > 0 ? this.typeClosureRecords : undefined
    };
  }
}

/** Strips previousAttempts so a superseded record doesn't nest its own history. */
function withoutPreviousAttempts(record: JourneyRecord): JourneyRecord {
  const { previousAttempts: _previousAttempts, ...rest } = record;
  return rest;
}

// The manifest is reset exactly once per `playwright test` invocation by
// global-setup.ts, which runs once in the main orchestrator process before
// any worker starts and is NOT re-run for retries. Worker processes, by
// contrast, restart on every retry (even with workers: 1), so a module-scope
// flag here cannot reliably detect "first call this run" — that's why the
// reset responsibility lives in global-setup.ts instead of this module. By
// the time this function runs, the manifest on disk (if any) always belongs
// to the current run, so we simply read-and-merge, falling back to a fresh
// manifest if it's absent or unparseable.

export interface RunManifest {
  runId: string;
  journeys: JourneyRecord[];
  timings: TimingRecord[];
}

export async function appendJourneyRecord(record: JourneyRecord): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const manifestPath = path.join(REPORT_DIR, 'run-manifest.json');
  let manifest: RunManifest;
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    manifest = { runId: `prod-ux-${new Date().toISOString()}`, journeys: [], timings: [] };
  }

  // A retry that supersedes a prior attempt for the same journey id must not
  // silently delete that prior attempt's evidence (e.g. a FAIL-then-PASS
  // flake) — fold it (and anything it already carried) into previousAttempts
  // on the surviving record, keeping ONE manifest entry per journey id.
  const existing = manifest.journeys.find((j) => j.id === record.id);
  const finalRecord: JourneyRecord = existing
    ? {
        ...record,
        previousAttempts: [...(existing.previousAttempts ?? []), withoutPreviousAttempts(existing)]
      }
    : record;

  manifest.journeys = manifest.journeys.filter((j) => j.id !== record.id);
  manifest.journeys.push(finalRecord);
  manifest.timings = buildTimingsRollup(manifest.journeys);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
