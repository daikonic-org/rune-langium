// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('repeated namespace aliases retain type kinds and canonical navigation', async ({ page }) => {
  await page.goto('./');
  const files = [
    ['asset', 'namespace fpml.asset\ntype Asset:\n value string (0..1)\n'],
    ['option', 'namespace fpml.option\ntype Exercise:\n value string (0..1)\n'],
    ['unrelated', 'namespace unrelated\ntype Exercise:\n value int (0..1)\n'],
    [
      'caller',
      'namespace caller\nimport fpml.asset.* as fpml\nimport fpml.option.* as fpml\nfunc Read:\n inputs:\n  asset fpml.Asset (1..1)\n  exercise fpml.Exercise (1..1)\n output: result fpml.Exercise (1..1)\n set result: exercise\n'
    ]
  ];
  await page.locator('input[type=file][accept=".rosetta"]').setInputFiles(
    files.map(([name, content]) => ({
      name: `${name}.rosetta`,
      mimeType: 'text/plain',
      buffer: Buffer.from(content!)
    }))
  );
  await page.getByTestId('namespace-search').fill('Read');
  await typeNavigationButton(page, 'caller.Read', 'RosettaFunction').click();
  const structure = page.locator('.react-flow__node', { hasText: 'Read' });
  await expect(structure.locator('[data-kind="Unresolved"]')).toHaveCount(0);
  await expect(structure.locator('[data-slot="type-chip"][data-kind="Data"]')).toHaveCount(3);
  await expect(structure).toContainText('fpml.Asset');
  await expect(structure).toContainText('fpml.Exercise');
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await dismissLocalTransportNotices(page);
  const inspector = page.locator('[data-slot="editor-form-panel"]');
  await expect(inspector.locator('[data-kind="Unresolved"]')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Go to fpml.Asset', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Go to fpml.Asset', exact: true }).click();
  await expect(page.locator('[data-slot="editor-form-panel"]')).toHaveAttribute('aria-label', 'Edit Asset');
});

test('an inherited override retains its parent import scope in the saved source', async ({ page }) => {
  await page.goto('./');
  const files = [
    ['wrong', 'namespace wrong\ntype Amount:\n value string (1..1)\n'],
    ['actual', 'namespace actual\ntype Amount:\n value string (1..1)\n'],
    ['parent', 'namespace parent\nimport actual.*\nimport wrong.* as other\ntype Base:\n amount Amount (1..1)\n'],
    ['child', 'namespace child\nimport parent.*\ntype Child extends Base:\n']
  ];
  await page.locator('input[type=file][accept=".rosetta"]').setInputFiles(
    files.map(([name, content]) => ({
      name: `${name}.rosetta`,
      mimeType: 'text/plain',
      buffer: Buffer.from(content!)
    }))
  );
  await page.getByTestId('namespace-search').fill('Child');
  await typeNavigationButton(page, 'child.Child').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await dismissLocalTransportNotices(page);
  const inspector = page.locator('[data-slot="editor-form-panel"]');
  await inspector.getByRole('button', { name: 'Override inherited attribute amount from Base', exact: true }).click();
  await expect(inspector.locator('[data-slot="attribute-row"]')).toContainText('actual.Amount');
  const source = page.getByRole('button', { name: 'Source', exact: true });
  if ((await source.getAttribute('aria-pressed')) !== 'true') await source.click();
  await expect(page.locator('.cm-content').filter({ hasText: 'type Child' })).toContainText('amount actual.Amount');
});
