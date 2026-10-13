// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../helpers/source-editor.js';
import { Buffer } from 'node:buffer';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { EvidenceCollector, appendJourneyRecord, type JourneyRecord } from './evidence.js';
import { exceedsBudget } from './timings.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';

interface CheckoutFixtures {
  evidence: EvidenceCollector;
}

/**
 * Derives the manifest `id` a journey's evidence is filed under.
 *
 * `group` is the leading `J<n>[a-z]?` prefix shared by every test in a
 * journey's spec file (e.g. all of J13's tests start with `J13`). Most
 * journey spec files have exactly one test per group, so the bare group is
 * the id (J0 through J11, J18 — completely unaffected by `subId`).
 *
 * A handful of spec files (J13, J14, J16) have MULTIPLE tests sharing one
 * group. Without disambiguation, `appendJourneyRecord`'s id-keyed merge (see
 * evidence.ts) treats the second test's record as a RETRY of the first —
 * silently folding a genuinely different test into `previousAttempts` and
 * losing its own manifest entry. `subId` (sourced from each test's
 * `journey-subid` annotation) appends `:${subId}` to the group so each test
 * gets its own stable, distinct manifest id. A real retry of the SAME test
 * carries the SAME title and the SAME `journey-subid` annotation on every
 * attempt, so `computeJourneyId` still returns the same id across retries —
 * the merge-into-previousAttempts behavior for genuine retries is preserved.
 */
export function computeJourneyId(title: string, subId?: string): string {
  const group = title.match(/^(J\d+[a-z]?)/)?.[1] ?? title;
  return subId ? `${group}:${subId}` : group;
}

export const checkout = base.extend<CheckoutFixtures>({
  evidence: async ({ page }, use, testInfo) => {
    const subId = testInfo.annotations.find((a) => a.type === 'journey-subid')?.description;
    const journeyId = computeJourneyId(testInfo.title, subId);
    const collector = new EvidenceCollector(page, journeyId, testInfo.title, testInfo.retry);
    await use(collector);
    // testInfo.expectedStatus is 'skipped' for any test.skip()'d test, so a
    // naive status===expectedStatus comparison treats every skip as a match
    // and reports it PASS — silently green, exactly what spec §4's verdict
    // semantics forbid for a genuinely blocked prerequisite (e.g. J0a with no
    // CLOUDFLARE_API_TOKEN/ACCOUNT_ID). A dynamic test.skip() call *inside* a
    // test body still runs this fixture's teardown (only a describe-level
    // test.skip() bypasses fixtures entirely), so 'skipped' must be mapped to
    // BLOCKED explicitly here rather than falling through the PASS/FAIL check.
    const baseVerdict: JourneyRecord['verdict'] =
      testInfo.status === 'skipped' ? 'BLOCKED' : testInfo.status === testInfo.expectedStatus ? 'PASS' : 'FAIL';
    // Merge BEFORE computing the verdict — not after — so a budget
    // violation captured pre-reload (via captureOpLogSnapshot, currently
    // J8) is visible to exceedsBudget here too, not just to whatever ends
    // up in the persisted record. Checking only this fresh post-test read
    // (which for a journey that reloads only reflects entries from AFTER
    // the reload) could mark a journey PASS while its own manifest opLog
    // shows a budget-exceeding entry.
    collector.recordOpLog(await readCombinedOpLog(page));
    const degraded = collector.hasSoftFindings || exceedsBudget(collector.opLog);
    const verdict = baseVerdict === 'PASS' && degraded ? 'DEGRADED' : baseVerdict;
    const record: JourneyRecord = await collector.finish(verdict);
    await appendJourneyRecord(record);
  }
});

export { expect };

export interface OpLogEntry {
  opId?: number;
  op: string;
  subject?: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  durationMs?: number;
  ts: number;
  panel: 'output' | 'activity' | 'perf';
  /** See op-log.ts's OpLogEntry.sourceId doc comment — the source store's own unique id, used as EvidenceCollector.recordOpLog's real dedup identity. */
  sourceId: number;
}

// Playwright's page.evaluate callback type-checks against the DOM lib's own
// Window type, which does NOT see apps/studio/src's `declare global`
// augmentation (op-log-window-bridge.ts) — that augmentation only merges
// into programs that include the src file. Re-declare it locally so this
// fixture module type-checks standalone.
declare global {
  interface Window {
    __runeStudioOpLog?: { snapshot(): OpLogEntry[] };
  }
}

