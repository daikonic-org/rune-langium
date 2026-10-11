// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression coverage for the journey-subid fallback (fixtures.ts's
 * `computeJourneyId` + evidence.ts's `appendJourneyRecord`) that fixes the
 * bug where two DIFFERENT tests sharing one `J<n>` group (e.g. J13's two
 * tests, both matching `^J13`) were silently merged into a single manifest
 * entry via `previousAttempts`, as if the second test were a retry of the
 * first.
 *
 * Exercises the REAL `appendJourneyRecord` (evidence.ts) against a real,
 * on-disk manifest file rather than hand-rolling a parallel reimplementation
 * of its merge logic (DRY — see this repo's CLAUDE.md "never build a
 * parallel implementation" rule). `test/prod-ux/report/` is disposable and
 * gitignored, and is reset by global-setup.ts before every real Playwright
 * prod-ux run — but this suite still backs up and restores any pre-existing
 * manifest content around its own writes, so it never permanently clobbers
 * evidence from a real run that happened to be sitting on disk when this
 * suite ran.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { computeJourneyId } from './fixtures.js';
import { appendJourneyRecord, REPORT_DIR, EvidenceCollector, type JourneyRecord } from './evidence.js';

const MANIFEST_PATH = path.join(REPORT_DIR, 'run-manifest.json');

let backup: string | undefined;

beforeEach(async () => {
  backup = await readFile(MANIFEST_PATH, 'utf-8').catch(() => undefined);
  await rm(MANIFEST_PATH, { force: true });
});

afterEach(async () => {
  if (backup === undefined) {
    await rm(MANIFEST_PATH, { force: true });
  } else {
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(MANIFEST_PATH, backup, 'utf-8');
  }
});

function makeRecord(overrides: Partial<JourneyRecord> & Pick<JourneyRecord, 'id' | 'title'>): JourneyRecord {
  return {
    verdict: 'PASS',
    durationMs: 1000,
    checkpoints: [],
    consoleErrors: [],
    failedRequests: [],
    softFindings: [],
    retry: 0,
    opLog: [],
    ...overrides
  };
}

async function readManifest(): Promise<{ runId: string; journeys: JourneyRecord[] }> {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
}

const RENDER_TITLE = 'J13 Export perspective renders and DownloadConfigDialog opens/edits/closes';
const GENERATE_TITLE = 'J13 Export generate — soft-asserted under KI-codegen-503';

describe('computeJourneyId', () => {
  it('leaves a bare group untouched when no subId is given (J0-J11/J18 behavior, unaffected by this change)', () => {
    expect(computeJourneyId(RENDER_TITLE)).toBe('J13');
  });

  it('produces distinct ids for the same group with different journey-subid values', () => {
    const render = computeJourneyId(RENDER_TITLE, 'render');
    const generate = computeJourneyId(GENERATE_TITLE, 'generate');
    expect(render).toBe('J13:render');
    expect(generate).toBe('J13:generate');
    expect(render).not.toBe(generate);
  });

  it('produces the SAME id across retries of the same test (same title + same journey-subid)', () => {
    const attempt0 = computeJourneyId(GENERATE_TITLE, 'generate');
    const attempt1 = computeJourneyId(GENERATE_TITLE, 'generate');
    expect(attempt0).toBe(attempt1);
  });
});

describe('appendJourneyRecord + computeJourneyId (journey-subid disambiguation)', () => {
  it('two tests sharing a group but with different journey-subid annotations produce two distinct, non-nested top-level manifest entries', async () => {
    const renderId = computeJourneyId(RENDER_TITLE, 'render');
    const generateId = computeJourneyId(GENERATE_TITLE, 'generate');

    // Simulates the fixture teardown for two DIFFERENT tests in the same
    // spec file, each running once (retry 0) — not a retry of one another.
    await appendJourneyRecord(makeRecord({ id: renderId, title: RENDER_TITLE, retry: 0 }));
    await appendJourneyRecord(makeRecord({ id: generateId, title: GENERATE_TITLE, retry: 0 }));

    const manifest = await readManifest();
    const j13Entries = manifest.journeys.filter((j) => j.id.startsWith('J13'));

    expect(j13Entries).toHaveLength(2);
    expect(j13Entries.map((j) => j.id).sort()).toEqual(['J13:generate', 'J13:render']);
    // Neither entry absorbed the other into previousAttempts — each is its
    // own independent record, not treated as a superseded retry.
    for (const entry of j13Entries) {
      expect(entry.previousAttempts).toBeUndefined();
    }
  });

  it('a genuine same-test retry (same title AND same journey-subid, retry > 0) still merges into previousAttempts as designed', async () => {
    const id = computeJourneyId(GENERATE_TITLE, 'generate');

    // Attempt 0 fails, Playwright retries, attempt 1 (same test, same
    // subId) passes — this is the real retry shape appendJourneyRecord's
    // id-keyed merge exists to preserve.
    await appendJourneyRecord(makeRecord({ id, title: GENERATE_TITLE, verdict: 'FAIL', retry: 0 }));
    await appendJourneyRecord(makeRecord({ id, title: GENERATE_TITLE, verdict: 'PASS', retry: 1 }));

    const manifest = await readManifest();
    const entries = manifest.journeys.filter((j) => j.id === id);

    expect(entries).toHaveLength(1);
    const [surviving] = entries;
    expect(surviving.verdict).toBe('PASS');
    expect(surviving.retry).toBe(1);
    expect(surviving.previousAttempts).toHaveLength(1);
    expect(surviving.previousAttempts?.[0]).toMatchObject({ verdict: 'FAIL', retry: 0 });
  });
});

describe('operation evidence across navigation', () => {
  it('preserves pre-reload errors and distinguishes reused IDs after reload', () => {
    const page = { on: vi.fn() } as unknown as Page;
    const evidence = new EvidenceCollector(page, 'J16', 'reload');
    const entry = {
      panel: 'output' as const,
      sourceId: 1,
      opId: 1,
      ts: 1,
      op: 'toast',
      level: 'error' as const,
      message: 'cancelled before reload',
      durationMs: 12
    };
    evidence.recordOpLog([entry]);
    evidence.recordOpLog([entry]);
    evidence.markNavigation();
    evidence.recordOpLog([{ ...entry, message: 'cancelled before reload' }]);
    expect(evidence.opLog).toEqual([
      { ...entry, navigationGeneration: 0 },
      { ...entry, navigationGeneration: 1 }
    ]);
  });
});
