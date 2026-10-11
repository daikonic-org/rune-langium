// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  checkout as test,
  expect,
  authorScratchType,
  lastStartedPerfOpId,
  waitForPerfLogStart,
  waitForPerfLogOpId,
  captureOpLogSnapshot,
  readPerfLog
} from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import type { Page } from '@playwright/test';

/**
 * The center-pane tab bar (Graph/Structure/Source/Inspector) is a
 * multi-select toggle, not a radio group — clicking an already-active tab
 * CLOSES it instead of being a no-op (confirmed this session, both via
 * manual claude-in-chrome testing and this exact Playwright flow). By the
 * time this journey wants Source open a second time, it's typically already
 * open (authorScratchType opened it first and nothing since has closed it),
 * so a second unconditional click would toggle it off. Only click when it
 * isn't already visible.
 */
async function ensureSourcePaneOpen(page: Page): Promise<void> {
  const sourceEditor = page.getByTestId('source-editor');
  if (await sourceEditor.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Source' }).click();
  await expect(sourceEditor).toBeVisible({ timeout: 10000 });
}

const NAMESPACE = 'scratch.j8';
const TYPE_NAME = 'ScratchOrder';
const RENAMED_TYPE_NAME = 'ScratchOrderRenamed';
const NODE_ID = `${NAMESPACE}.${TYPE_NAME}`;

test.describe('J8 — Edit round-trip (workspace file only, never curated)', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J8 create, add attribute, set cardinality, rename and reload persists', async ({ page, evidence }) => {
    // Author a type entirely via Source-pane typing (this app has no
    // graphical "create type" UI) — reaches a fresh scratch workspace and
    // waits for the debounced reparse to make the type navigable.
    await authorScratchType(page, {
      name: TYPE_NAME,
      namespace: NAMESPACE,
      attributes: [{ name: 'quantity', typeName: 'number', cardinality: '(1..1)' }]
    });
    await evidence.checkpoint('type-created');
    expect(
      (await readPerfLog(page)).filter((entry) => entry.op === 'workspaceSave').length,
      'source typing should produce bounded autosaves, not a save per keystroke'
    ).toBeLessThanOrEqual(8);

    // Regression target: fix(core) 282dcebe stamps $cstRange from
    // $textRegion when $cstNode is absent, so a graphical edit on a
    // Source-typed node patches the existing declaration in place instead
    // of silently appending a duplicate `type X:` block. Open the created
    // node's Inspector (a 3-way split alongside Structure/Source, not a
    // separate view) via the nav-arrow testid, matching J04's pattern.
    await typeNavigationButton(page, NODE_ID).click();
    await page.getByRole('button', { name: 'Inspector' }).click();
    // TypeHeader renders the editable name as an <Input data-slot="type-name-input">
    // (aria-label "Data type name"), not a heading — the heading role only
    // appears in read-only mode (not applicable here) and in the unrelated
    // Form-preview panel on the far right.
    const nameInput = page.locator('[data-slot="type-name-input"]');
    await expect(nameInput).toHaveValue(TYPE_NAME, { timeout: 10000 });

    // Add an attribute via the graphical form (DataTypeForm.tsx). A fresh
    // row gets an empty name (makeAttributeAstItem('', 'string', '(1..1)'));
    // fill it in via AttributeRow.tsx's data-slot markers.
    //
    // VERIFIED (this session, against the deployed instance): the
    // add-attribute click on its own does NOT trigger a workspaceSave — an
    // earlier version of this comment claimed it did (an unverified
    // assumption from PR review that this journey's own live-instance run
    // was supposed to catch, and did). Polled the perf-log for 15s straight
    // after the click with nothing happening: `useModelSourceSync` renders
    // an attribute with an empty name as producing no source-text change
    // (an unnamed attribute can't serialize to valid Rune DSL), so its
    // no-op/byte-identical skip suppresses the `onModelChanged` emission
    // entirely — no `files` change, so `handleFilesChange` never fires.
    // The row is still visible locally because the Inspector's list comes
    // straight from `useFieldArray`'s store-backed `fields`, independent of
    // the source round-trip — so the click itself needs no baseline/wait at
    // all.
    await page.locator('[data-slot="add-attribute-btn"]').click();
    const newRow = page.locator('[data-slot="attribute-row"]').last();

    // Attribute name commits via a 500ms debounce (AttributeRow's
    // useAutoSave(commitName, 500)) — the first edit in this sequence that
    // actually reaches `files`/workspaceSave. Baseline captured immediately
    // before the fill (review finding, PR #430): capturing it any earlier
    // (e.g. before the click above) widens the window during which some
    // unrelated save could start and be mistaken for this one, even though
    // nothing is expected to fire in that window — the same "don't rely on
    // what's merely expected" rigor that motivated opId correlation in the
    // first place. Drain it (start AND complete) so the cardinality-set
    // baseline below starts from a save-free point, which opId correlation
    // needs.
    const opIdBeforeAttributeName = await lastStartedPerfOpId(page, 'workspaceSave');
    await newRow.locator('[data-slot="attribute-name"]').fill('notes');
    const attributeSaveOpId = await waitForPerfLogStart(page, 'workspaceSave', opIdBeforeAttributeName);
    await waitForPerfLogOpId(page, 'workspaceSave', attributeSaveOpId);
    await evidence.checkpoint('attribute-added');

    // Set cardinality via CardinalityPicker — trigger + role="option"
    // preset (commits immediately, no debounce). Safe to capture the
    // baseline right before this click now: the attribute-name edit's own
    // save is fully drained above, so no unrelated in-flight/pending save
    // can be mistaken for this one.
    const opIdBeforeCardinalitySet = await lastStartedPerfOpId(page, 'workspaceSave');
    await newRow.locator('[data-slot="cardinality-picker"]').click();
    await page.getByRole('option', { name: '0..*' }).click();
    const targetSaveOpId = await waitForPerfLogStart(page, 'workspaceSave', opIdBeforeCardinalitySet);
    await evidence.checkpoint('cardinality-set');

    await waitForPerfLogOpId(page, 'workspaceSave', targetSaveOpId);
    await expect(page.locator('[data-slot="attribute-row"]')).toHaveCount(2);
    const opIdBeforeRename = await lastStartedPerfOpId(page, 'workspaceSave');
    await nameInput.fill(RENAMED_TYPE_NAME);
    const renameSaveOpId = await waitForPerfLogStart(page, 'workspaceSave', opIdBeforeRename);
    await waitForPerfLogOpId(page, 'workspaceSave', renameSaveOpId);
    await expect(nameInput).toHaveValue(RENAMED_TYPE_NAME);
    await evidence.checkpoint('renamed');

    await ensureSourcePaneOpen(page);
    const preReloadSource = page.getByTestId('source-editor').locator('.cm-content');
    await expect(preReloadSource).toContainText(`type ${RENAMED_TYPE_NAME}:`, { timeout: 10000 });
    // Same generous timeout as the assertion above, not Playwright's 5000ms
    // default — both depend on the identical reparse/render pipeline, and a
    // production run flaked here once on a slow first navigation while the
    // default window elapsed a few hundred ms too early.
    await expect(preReloadSource).toContainText('notes', { timeout: 10000 });
    await expect(preReloadSource).not.toContainText(`type ${TYPE_NAME}:`);

    // Regression isolation: prove the $cstRange fix holds immediately after
    // add-attribute + cardinality-set, not just after reload — the manual
    // repro that motivated commit 282dcebe showed the duplicate `type X:`
    // declaration appearing live, before any reload.
    const preReloadSourceText = (await preReloadSource.textContent()) ?? '';
    const preReloadDeclarationMatches = preReloadSourceText.match(new RegExp(`type ${RENAMED_TYPE_NAME}:`, 'g')) ?? [];
    expect(
      preReloadDeclarationMatches,
      'expected one renamed declaration after structural edits, before reload'
    ).toHaveLength(1);

    // page.reload() below tears down the page's JS context, wiping
    // perf-log.ts's in-memory entries (including the workspaceSave/reparse
    // completions just waited on) along with it — capture them into
    // evidence's accumulator first so they still reach the manifest; a
    // fresh readOpLog/readPerfLog call after the reload would see them
    // gone.
    await captureOpLogSnapshot(page, evidence);

    // The renamed declaration and structural edits must survive workspace persistence.
    await page.reload();
    // markNavigation() right after reload, not before — evidence.opLog's
    // dedup key needs everything captured above (captureOpLogSnapshot) to
    // stay in the PREVIOUS generation, and only entries read from this
    // point on (the fixture teardown's final recordOpLog call) to fall
    // into the new one. See EvidenceCollector.markNavigation's doc comment.
    evidence.markNavigation();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill(RENAMED_TYPE_NAME);
    await expect(typeNavigationButton(page, `${NAMESPACE}.${RENAMED_TYPE_NAME}`)).toBeVisible({ timeout: 15000 });
    await evidence.checkpoint('reloaded-persisted');

    await typeNavigationButton(page, `${NAMESPACE}.${RENAMED_TYPE_NAME}`).click();
    await ensureSourcePaneOpen(page);
    const sourceEditor = page.getByTestId('source-editor').locator('.cm-content');
    await expect(sourceEditor).toBeVisible({ timeout: 10000 });
    await expect(sourceEditor).toContainText(`type ${RENAMED_TYPE_NAME}:`);
    await expect(sourceEditor).toContainText('notes');
    // The cardinality-set edit specifically — not just that 'notes' exists,
    // but that its cardinality change also survived the reload. Previously
    // unchecked here (only asserted pre-reload's own toContainText('notes')
    // above ever ran), so a lost cardinality-set save would have silently
    // passed.
    await expect(sourceEditor).toContainText('(0..*)');

    const sourceText = (await sourceEditor.textContent()) ?? '';
    expect(sourceText.match(/\bnotes\b/g)).toHaveLength(1);
    const declarationMatches = sourceText.match(new RegExp(`type ${RENAMED_TYPE_NAME}:`, 'g')) ?? [];
    expect(declarationMatches).toHaveLength(1);
    await evidence.checkpoint('source-sync-verified');
  });
});