/** Reads window.__runeStudioOpLog.snapshot() from the page — installed by op-log-window-bridge.ts (Task 4). */
export async function readOpLog(page: Page): Promise<OpLogEntry[]> {
  return page.evaluate(() => window.__runeStudioOpLog?.snapshot() ?? []);
}

/**
 * Reads BOTH readOpLog (Activity/Output panels) and readPerfLog
 * (perf-log.ts — deliberately not panel-rendered) and merges them into one
 * manifest-shaped list, so a journey's persisted `opLog` still captures
 * real wall-clock timing for high-frequency ops even though they're kept
 * out of the user-visible panels.
 *
 * `page.reload()` tears down the page's JS context, wiping BOTH stores'
 * in-memory state — a journey that reloads (J8, J02, J16, ...) must call
 * `captureOpLogSnapshot` BEFORE reloading if it wants pre-reload entries
 * to survive into the manifest; reading only after the fact (as the
 * `checkout` fixture's teardown does, for journeys that never reload) will
 * see an empty/reset log for anything that happened pre-reload.
 */
export async function readCombinedOpLog(page: Page): Promise<OpLogEntry[]> {
  const [opLog, perfLog] = await Promise.all([readOpLog(page), readPerfLog(page)]);
  const fromPerf: OpLogEntry[] = perfLog.map((entry) => ({
    opId: entry.opId,
    op: entry.op,
    subject: entry.subject,
    level: entry.ok ? 'success' : 'error',
    message: `${entry.op} ${entry.ok ? 'completed' : 'failed'}`,
    durationMs: entry.durationMs,
    ts: entry.ts,
    panel: 'perf',
    // perf-log.ts's opId is already unique per entry (allocateOpId() at
    // the start of each operation instance), so it doubles as sourceId
    // here — no separate counter needed for this panel.
    sourceId: entry.opId
  }));
  return [...opLog, ...fromPerf].sort((a, b) => a.ts - b.ts);
}

/**
 * Reads the current combined op-log (see `readCombinedOpLog`) and folds it
 * into `evidence`'s accumulator (`EvidenceCollector.recordOpLog`), which
 * survives a subsequent `page.reload()` because it lives in the Node/
 * Playwright process, not the page. Call this immediately before any
 * `page.reload()` in a journey that wants its pre-reload op-log/perf-log
 * entries (e.g. a `workspaceSave`/`reparse` this journey just waited on)
 * to actually reach the persisted manifest.
 */
export async function captureOpLogSnapshot(page: Page, evidence: EvidenceCollector): Promise<void> {
  evidence.recordOpLog(await readCombinedOpLog(page));
}

/**
 * High-frequency operation timing (a debounced reparse, a workspace
 * autosave) that perf-log.ts deliberately keeps OUT of the Activity/Output
 * panels — and therefore out of `readOpLog` above too — to avoid flooding
 * them with a row per keystroke. Mirrors perf-log.ts's PerfLogEntry.
 */
export interface PerfLogEntry {
  op: string;
  subject?: string;
  ok: boolean;
  durationMs: number;
  ts: number;
  opId: number;
}

declare global {
  interface Window {
    __runeStudioPerfLog?: {
      snapshot(): PerfLogEntry[];
      lastStartedOpId(op: string): number | undefined;
    };
  }
}

/** Reads window.__runeStudioPerfLog.snapshot() from the page — installed by perf-log-window-bridge.ts. */
export async function readPerfLog(page: Page): Promise<PerfLogEntry[]> {
  return page.evaluate(() => window.__runeStudioPerfLog?.snapshot() ?? []);
}

/**
 * The opId most recently allocated for `op` (perf-log.ts's
 * `recordPerfStart`, called synchronously the moment the operation
 * starts, before any await). Read this right after triggering an edit to
 * learn exactly which operation instance it started, then wait for that
 * SPECIFIC opId to complete via `waitForPerfLogOpId` — the only race-free
 * way to correlate a specific edit to a specific completion when multiple
 * instances of the same op (e.g. several `workspaceSave` calls from rapid
 * edits) can be in flight and complete out of order. A timestamp- or
 * count-based wait can't tell an unrelated straggler's completion apart
 * from the one actually being waited on — found the hard way: an earlier
 * "wait for quiescence" (no new entry for a short interval) still raced,
 * because a lull before the NEXT completion looks identical to "nothing
 * more is coming."
 */
