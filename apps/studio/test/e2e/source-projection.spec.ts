// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { codeMirrorDocument } from '../helpers/source-editor.js';

const source = `namespace projection
type Asset:
 amount int (1..1)
type Trade:
 asset Asset (0..1)
func Deep:
 inputs: trade Trade (1..1)
 output: result int (0..1)
 set result: trade ->> amount
func Transform:
 inputs: values int (0..*) cutoff int (1..1)
 output: adjusted int (0..*)
 condition Positive: cutoff > 0
 set adjusted: values filter [item > cutoff] sort
 post-condition Bounded: adjusted count <= values count
func Optional:
 inputs: amount int (0..1)
 output: result int (0..1)
 set result: amount extract [1]
func Nested:
 inputs: values int (0..*) other int (0..*)
 output: result int (0..*)
 set result: (values extract [other extract [item + 1]]) flatten
func External:
 inputs: amount int (1..1)
 output: result int (1..1)
`;

test('concise projections preserve contracts, private edits, undo and unavailable implementation status', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'projection.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('namespace-search').fill('Transform');
  await typeNavigationButton(page, 'projection.Transform', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await dismissLocalTransportNotices(page);
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  const rune = implementation.getByTestId('implementation-editor').locator('.cm-content');
  await rune.locator('.cm-line').filter({ hasText: 'set adjusted:' }).click();
  await page.keyboard.press('End');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  const generated = implementation.getByRole('textbox', { name: 'Generated typescript' });
  await expect(generated).toContainText('values.filter(item => item > cutoff).sort()');
  await expect(generated).toContainText("assert(cutoff > 0, 'Positive')");
  await expect(generated).toContainText("assert(adjusted.count() <= values.count(), 'Bounded')");
  await expect(generated).toContainText('return adjusted;');
  await expect(generated).not.toContainText(/\bas\b/);
  await implementation.getByRole('button', { name: 'Edit expression…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit expression as TypeScript' });
  const draft = dialog.getByRole('textbox', { name: 'TypeScript expression draft' });
  await draft.press('ControlOrMeta+a');
  await page.keyboard.insertText('filter(values, item => item > cutoff + 1).sort()');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await expect(rune).toContainText('item > cutoff');
  await expect(rune).not.toContainText('cutoff + 1');
  // Edit a unique literal in a scalar extraction; preserve its authored operation.
  await page.getByTestId('namespace-search').fill('Optional');
  await typeNavigationButton(page, 'projection.Optional', 'RosettaFunction').click();
  await rune.locator('.cm-line').filter({ hasText: 'set result:' }).click();
  await page.keyboard.press('End');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('extract(amount, item => 1)');
  await implementation.getByRole('button', { name: 'Edit expression…', exact: true }).click();
  await draft.press('ControlOrMeta+a');
  await page.keyboard.insertText('extract(amount, item => 2)');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await expect(rune).toContainText('amount extract [2]');
  await rune.press('ControlOrMeta+z');
  await expect(rune).toContainText('amount extract [1]');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await implementation.getByRole('button', { name: 'Edit expression…', exact: true }).click();
  await draft.press('ControlOrMeta+a');
  const captured = 'then(amount, outer => [1, 2].map(x => outer + x))';
  await page.keyboard.insertText(captured);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/cannot retain the captured callback binding/);
  await expect(dialog).toBeVisible();
  await expect(draft).toContainText(captured);
  const refusalScreenshot = testInfo.outputPath('source-projection-scope-refusal.png');
  await page.screenshot({ path: refusalScreenshot });
  await testInfo.attach('source-projection-scope-refusal', { path: refusalScreenshot, contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await expect(rune).toContainText('amount extract [1]');
  await page.getByTestId('namespace-search').fill('Nested');
  await typeNavigationButton(page, 'projection.Nested', 'RosettaFunction').click();
  await rune.locator('.cm-line').filter({ hasText: 'set result:' }).click();
  await page.keyboard.press('End');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('item1 + 1');
  await implementation.getByRole('button', { name: 'Edit expression…', exact: true }).click();
  const nestedDraft = await codeMirrorDocument(draft);
  expect(nestedDraft).toContain('item1 + 1');
  await draft.press('ControlOrMeta+a');
  await page.keyboard.insertText(nestedDraft.replace('item1 + 1', 'item1 * 2'));
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await expect(rune).toContainText('other extract [item * 2]');
  await expect(rune).not.toContainText('item1');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('item1 * 2');
  await expect(implementation.getByText(/Showing the last valid source/)).not.toBeVisible();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  const nestedScreenshot = testInfo.outputPath('source-projection-nested-binding.png');
  await page.screenshot({ path: nestedScreenshot });
  await testInfo.attach('source-projection-nested-binding', { path: nestedScreenshot, contentType: 'image/png' });
  await rune.press('ControlOrMeta+z');
  await expect(rune).toContainText('other extract [item + 1]');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('item1 + 1');
  await expect(implementation.getByText(/Showing the last valid source/)).not.toBeVisible();
  await page.getByTestId('namespace-search').fill('Deep');
  await typeNavigationButton(page, 'projection.Deep', 'RosettaFunction').click();
  await rune.locator('.cm-line').filter({ hasText: 'set result:' }).click();
  await page.keyboard.press('End');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('trade._.amount');
  await implementation.getByRole('button', { name: 'Edit expression…', exact: true }).click();
  await draft.press('ControlOrMeta+a');
  await page.keyboard.insertText('trade._.amount + 1');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await expect(rune).toContainText('trade ->> amount + 1');
  await rune.press('ControlOrMeta+z');
  await expect(rune).toContainText('trade ->> amount');
  await expect(rune).not.toContainText('amount + 1');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(generated).toContainText('trade._.amount');
  await expect(implementation.getByText(/Showing the last valid source/)).not.toBeVisible();
  const deepScreenshot = testInfo.outputPath('source-projection-deep.png');
  await page.screenshot({ path: deepScreenshot });
  await testInfo.attach('source-projection-deep', { path: deepScreenshot, contentType: 'image/png' });
  await page.getByTestId('namespace-search').fill('External');
  await typeNavigationButton(page, 'projection.External', 'RosettaFunction').click();
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(implementation.getByRole('status')).toContainText('No TypeScript implementation available');
  await expect(implementation.getByRole('textbox', { name: 'Generated typescript' })).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include('[aria-label="Function implementation"]').analyze()).violations
  ).toEqual([]);
  const screenshot = testInfo.outputPath('source-projection-status.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('source-projection-status', { path: screenshot, contentType: 'image/png' });
});
