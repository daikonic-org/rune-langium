// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Page } from '@playwright/test';
import { parse } from '@rune-langium/core';
import AxeBuilder from '@axe-core/playwright';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const SOURCE = `namespace demo.inspector
version "1"
synonym source FpML
annotation marking:
  scheme string (1..1)
type Person:
  // authored name comment
  name string (1..1) [marking scheme "scheme"="ISIN"]
  age int (0..1)
type Employee extends Person:
  employeeId string (1..1)
enum Role:
  Manager displayName "Account manager"
  Developer
${Array.from({ length: 60 }, (_, index) => `  Role${index}`).join('\n')}
func Identity:
  inputs: value string (1..1)
  output: result string (1..1)
  set result: value
`;

test.beforeAll(async () => {
  expect((await parse(SOURCE)).hasErrors).toBe(false);
});

async function load(page: Page, name = 'Person', kind = 'Data') {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'details.rosetta', mimeType: 'text/plain', buffer: Buffer.from(SOURCE) });
  await navigate(page, name, kind);
}
async function navigate(page: Page, name: string, kind = 'Data') {
  await page.getByTestId('namespace-search').fill(name);
  await typeNavigationButton(page, `demo.inspector.${name}`, kind).click();
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
}
async function savedSource(page: Page, expected: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (expected) => {
          async function scan(directory: FileSystemDirectoryHandle): Promise<string | undefined> {
            for await (const [name, handle] of directory.entries()) {
              if (handle.kind === 'file' && name === 'details.rosetta') {
                const text = await (await (handle as FileSystemFileHandle).getFile()).text();
                if (text.includes(expected)) return text;
              } else if (handle.kind === 'directory') {
                const found = await scan(handle as FileSystemDirectoryHandle);
                if (found) return found;
              }
            }
          }
          return scan(await navigator.storage.getDirectory());
        }, expected),
      { timeout: 15000 }
    )
    .toContain(expected);
}

test('child documentation and unblurred qualifier edits persist through rename and reload', async ({ page }, info) => {
  await load(page);
  const row = page.locator('[data-slot="attribute-row"]').first();
  await row.getByRole('textbox', { name: /Attribute name/ }).focus();
  let details = page.getByRole('region', { name: 'Details: name', exact: true });
  await details.getByLabel('Definition', { exact: true }).fill('Full name documentation');
  await row.getByRole('textbox', { name: /Attribute name/ }).fill('fullName');
  await expect(page.getByRole('region', { name: 'Details: fullName', exact: true })).toBeVisible();
  details = page.getByRole('region', { name: 'Details: fullName', exact: true });
  await details.getByRole('button', { name: 'Edit marking annotation' }).click();
  await details.getByLabel('Qualifier 1 value').fill('SEDOL');
  // Selection flushes the same declaration barrier, without relying on blur timing.
  await page
    .locator('[data-slot="attribute-row"]')
    .nth(1)
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  await savedSource(page, '"scheme"="SEDOL"');
  await savedSource(page, 'Full name documentation');
  await page.reload();
  await navigate(page, 'Person');
  await page
    .locator('[data-slot="attribute-row"]')
    .first()
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  details = page.getByRole('region', { name: 'Details: fullName', exact: true });
  await expect(details.getByLabel('Definition', { exact: true })).toHaveValue('Full name documentation');
  await expect(page.getByLabel('Comments', { exact: true })).toHaveCount(0);
  await dismissLocalTransportNotices(page);
  await info.attach('selected-field', {
    body: await page.locator('[data-slot="inspector-frame"]').screenshot({ path: info.outputPath('inspector.png') }),
    contentType: 'image/png'
  });
});

test('enum details survive later-page rename, display clear and reorder', async ({ page }, info) => {
  await load(page, 'Role', 'RosettaEnumeration');
  const first = page.locator('[data-slot="enum-value-row"]').first();
  await first.getByRole('textbox', { name: /Value name/ }).focus();
  const display = page.getByRole('region', { name: 'Details: Manager' }).getByLabel('Display name', { exact: true });
  await expect(display).toHaveValue('Account manager');
  await display.fill('');
  await savedSource(page, 'Manager\n');
  await page.getByRole('button', { name: /Show more/ }).click();
  const last = page.locator('[data-slot="enum-value-row"]').last();
  await last.getByRole('textbox', { name: /Value name/ }).fill('LastRole');
  let details = page.getByRole('region', { name: 'Details: LastRole' });
  await details.getByLabel('Display name', { exact: true }).fill('Last role display');
  await savedSource(page, 'LastRole displayName "Last role display"');
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await last.dispatchEvent('dragstart', { dataTransfer: transfer });
  await first.dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await savedSource(page, 'enum Role:\n  LastRole');
  await page.reload();
  await navigate(page, 'Role', 'RosettaEnumeration');
  await page
    .locator('[data-slot="enum-value-row"]')
    .first()
    .getByRole('textbox', { name: /Value name/ })
    .focus();
  details = page.getByRole('region', { name: 'Details: LastRole' });
  await expect(details.getByLabel('Display name', { exact: true })).toHaveValue('Last role display');
  await dismissLocalTransportNotices(page);
  await info.attach('enum-detail', {
    body: await page.locator('[data-slot="inspector-frame"]').screenshot({ path: info.outputPath('inspector.png') }),
    contentType: 'image/png'
  });
});

