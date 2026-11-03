// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test } from '../helpers/studio-test.js';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveCuratedDeclarations, servePinnedReferenceProject } from '../helpers/curated-declaration-server.js';
import { seedProjectBackingFiles } from '../helpers/project-backing.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const sources = [
  ['terms', 'namespace example.terms\ntype Terms:\n amount number (1..1)\n'],
  [
    'functions',
    'namespace example.functions\nimport example.terms.*\nfunc External:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n'
  ]
] as const;

for (const mode of ['modify', 'extend'] as const)
  test(`${mode} creates a persistent editable declaration from the Inspector title`, async ({
    page,
    context
  }, info) => {
    test.setTimeout(60000);
    const prematureReferences: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('ComputedScopes')) prematureReferences.push(message.text());
    });
    await serveCuratedDeclarations(context, sources);
    const project = await servePinnedReferenceProject(context, { 'rune-dsl': sources[0][1], cdm: sources[1][1] });
    await page.setViewportSize({ width: 1461, height: 988 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'seed.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace scratch\ntype Seed:\n value string (0..1)\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, {
      'rune-config.yml': 'model: {name: Demo}',
      'build-config.yml': JSON.stringify({
        schemaVersion: 1,
        sources: ['**/*.rosetta'],
        references: project.references
      }),
      'build-config.lock.json': JSON.stringify(project.lock)
    });
    await page.getByTestId('rail-explore').click();
    const original = mode === 'modify' ? 'example.functions.External' : 'example.terms.Terms';
    const kind = mode === 'modify' ? 'RosettaFunction' : 'Data';
    await page.getByTestId('namespace-search').fill(mode === 'modify' ? 'External' : 'Terms');
    await typeNavigationButton(page, original, kind).click();
    const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
    if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
    const title = page.locator('[data-pane="inspector"] [data-slot="type-header"]');
    const action = title.getByRole('button', { name: mode === 'modify' ? 'Modify local copy' : 'Extend declaration' });
    await expect(action).toBeEnabled({ timeout: 20000 });
    for (const width of [960, 1280, 1461]) {
      await page.setViewportSize({ width, height: 988 });
      await expect
        .poll(async () => {
          const bounds = (await title.boundingBox())!;
          const overflowing: string[] = [];
          for (const control of await title.getByRole('button').all()) {
            const box = (await control.boundingBox())!;
            if (box.x < bounds.x - 1 || box.x + box.width > bounds.x + bounds.width + 1)
              overflowing.push((await control.getAttribute('aria-label')) ?? 'control');
          }
          return overflowing;
        })
        .toEqual([]);
    }
    await action.click();
    const dialog = page.getByRole('dialog', {
      name: mode === 'modify' ? 'Modify External' : 'Extend Terms',
      exact: true
    });
    const destination = mode === 'modify' ? 'example.functions' : 'local.test';
    if (mode === 'extend') await dialog.getByLabel('Local namespace').fill(destination);
    else await expect(dialog.getByLabel('Local namespace')).toHaveAttribute('readonly');
    await dialog
      .getByRole('button', { name: mode === 'modify' ? 'Create local copy' : 'Create extension', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const sourcePane = page.locator('[data-pane="source"] .cm-content');
    await expect(sourcePane).toContainText(`${mode === 'modify' ? 'override ' : ''}namespace ${destination}`, {
      timeout: 20000
    });
    await expect(title.getByText(destination, { exact: true })).toBeVisible();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toHaveCount(0);
    if (mode === 'extend') {
      await expect(sourcePane).toContainText('type TermsExtension extends example.terms.Terms:');
      await expect(page.locator('[data-pane="inspector"]').getByText('inherited from Terms')).toBeVisible();
    } else {
      const bodyEditor = page.getByTestId('implementation-editor').locator('.cm-content');
      await expect(bodyEditor).toBeVisible();
      await bodyEditor.click();
      await bodyEditor.press('ControlOrMeta+A');
      await page.keyboard.insertText('set result: terms -> amount * 2');
      await bodyEditor.press('Tab');
      await expect(sourcePane).toContainText('set result: terms -> amount * 2');
      await dismissLocalTransportNotices(page);
      expect((await new AxeBuilder({ page }).include('[data-pane="inspector"]').analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath('local-implementation.png') });
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: 'Choose a function', exact: true }).click();
      await page.getByRole('option', { name: /External.*example.functions/ }).click();
      const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true });
      await expect(amount).toBeVisible({ timeout: 20000 });
      await amount.fill('12');
      await amount.press('Tab');
      const execute = page.getByRole('button', { name: 'Execute', exact: true });
      await expect(execute).toBeEnabled();
      await execute.click();
      await expect(page.getByRole('region', { name: 'result output' })).toContainText('24');
    }
    await page.reload();
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill(mode === 'modify' ? 'External' : 'TermsExtension');
    await typeNavigationButton(
      page,
      `${destination}.${mode === 'modify' ? 'External' : 'TermsExtension'}`,
      kind
    ).click();
    if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
    await expect(title.getByText(destination, { exact: true })).toBeVisible();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toHaveCount(0);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('local-declaration-restored.png') });
    await page.getByTestId('namespace-search').fill('Terms');
    await typeNavigationButton(page, 'example.terms.Terms', 'Data').click();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toBeEnabled();
    await expect(title.getByText('Reference Only', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('curated-title-actions.png') });
    expect(prematureReferences).toEqual([]);
  });
