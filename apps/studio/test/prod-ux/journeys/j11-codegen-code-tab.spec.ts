// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, loadCdm, authorScratchType } from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import { ANCHOR_DATA } from '../anchors.js';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

// Target keys match packages/codegen/src/types.ts's `Target` union exactly
// (confirmed live this session) — 'json-schema' is hyphenated, and there is
// no 'jsonschema' key; testids below use these keys verbatim
// (`codegen-targets-table__{row,view,download}-{target}`).
const TARGETS = ['typescript', 'zod', 'json-schema', 'sql', 'openapi'] as const;

const SCRATCH_NAMESPACE = 'scratch.j11codegen';
const SCRATCH_TYPE = 'ScratchCodegenWidget';

test.describe('J11 — Client-side codegen (Code tab)', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J11 Code tab renders selected curated and scratch declarations and regenerates output', async ({
    page,
    evidence
  }, info) => {
    // --- Curated anchor -----------------------------------------------------
    await loadCdm(page, evidence);
    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('BusinessCenters');
    await typeNavigationButton(page, ANCHOR_DATA).click();

    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(page.getByTestId('panel-codePreview')).toBeVisible({ timeout: 20000 });

    // Live Code preview follows the selected declaration, including curated objects.
    await page.getByTestId('codegen-targets-table__view-typescript').click();
    await expect(page.getByTestId('codegen-status')).toContainText(/Generated/i, { timeout: 20000 });
    await expect(page.getByTestId('code-preview-editor')).toContainText(ANCHOR_DATA.split('.').at(-1)!);
    await page.getByRole('button', { name: 'Regenerate TypeScript preview' }).click();
    await expect(page.getByTestId('codegen-status')).toContainText(/Generated/i, { timeout: 20000 });
    await expect(page.getByTestId('code-preview-editor')).toContainText(ANCHOR_DATA.split('.').at(-1)!);
    await evidence.checkpoint('selected-curated-code-regenerated');

    await page.getByTestId('codegen-targets-table__download-typescript').click();
    await expect(page.getByTestId('download-config-dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('download-config-dialog__ns-row-cdm.base.datetime')).toBeVisible();
    await evidence.checkpoint('curated-namespace-available-for-download');

    // Narrow to the reference namespace. The managed generator closes its
    // declaration dependencies from this exact capture, without a latest fetch.
    const dialog = page.getByTestId('download-config-dialog');
    for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
    await page.getByTestId('download-config-dialog__ns-cdm.base.datetime').check();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByTestId('download-config-dialog__generate').click()
    ]);
    const destination = info.outputPath('reference-code-download.zip');
    await download.saveAs(destination);
    const zip = await JSZip.loadAsync(await readFile(destination));
    const manifest = JSON.parse(await zip.file('.rune/export.json')!.async('string'));
    expect(manifest.projectReceipt.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.selection).toEqual({ namespaces: ['cdm.base.datetime'], declarations: [] });
    expect(manifest.resolvedSelection.included).toContainEqual({
      namespace: 'cdm.base.datetime',
      name: 'BusinessCenters',
      kind: 'Data'
    });
    const outputs = (
      await Promise.all(
        manifest.files
          .filter((file: { kind: string }) => file.kind === 'text')
          .map((file: { path: string }) => zip.file(file.path)!.async('string'))
      )
    ).join('\n');
    expect(outputs).toContain('BusinessCenters');
    await evidence.checkpoint('curated-download-verified');

    // --- Scratch workspace ---------------------------------------------------
    // The live per-target preview DOES reflect user-authored content — this
    // is where "Code tab renders non-empty output per target" is actually
    // exercised (confirmed live this session for all five targets below).
    await authorScratchType(page, {
      name: SCRATCH_TYPE,
      namespace: SCRATCH_NAMESPACE,
      attributes: [{ name: 'title', typeName: 'string', cardinality: '(1..1)' }]
    });
    await typeNavigationButton(page, `${SCRATCH_NAMESPACE}.${SCRATCH_TYPE}`).click();
    await page.getByRole('tab', { name: 'Code' }).click();
    await expect(page.getByTestId('panel-codePreview')).toBeVisible({ timeout: 20000 });

    for (const target of TARGETS) {
      // View swaps targets; the active target's action regenerates its output.
      const startedAt = Date.now();
      await page.getByTestId(`codegen-targets-table__view-${target}`).click();
      await expect(page.getByTestId('codegen-status')).toContainText(/Generated/i, { timeout: 20000 });
      const output = await page.getByTestId('code-preview-editor').textContent();
      expect(output?.trim().length ?? 0, `expected non-empty scratch ${target} output`).toBeGreaterThan(0);
      evidence.recordTiming('codegen', target, Date.now() - startedAt);
    }
    await evidence.checkpoint('scratch-all-targets-rendered');
  });
});
