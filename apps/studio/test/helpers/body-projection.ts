// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Locator } from '@playwright/test';

export async function expectBodyProjection(
  region: Locator,
  language: 'TypeScript' | 'Python',
  first: string | RegExp,
  last?: string | RegExp
) {
  await region.getByRole('button', { name: language, exact: true }).click();
  const generated = region.getByRole('textbox', { name: `Generated ${language.toLowerCase()}` });
  await generated.press('ControlOrMeta+Home');
  await expect(generated).toContainText(first);
  await expect(generated).not.toContainText(/export function|^def \w+\(|^import /m);
  await expect(generated).toHaveAttribute('contenteditable', 'false');
  await expect(region.locator('.cm-gutters, .cm-activeLine')).toHaveCount(0);
  if (last) {
    await generated.press('ControlOrMeta+End');
    await expect(generated).toContainText(last);
  }
  await expect(region.getByRole('alert')).toHaveCount(0);
  return generated;
}

export async function expectEditorExpansion(region: Locator) {
  const editor = region.getByTestId('implementation-editor');
  const original = await editor.elementHandle();
  const initialHeight = (await editor.boundingBox())!.height;
  await region.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await expect.poll(async () => (await editor.boundingBox())!.height).toBeGreaterThan(initialHeight);
  expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(true);
  await region.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await expect.poll(async () => (await editor.boundingBox())!.height).toBe(initialHeight);
  await original?.dispose();
}
