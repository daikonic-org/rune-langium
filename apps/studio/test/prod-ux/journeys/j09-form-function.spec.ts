// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, loadCdm, authorScratchType, authorScratchFunction, readOpLog } from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import { ANCHOR_DATA, ANCHOR_FUNCTION } from '../anchors.js';

test.describe('J9 — Form preview & function execution', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J9 form preview + validation for curated and scratch data types',
    { annotation: { type: 'journey-subid', description: 'form-preview' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await page.getByTestId('rail-explore').click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

      const namespaceSearch = page.getByTestId('namespace-search');
      await namespaceSearch.fill('BusinessCenters');
      const curatedFormStartedAt = Date.now();
      await typeNavigationButton(page, ANCHOR_DATA).click();
      const formPanel = page.getByTestId('panel-formPreview');
      await expect(formPanel.getByRole('heading', { name: 'BusinessCenters' })).toBeVisible({ timeout: 30_000 });
      await expect(formPanel.getByText('Generating preview', { exact: false })).toHaveCount(0);
      const curatedFormRenderMs = Date.now() - curatedFormStartedAt;
      evidence.recordTiming('formRender', ANCHOR_DATA, curatedFormRenderMs);
      await evidence.checkpoint('curated-form-preview');

      // Generated Zod accepts empty strings; a fractional int is structurally invalid.
      await authorScratchType(page, {
        name: 'ScratchWidget',
        namespace: 'scratch.j9form',
        attributes: [{ name: 'quantity', typeName: 'int', cardinality: '(1..1)' }]
      });
      const scratchFormStartedAt = Date.now();
      await typeNavigationButton(page, 'scratch.j9form.ScratchWidget').click();
      const quantityField = formPanel.getByLabel('Quantity', { exact: true });
      await expect(quantityField).toBeVisible({ timeout: 20_000 });
      const scratchFormRenderMs = Date.now() - scratchFormStartedAt;
      evidence.recordTiming('formRender', 'ScratchWidget', scratchFormRenderMs);

      await quantityField.fill('1.5');
      await quantityField.blur();
      const alert = formPanel.locator('p.text-destructive[role="alert"]');
      await expect(alert).toBeVisible({ timeout: 10_000 });
      await expect(alert).toContainText(/integer|int/i);
      await expect(formPanel.getByText('Invalid sample', { exact: false })).toBeVisible();
      await evidence.checkpoint('scratch-form-invalid');

      await quantityField.fill('2');
      await quantityField.blur();
      // This summary is shown only after the latest worker validation completes.
      await expect(formPanel.getByText('Valid sample', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(alert).toHaveCount(0);
      await evidence.checkpoint('scratch-form-preview');

      if (curatedFormRenderMs > 5000 || scratchFormRenderMs > 5000) {
        evidence.softFinding(
          'formRender-budget',
          `formRender took ${Math.max(curatedFormRenderMs, scratchFormRenderMs)}ms`
        );
      }
    }
  );

  test(
    'J9 executes a curated corpus function and a scratch-authored function',
    { annotation: { type: 'journey-subid', description: 'function-execution' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await page.getByTestId('rail-explore').click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

      // Navigate to ANCHOR_FUNCTION (cdm.base.math.StringEquals). Selecting a
      // function node opens Form preview directly into FormPreviewPanel.tsx's
      // `schema.kind === 'function'` execution branch — no separate "Form" tab
      // click needed (confirmed this session: it's already the active
      // sub-tab).
      const namespaceSearch = page.getByTestId('namespace-search');
      await namespaceSearch.fill('StringEquals');
      await typeNavigationButton(page, ANCHOR_FUNCTION, 'RosettaFunction').click();
      await expect(page.getByTestId('panel-formPreview')).toBeVisible({ timeout: 20000 });

      // `exact: true` — Playwright's getByLabel does substring, case-
      // insensitive matching by default, and a bare 'S1'/'S2'/'X' would also
      // match unrelated chrome (e.g. the "Export code" button's aria-label
      // contains an 'x'; confirmed live this session).
      await page.getByLabel('S1', { exact: true }).fill('hello');
      await page.getByLabel('S2', { exact: true }).fill('hello');
      const executionStartedAt = Date.now();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      // The function-execution output and the (unrelated) "Sample data"
      // preview share the SAME class, `preview-panel__sample-output`
      // (FormPreviewPanel.tsx — the execution-result `<pre>` and the
      // sample-data-output `<pre>` both carry it) — scope to the
      // execution-result wrapper to avoid a Playwright strict-mode violation
      // matching both elements.
      const curatedOutput = page.locator('.execution-result .preview-panel__sample-output');
      await expect(curatedOutput).toBeVisible({ timeout: 20000 });
      await expect(curatedOutput).toHaveText('true');
      evidence.recordTiming('functionExecute', ANCHOR_FUNCTION, Date.now() - executionStartedAt);
      await evidence.checkpoint('curated-function-executed');

      // Author a scratch function via Source-pane typing (same no-graphical-
      // creation constraint as types — see authorScratchFunction's doc note).
      // Double(x) = x * 2; deliberately avoids if/then/else (see
      // authorScratchFunction's ScratchFunctionSpec.body doc note on the
      // execution-engine gap discovered this session).
      await authorScratchFunction(page, {
        name: 'Double',
        namespace: 'scratch.j9func',
        inputs: [{ name: 'x', typeName: 'number', cardinality: '(1..1)' }],
        outputName: 'result',
        outputType: 'number',
        outputCardinality: '(1..1)',
        body: 'x * 2'
      });
      // authorScratchFunction only asserts the nav row is visible — the
      // caller navigates into it (same pattern as authorScratchType above).
      await typeNavigationButton(page, 'scratch.j9func.Double', 'RosettaFunction').click();
      await expect(page.getByTestId('panel-formPreview')).toBeVisible({ timeout: 20000 });
      // `exact: true` — see the S1/S2 comment above; a bare 'X' also matches
      // unrelated chrome.
      await page.getByLabel('X', { exact: true }).fill('5');
      const scratchExecutionStartedAt = Date.now();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      const scratchOutput = page.locator('.execution-result .preview-panel__sample-output');
      await expect(scratchOutput).toBeVisible({ timeout: 20000 });
      await expect(scratchOutput).toHaveText('10');
      evidence.recordTiming('functionExecute', 'scratch.j9func.Double', Date.now() - scratchExecutionStartedAt);
      await evidence.checkpoint('scratch-function-executed');

      const opLog = await readOpLog(page);
      const executeEntries = opLog.filter((e) => e.op === 'functionExecute');
      expect(executeEntries.length, 'expected functionExecute op-log entries (Task 1 instrumentation)').toBeGreaterThan(
        0
      );

      const slowExecutions = executeEntries.filter((e) => (e.durationMs ?? 0) > 5000);
      if (slowExecutions.length > 0) {
        evidence.softFinding(
          'functionExecute-budget',
          `functionExecute took ${Math.max(...slowExecutions.map((e) => e.durationMs ?? 0))}ms`
        );
      }
    }
  );
});