export async function lastStartedPerfOpId(page: Page, op: string): Promise<number | undefined> {
  return page.evaluate((opArg) => window.__runeStudioPerfLog?.lastStartedOpId(opArg), op);
}

/**
 * Polls until `lastStartedPerfOpId(page, op)` differs from `previousOpId`,
 * returning the new opId. Use when the triggering interaction (e.g. a
 * `.click()`) might resolve before the resulting React state update has
 * flushed through to the op-starting code, so reading
 * `lastStartedPerfOpId` immediately afterward could still see the OLD
 * value.
 */
export async function waitForPerfLogStart(
  page: Page,
  op: string,
  previousOpId: number | undefined,
  options: { timeout?: number } = {}
): Promise<number> {
  const { timeout = 5000 } = options;
  const deadline = Date.now() + timeout;
  for (;;) {
    const current = await lastStartedPerfOpId(page, op);
    if (current !== undefined && current !== previousOpId) return current;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeout}ms waiting for a new perf-log op="${op}" to start (previous opId=${previousOpId})`
      );
    }
    await page.waitForTimeout(20);
  }
}

/**
 * Polls window.__runeStudioPerfLog for the completed entry with this
 * EXACT `op` + `opId` (from `lastStartedPerfOpId`/`waitForPerfLogStart`),
 * returning it (with real `durationMs`) as soon as it appears — instead
 * of a fixed `waitForTimeout` standing in for an operation with no
 * otherwise-observable completion signal (a debounced reparse, a
 * fire-and-forget workspace save).
 */
export async function waitForPerfLogOpId(
  page: Page,
  op: string,
  opId: number,
  options: { timeout?: number } = {}
): Promise<PerfLogEntry> {
  const { timeout = 10000 } = options;
  const deadline = Date.now() + timeout;
  for (;;) {
    const entries = await readPerfLog(page);
    const match = entries.find((e) => e.op === op && e.opId === opId);
    if (match) return match;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeout}ms waiting for perf-log op="${op}" opId=${opId} to complete`);
    }
    await page.waitForTimeout(50);
  }
}

export const CDM_BUTTON = 'CDM (Common Domain Model)';
const WORKSPACE_FILE_NAME = 'starter.rosetta';
const WORKSPACE_FILE_CONTENT = 'namespace example\n';

/** Ported verbatim from test/prod-smoke/production-checkout.spec.ts's loadCdm helper. */
export async function loadCdm(page: Page, evidence?: EvidenceCollector): Promise<void> {
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveTitle(/Rune Studio/);
  await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });

  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles([
    { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
  ]);
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
  if (process.env.ENABLE_TELEMETRY === '1') await enableCheckoutTelemetry(page);
  await page.getByTestId('rail-workspaces').click();
  await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });

  const startedAt = Date.now();
  await page.getByTestId('model-loader').getByRole('button', { name: CDM_BUTTON }).click();

  await expect(page.getByText('Loaded Models', { exact: false })).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: `Unload ${CDM_BUTTON}` })).toBeVisible({ timeout: 90000 });
  evidence?.recordTiming('modelLoad', 'cdm loaded in UI', Date.now() - startedAt);
}

