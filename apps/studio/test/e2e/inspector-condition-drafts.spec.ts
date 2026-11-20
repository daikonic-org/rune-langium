// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
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
  await page.getByRole('option', { name: 'exists', exact: true }).click();
  await page.getByRole('button', { name: 'Add expression', exact: true }).click();
  await page.getByRole('option', { name: /^currency string/ }).click();
  await expect(page.getByRole('button', { name: 'Edit currency', exact: true }).last()).toBeVisible();
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeEnabled();
  await page.getByRole('button', { name: 'Edit currency', exact: true }).last().press('i');
  await page.getByRole('textbox', { name: 'Edit currency', exact: true }).fill('identifier');
  await expect(add).toBeDisabled();
  expect(await codeMirrorDocument(fullSourceEditor(page))).toBe(source);
  await page.getByRole('textbox', { name: 'Edit currency', exact: true }).press('Escape');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(
    page.getByText('Structural editing waits for the current Rune draft to parse.', { exact: true })
  ).toBeHidden();
  await expect(page.getByRole('tab', { name: 'CurrencyPresent', exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: 'CurrencyPresent', exact: true }).click();
  const condition = page.getByRole('region', { name: 'Condition expression' });
  await expect(condition.getByRole('button', { name: 'Edit currency', exact: true })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'CurrencyPresent', exact: true })).toHaveCount(1);
  const committed = await codeMirrorDocument(fullSourceEditor(page));
  expect(committed.match(/condition CurrencyPresent:/g)).toHaveLength(1);
  await condition.getByRole('button', { name: 'Edit currency', exact: true }).click();
  await page.getByRole('option', { name: /^identifier string/ }).click();
  await expect(condition.getByRole('button', { name: 'Edit identifier', exact: true })).toBeVisible();
  const move = page.getByRole('button', { name: 'Move condition up', exact: true });
  await expect(move).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Existing', exact: true })).toBeDisabled();
  await condition.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(move).toBeEnabled();
  expect(await codeMirrorDocument(fullSourceEditor(page))).toBe(committed);
});

test('repairs conditions independently while another reference remains unresolved', async ({ page }) => {
  const model = source.replace(
    'condition Existing: currency exists',
    'condition First: missingIdentifier exists\n condition Second: missingCurrency exists'
  );
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'repairs.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(model)
  });
  await page.getByTestId('ns-type-link-drafts.Cash#Data').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dismissLocalTransportNotices(page);
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  const condition = page.getByRole('region', { name: 'Condition expression' });
  let expected = model;
  for (const [name, unresolved, replacement] of [
    ['First', 'missingIdentifier', 'identifier'],
    ['Second', 'missingCurrency', 'currency']
  ]) {
    await page.getByRole('tab', { name, exact: true }).click();
    await condition.getByRole('button', { name: `Edit ${unresolved}`, exact: true }).press(replacement[0]!);
    await condition.getByRole('textbox', { name: `Edit ${unresolved}`, exact: true }).fill(replacement);
    await condition.getByRole('button', { name: 'Done', exact: true }).click();
    await condition.getByRole('button', { name: 'Apply', exact: true }).click();
    expected = expected.replace(unresolved, replacement);
    await expect.poll(() => codeMirrorDocument(fullSourceEditor(page))).toBe(expected);
  }
});

test('call selection exposes named argument slots and commits only a complete private draft', async ({
  page
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  const names = ['lowerX', 'upperX', 'lowerY', 'upperY', 'x'];
  const model = `namespace drafts
type Bounds:
${names.map((name) => ` ${name} number (1..1)`).join('\n')}
 condition Range: lowerX < upperX
func InterpolateLinear:
 inputs:
${names.map((name) => `  ${name} number (1..1)`).join('\n')}
 output: y number (1..1)
 set y: x
`;
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'slots.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(model)
  });
  await page.getByTestId('ns-type-link-drafts.Bounds#Data').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dismissLocalTransportNotices(page);
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page.getByRole('tab', { name: 'Range', exact: true }).click();
  const original = await codeMirrorDocument(fullSourceEditor(page));
  const condition = page.getByRole('region', { name: 'Condition expression' });
  for (const commit of [false, true]) {
    await condition.getByRole('button', { name: 'Edit lowerX', exact: true }).click();
    await page.getByRole('option', { name: 'InterpolateLinear', exact: true }).click();
    await expect(condition.getByRole('button', { name: /^(?:lowerX|upperX|lowerY|upperY|x) argument$/ })).toHaveCount(
      5
    );
    await page.screenshot({ path: info.outputPath('empty-argument-slots.png') });
    await expect(condition.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    expect(await codeMirrorDocument(fullSourceEditor(page))).toBe(original);
    if (!commit) {
      await condition.getByRole('button', { name: 'Discard', exact: true }).click();
      expect(await codeMirrorDocument(fullSourceEditor(page))).toBe(original);
      continue;
    }
    for (const name of names) {
      await condition.getByRole('button', { name: `${name} argument`, exact: true }).click();
      await page.getByRole('option', { name: new RegExp('^' + name + ' number') }).click();
    }
    const expression = 'InterpolateLinear(lowerX, upperX, lowerY, upperY, x) < upperX';
    await expect(condition.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
    expect(await condition.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('named-argument-slots.png') });
    await condition.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => codeMirrorDocument(fullSourceEditor(page))).toContain(expression);
  }
});
