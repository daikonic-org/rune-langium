// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test } from '@playwright/test';
import { fullSourceEditor, codeMirrorDocument } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

// Synthetic model: exercises creation, inherited scope and source acknowledgement.
const source = `namespace drafts
type Security:
 identifier string (1..1)
type Cash extends Security:
 currency string (1..1)
 condition Existing: currency exists
`;

test('a condition built from empty stays singular after parsing and reference edits remain private until Apply', async ({
  page
}) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'drafts.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(source)
  });
  await page.getByTestId('ns-type-link-drafts.Cash#Data').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dismissLocalTransportNotices(page);
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page.getByRole('button', { name: 'Add condition', exact: true }).click();
  await page.getByLabel('New condition name').fill('CurrencyPresent');
  await page.getByRole('button', { name: 'Add expression', exact: true }).click();
  await page.getByTestId('palette-option-exists').click();
  await page.getByRole('button', { name: 'Add expression', exact: true }).click();
  await page.getByTestId('palette-open-reference').click();
  await page.getByTestId('ref-option-currency').click();
  await expect(page.getByTestId('dsl-preview').locator('pre')).toHaveText('currency exists');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByText('Structural editing waits for the current Rune draft to parse.', { exact: true })
  ).toBeHidden();
  await expect(page.getByRole('tab', { name: 'CurrencyPresent', exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: 'CurrencyPresent', exact: true }).click();
  const condition = page.getByRole('region', { name: 'Condition expression' });
  await expect(condition.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'CurrencyPresent', exact: true })).toHaveCount(1);
  const committed = await codeMirrorDocument(fullSourceEditor(page));
  expect(committed.match(/condition CurrencyPresent:/g)).toHaveLength(1);
  await condition.getByRole('button', { name: 'Builder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Expression builder', exact: true });
  await dialog.getByRole('button', { name: 'Edit reference currency', exact: true }).click();
  await page.getByTestId('ref-option-identifier').click();
  await expect(dialog.getByTestId('dsl-preview').locator('pre')).toHaveText('identifier exists');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await codeMirrorDocument(fullSourceEditor(page))).toBe(committed);
});