test('inherited details inspect the ancestor and retain explicit override actions', async ({ page }) => {
  await load(page, 'Employee');
  const row = page.getByRole('listitem', { name: 'Inspect name', exact: true });
  await row.click();
  const details = page.getByRole('region', { name: /Details: name/ });
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Add annotation' })).toHaveCount(0);
  await row.getByRole('button', { name: /Override inherited attribute name/ }).click();
  await expect(page.getByRole('textbox', { name: 'Attribute name: name', exact: true })).toBeEnabled();
});

test('divider keyboard, pointer and touch remain bounded with narrow scaled content', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await load(page);
  await page
    .locator('[data-slot="attribute-row"]')
    .first()
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  const divider = page.getByRole('separator', { name: 'Resize item details' });
  await divider.focus();
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '96');
  await divider.press('End');
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBe(Number(await divider.getAttribute('aria-valuemax')));
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 70);
  await page.mouse.up();
  const touch = await page.context().newCDPSession(page);
  const touchBox = (await divider.boundingBox())!;
  const point = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - 40 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await touch.detach();
  await page.setViewportSize({ width: 900, height: 720 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const frame = page.locator('[data-slot="inspector-frame"]');
  await expect(frame).toBeVisible();
  const scaledDefinition = page
    .getByRole('region', { name: 'Details: name' })
    .getByLabel('Definition', { exact: true });
  await scaledDefinition.scrollIntoViewIfNeeded();
  await expect(scaledDefinition).toBeInViewport();
  await scaledDefinition.fill('Scaled child documentation');
  await savedSource(page, 'Scaled child documentation');
  const overflow = await frame.evaluate((element) => {
    const pane = element.getBoundingClientRect();
    return [...element.querySelectorAll('input,textarea,button')]
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width && rect.height && (rect.right > pane.right + 2 || rect.left < pane.left - 2);
      })
      .map((control) => control.getAttribute('aria-label') ?? control.textContent);
  });
  expect(overflow).toEqual([]);
  const axe = await new AxeBuilder({ page })
    .include('[data-slot="inspector-frame"]')
    .disableRules(['color-contrast'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await dismissLocalTransportNotices(page);
  await info.attach('narrow-scaled-inspector', {
    body: await page.locator('[data-slot="inspector-frame"]').screenshot({ path: info.outputPath('inspector.png') }),
    contentType: 'image/png'
  });
  await page.getByRole('button', { name: 'Collapse item details' }).click();
  await expect(divider).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand item details' }).click();
  await page.getByRole('button', { name: 'Clear item selection' }).click();
  await expect(page.getByText('Select a member to inspect its details.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('function child selection and pane resizing retain the implementation editor session', async ({ page }, info) => {
  await load(page, 'Identity', 'RosettaFunction');
  const editor = page.getByTestId('implementation-editor');
  await expect(editor).toBeVisible();
  const original = await editor.locator('.cm-content').elementHandle();
  await page
    .locator('[data-slot="attribute-row"]')
    .first()
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  await page
    .getByRole('region', { name: 'Details: value' })
    .getByLabel('Definition', { exact: true })
    .fill('Function input');
  const details = page.getByRole('region', { name: 'Details: value' });
  await details.getByRole('button', { name: 'Select source…', exact: true }).click();
  await page.getByRole('option', { name: 'FpML demo.inspector', exact: true }).click();
  await details.getByLabel('Synonym value').fill('Wire value');
  await details.getByRole('button', { name: 'Add', exact: true }).click();
  await savedSource(page, '[synonym FpML value "Wire value"]');
  const divider = page.getByRole('separator', { name: 'Resize item details' });
  await divider.press('Home');
  await page.getByRole('button', { name: 'Collapse item details' }).click();
  await page.getByRole('button', { name: 'Expand item details' }).click();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  expect(
    await page.locator('[data-slot="inspector-frame"]').evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(1);
  await savedSource(page, 'Function input');
  await expect(editor.locator('.cm-content')).toContainText('set result:');
  await dismissLocalTransportNotices(page);
  await info.attach('function-child-details', {
    body: await page.locator('[data-slot="inspector-frame"]').screenshot({ path: info.outputPath('inspector.png') }),
    contentType: 'image/png'
  });
});

test('loaded imported annotation scope wins over a foreign duplicate', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles([
    {
      name: 'owner.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'namespace demo.inspector\nimport scope.selected.*\ntype Owner:\n  name string (1..1) [marking scheme "scheme"="ISIN"]\n'
      )
    },
    {
      name: 'selected.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace scope.selected\nannotation marking:\n  scheme string (1..1)\n')
    },
    {
      name: 'foreign.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace scope.foreign\nannotation marking:\n  foreignScheme string (1..1)\n')
    }
  ]);
  await navigate(page, 'Owner');
  await page
    .locator('[data-slot="attribute-row"]')
    .first()
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  const details = page.getByRole('region', { name: 'Details: name' });
  await details.getByRole('button', { name: 'Edit marking annotation' }).click();
  await expect(details.getByRole('button', { name: 'scheme', exact: true })).toBeEnabled();
  await expect(details.getByText('Annotation scope unavailable.')).toHaveCount(0);
});
