// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Buffer } from 'node:buffer';
import { expect, type Page } from '@playwright/test';
import { typeNavigationButton } from './type-navigation.js';

const cases = [
  { name: 'Date', type: 'date', value: '2026-10-10', control: 'date' },
  { name: 'Time', type: 'time', value: '14:35:12', control: 'time' },
  { name: 'DateTime', type: 'dateTime', value: '2026-10-10T14:35:12', control: 'datetime-local' },
  { name: 'ZonedDateTime', type: 'zonedDateTime', value: '2026-10-10T14:35:12+05:30', control: 'text' },
  { name: 'Enum', type: 'Kind', value: 'Physical', control: 'select' }
] as const;

export async function checkPrimitivePreviews(page: Page, checkpoint: (name: string) => Promise<void>) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'primitives.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(`namespace checkout.primitives
enum Kind:
 Cash
 Physical
${cases
  .map(
    ({ name, type }) => `func Echo${name}:
 inputs: value ${type} (1..1)
 output: result ${type} (1..1)
 set result: value
`
  )
  .join('\n')}`)
  });
  for (const entry of cases) {
    await page.getByTestId('namespace-search').fill(`Echo${entry.name}`);
    await typeNavigationButton(page, `checkout.primitives.Echo${entry.name}`, 'RosettaFunction').click();
    const form = page.getByTestId('panel-formPreview');
    const field = form.getByLabel('Value', { exact: true });
    if (entry.control === 'select') {
      await field.click();
      await page.getByRole('option', { name: entry.value, exact: true }).click();
    } else {
      await expect(field).toHaveAttribute('type', entry.control);
      if (entry.name === 'DateTime') {
        await form.getByRole('button', { name: 'Edit ISO value' }).click();
        await field.fill(entry.value + 'Z');
        await form.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(form.locator('.execution-error')).toContainText('without a UTC offset');
        await checkpoint('local-datetime-rejects-offset');
      }
      await field.fill(entry.value);
    }
    await form.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(form.locator('.execution-result')).toContainText(entry.value);
    await expect(form.locator('.execution-error')).toHaveCount(0);
    await checkpoint(`primitive-${entry.name.toLowerCase()}`);
  }
}
