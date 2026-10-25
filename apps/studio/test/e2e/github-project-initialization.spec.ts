// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mavenInitializationFixture, withLocalRuneImplementation } from '../../../../test/helpers/maven-project.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

for (const [name, width] of [
  ['cdm', 1461],
  ['fpml', 700]
] as const)
  test(
    'reopens pinned ' + name + ' settings with honest partial capability and local Rune recovery',
    async ({ page }, info) => {
      test.setTimeout(90000);
      const fixture = await mavenInitializationFixture(name);
      await page.setViewportSize({ width, height: 988 });
      await page.goto('./');
      await page
        .locator('input[type="file"][accept=".rosetta"]')
        .setInputFiles({ name: 'seed.rosetta', buffer: Buffer.from('namespace seed\n'), mimeType: 'text/plain' });
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await projectBackingFiles(page, Object.fromEntries(fixture.files));
      await page.reload();
      await page.getByTestId('rail-export').click();
      const settings = page.getByTestId('export-settings-panel');
      // Compact Export opens on Preview; use its existing Settings tab.
      if (width < 900)
        await page.getByTestId('export-perspective').getByRole('tab', { name: 'Settings', exact: true }).click();
      await expect(settings.getByRole('checkbox', { name: 'types', exact: true })).toBeEnabled();
      for (const id of Object.keys(fixture.preview.build.targets).filter((id) => !['types', 'schedule'].includes(id)))
        await expect(settings.getByRole('checkbox', { name: id, exact: true })).toBeDisabled();
      await settings.getByText('Saved initialization report', { exact: true }).click();
      await expect(settings.getByLabel('Initialization compatibility report')).toContainText('unsupported');
      await expect(page.getByRole('button', { name: 'Import Maven', exact: true })).toHaveCount(0);
      const sourceEvidence = settings.getByText('Source evidence', { exact: true }).first();
      if (await sourceEvidence.count()) {
        await sourceEvidence.click();
        await expect(settings.locator('pre').first()).toBeVisible();
      }
      await dismissLocalTransportNotices(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const a11y = await new AxeBuilder({ page }).include('[data-testid="export-settings-panel"]').analyze();
      expect(a11y.violations).toEqual([]);
      await info.attach(name + '-partial-import', {
        body: await page.screenshot({ path: info.outputPath(name + '-partial-import.png') }),
        contentType: 'image/png'
      });
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: /^Choose a function/ }).click();
      await page.getByRole('option', { name: /CreatePaymentSchedule.*example/ }).click();
      const execute = page.getByRole('button', { name: 'Execute', exact: true });
      await expect(execute).toBeDisabled({ timeout: 20000 });
      await expect(
        page.getByText(/registered provider|missing-calendar|implementation.*unavailable/i).first()
      ).toBeVisible({ timeout: 20000 });
      const repaired = withLocalRuneImplementation(fixture.files, fixture.preview);
      repaired.set('pom.xml', '<project>future POM is not reimported</project>');
      await projectBackingFiles(page, Object.fromEntries(repaired));
      await page.reload();
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: /^Choose a function/ }).click();
      await page.getByRole('option', { name: /CreatePaymentSchedule.*example/ }).click();
      await page.getByRole('spinbutton', { name: 'Value', exact: true }).fill('2');
      await expect(execute).toBeEnabled({ timeout: 20000 });
      await execute.click();
      await expect(page.getByRole('region', { name: 'result output' })).toContainText('3');
      const saved = await projectBackingFiles(page);
      expect(saved['pom.xml']).toBe('<project>future POM is not reimported</project>');
      expect(saved[fixture.preview.build.importReport!]).toBe(fixture.files.get(fixture.preview.build.importReport!));
    }
  );