export async function enableCheckoutTelemetry(page: Page): Promise<void> {
  await page.getByTestId('rail-settings').click();
  const toggle = page.getByTestId('settings-telemetry-toggle');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

export interface ScratchAttributeSpec {
  name: string;
  typeName: string;
  /** e.g. '(1..1)', '(0..*)' — parens included, matches raw Rune DSL syntax. */
  cardinality: string;
}

export interface ScratchTypeSpec {
  name: string;
  namespace: string;
  attributes: ScratchAttributeSpec[];
  /**
   * Additional raw Rune DSL declarations (each a full `type`/`enum`/
   * `choice` block, trailing newline included) authored in the SAME Source
   * block immediately after the primary `type <name>:` declaration. Lets a
   * root type reference not-yet-defined sibling types via forward
   * reference within one namespace — used by J18's closure fixture, which
   * needs a nested Data type, an Enum, and a Choice declared alongside the
   * root in a single scratch workspace. Optional; every existing caller
   * (J8, J9) is unaffected.
   */
  extraDeclarations?: string[];
}

/**
 * Reaches a blank scratch workspace and a cleared, focused Source editor,
 * ready for paced typing. Shared by `authorScratchType` and
 * `authorScratchFunction` below — both author a top-level declaration via
 * raw Rune DSL typing (this app has no graphical "create type"/"create
 * function" UI; see `authorScratchType`'s own doc comment for the type
 * side of that finding), so the reach-workspace + open-Source + select-all
 * + delete boilerplate is centralized here rather than duplicated per
 * declaration kind (DRY).
 *
 * Reaches a blank workspace via the same file-input flow J02/J07 already
 * use (a fresh Playwright page gets its own OPFS/IndexedDB origin, so this
 * always starts from an empty workspace on the FIRST call in a test).
 *
 * A later call in the SAME test — e.g. J9's curated-then-scratch function
 * journey, which calls `loadCdm(page)` before `authorScratchFunction(page)`
 * — is a different case: `page.goto('./')` reopens whatever workspace is
 * already active instead of showing the fresh model-loader screen the file
 * input below expects (confirmed live against production this session).
 * Force it via the same `rail-workspaces` round trip `loadCdm` itself
 * already uses to get FROM a freshly-created workspace BACK to the loader
 * screen — but only when needed, since that testid doesn't exist yet on a
 * truly first-ever page load (the model-loader renders standalone, with no
 * rail chrome, until a workspace exists).
 */
async function reachBlankScratchSource(page: Page): Promise<Locator> {
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  const modelLoader = page.getByTestId('model-loader');
  if (!(await modelLoader.isVisible().catch(() => false))) {
    await page.getByTestId('rail-workspaces').click();
  }
  await expect(modelLoader).toBeVisible({ timeout: 20000 });

  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles([
    { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
  ]);
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Source' }).click();
  const editor = fullSourceEditor(page).locator('.cm-content');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.click();

  const platformModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${platformModifier}+A`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);

  return editor;
}

/**
 * Authors a new Data type in a fresh scratch workspace by typing raw Rune
 * DSL into the Source editor and waiting for the app's debounced reparse to
 * pick it up.
 *
 * This app has no graphical "create type" UI — `TypeCreator.tsx` and
 * `editor-store.ts`'s `createType` action are fully implemented but have
 * zero JSX call sites anywhere in the app (confirmed via full-tree search).
 * Every other e2e test that involves a "new" type loads a pre-written
 * `.rosetta` file and edits *existing* nodes graphically. This helper is
 * deliberately the ONE place that authors a type via live Source-pane
 * typing — J8, J9, and J18 all import it rather than re-deriving the same
 * setup (DRY; see the Phase 2 plan's Task 2 design note).
 *
 * Typing is deliberately PACED — a per-keystroke delay plus a short wait
 * after each line — rather than one bulk write. A fast/instant bulk write
 * can race the workspace's debounced OPFS save (a remove+recreate of the
 * underlying file), truncating the persisted content; pacing the input
 * avoids that race. See task-2-report.md's OPFS-save-race finding.
 */
export async function authorScratchType(page: Page, spec: ScratchTypeSpec): Promise<void> {
  const editor = await reachBlankScratchSource(page);

  await editor.pressSequentially(`namespace ${spec.namespace}\n`, { delay: 20 });
  await page.waitForTimeout(800);
  await editor.pressSequentially(`\ntype ${spec.name}:\n`, { delay: 20 });
  await page.waitForTimeout(800);
  for (const attribute of spec.attributes) {
    await editor.pressSequentially(`    ${attribute.name} ${attribute.typeName} ${attribute.cardinality}\n`, {
      delay: 20
    });
    await page.waitForTimeout(800);
  }
  for (const declaration of spec.extraDeclarations ?? []) {
    await editor.pressSequentially(`\n${declaration}`, { delay: 20 });
    await page.waitForTimeout(800);
  }

  const namespaceSearch = page.getByTestId('namespace-search');
  await namespaceSearch.fill(spec.name);
  await expect(typeNavigationButton(page, `${spec.namespace}.${spec.name}`)).toBeVisible({ timeout: 15000 });
}

export interface ScratchFunctionInputSpec {
  name: string;
  typeName: string;
  /** e.g. '(1..1)' — parens included, matches raw Rune DSL syntax. */
  cardinality: string;
}

export interface ScratchFunctionSpec {
  name: string;
  namespace: string;
  inputs: ScratchFunctionInputSpec[];
  outputName: string;
  outputType: string;
  /** e.g. '(1..1)' — parens included, matches raw Rune DSL syntax. */
  outputCardinality: string;
  /**
   * Raw Rune expression assigned via `set <outputName>: <body>`. Keep this
   * free of `if`/`then`/`else` — the studio's client-side function-execution
   * engine (`codegen-worker.ts`'s `stripTypeAnnotations` + `new Function()`
   * wrapper) cannot currently evaluate a generated ternary from a Rune
   * conditional expression (confirmed live this session: even the curated
   * `cdm.base.math.Max`/`Min`/`Abs` functions, which ARE all `if a > b then
   * a else b`-shaped, fail Run with "Error: Unexpected token 'if'"). Plain
   * arithmetic/comparison bodies (e.g. `x * 2`) execute correctly.
   */
  body: string;
  /**
   * Optional `condition <name>: <expression>` block, authored between
   * `output:` and `set <outputName>: ...` — matches the grammar's own
   * declaration order (`inputs`, `output`, `shortcuts`, `conditions`,
   * `operations`; confirmed against `RosettaFunction` in
   * packages/core/src/grammar/rune-dsl.langium and the real
   * `packages/codegen/test/fixtures/funcs/precondition-alias/input.rune`
   * fixture). Added for J10 (Task 4) — LanguageLensEditor is mounted as a
   * function's condition expression editor, so J10 needs a scratch
   * function with a condition, not just a body.
   *
   * Keep `expression` inside the language lens's subset S
   * (ComparisonOperation/EqualityOperation/LogicalOperation/
   * ArithmeticOperation/RosettaExistsExpression/RosettaAbsentExpression/
   * RosettaFeatureCall — see packages/codegen/src/lens/subset.ts) or the
   * TypeScript/Python lens falls back to the "can't be shown in {Language}"
   * read-only state instead of rendering a textbox. A plain comparison like
   * `amount > 0` is in-subset and round-trips (confirmed live this session
   * against production).
   */
  condition?: {
    name: string;
    expression: string;
  };
}

/**
 * Authors a new Function declaration in a fresh scratch workspace, by the
 * SAME Source-pane-typing mechanism `authorScratchType` uses above — this
 * app has no graphical "create function" UI either (same constraint,
 * confirmed the same way). Shares `reachBlankScratchSource` with
 * `authorScratchType` rather than re-deriving the reach-workspace +
 * open-Source + paced-typing setup (DRY; see the Phase 2 plan's Task 3
 * design note — J9 is the only journey that needs to author a function).
 */
export async function authorScratchFunction(page: Page, spec: ScratchFunctionSpec): Promise<void> {
  const editor = await reachBlankScratchSource(page);

  await editor.pressSequentially(`namespace ${spec.namespace}\n`, { delay: 20 });
  await page.waitForTimeout(800);
  await editor.pressSequentially(`\nfunc ${spec.name}:\n`, { delay: 20 });
  await page.waitForTimeout(800);
  await editor.pressSequentially(`    inputs:\n`, { delay: 20 });
  await page.waitForTimeout(800);
  for (const input of spec.inputs) {
    await editor.pressSequentially(`        ${input.name} ${input.typeName} ${input.cardinality}\n`, { delay: 20 });
    await page.waitForTimeout(800);
  }
  await editor.pressSequentially(`    output:\n`, { delay: 20 });
  await page.waitForTimeout(800);
  await editor.pressSequentially(`        ${spec.outputName} ${spec.outputType} ${spec.outputCardinality}\n`, {
    delay: 20
  });
  await page.waitForTimeout(800);
  if (spec.condition) {
    await editor.pressSequentially(`\n    condition ${spec.condition.name}:\n`, { delay: 20 });
    await page.waitForTimeout(800);
    await editor.pressSequentially(`        ${spec.condition.expression}\n`, { delay: 20 });
    await page.waitForTimeout(800);
  }
  await editor.pressSequentially(`    set ${spec.outputName}: ${spec.body}\n`, { delay: 20 });
  await page.waitForTimeout(800);

  const namespaceSearch = page.getByTestId('namespace-search');
  await namespaceSearch.fill(spec.name);
  await expect(typeNavigationButton(page, `${spec.namespace}.${spec.name}`, 'RosettaFunction')).toBeVisible({
    timeout: 15000
  });
}
