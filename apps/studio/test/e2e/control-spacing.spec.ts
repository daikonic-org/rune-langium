// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../helpers/studio-test.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { waitForEntranceAnimations } from '../prod-ux/readiness.js';

test('loads Transit Code Book Narrow for Source and inline editing', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'type-width.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'namespace typography\nfunc Check:\n inputs: amount number (1..1)\n output: result boolean (1..1)\n set result: amount >= 1\n'
    )
  });
  await page.getByTestId('ns-type-link-typography.Check#RosettaFunction').click();
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
  await dismissLocalTransportNotices(page);
  await expect(page.getByRole('region', { name: 'Function implementation' }).locator('.cm-content')).toHaveCSS(
    'font-weight',
    '350'
  );
  await page.getByRole('button', { name: 'Open in Compose', exact: true }).click();
  const chip = page.getByRole('button', { name: 'Edit amount', exact: true });
  await expect(chip).toHaveCSS('font-family', /Daikonic Transit Code/);
  await expect(chip).toHaveCSS('font-weight', '350');
  const metrics = await chip.evaluate(async (element) => {
    const family = getComputedStyle(element).fontFamily.split(',')[0]!.trim();
    const metrics = (style: '' | 'italic') => {
      const sample = document.createElement('span');
      sample.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;letter-spacing:normal;';
      sample.style.font = [style, '350 50px', family].filter(Boolean).join(' ');
      sample.style.fontVariantLigatures = 'common-ligatures contextual';
      element.parentElement!.append(sample);
      const width = (value: string) => {
        sample.textContent = value;
        return sample.getBoundingClientRect().width;
      };
      const result = { cells: width('mmmmmmmmmm'), arrow: width('>='), single: width('m') };
      sample.remove();
      return result;
    };
    const upright = await document.fonts.load('350 50px ' + family, 'm >=');
    const italic = await document.fonts.load('italic 350 50px ' + family, 'm >=');
    const tokens = getComputedStyle(document.documentElement);
    return {
      upright: metrics(''),
      italic: metrics('italic'),
      loaded: upright.some((face) => face.status === 'loaded') && italic.some((face) => face.status === 'loaded'),
      mono: tokens.getPropertyValue('--font-mono'),
      title: tokens.getPropertyValue('--font-title'),
      body: tokens.getPropertyValue('--font-body')
    };
  });
  expect(metrics.loaded).toBe(true);
  expect(metrics.upright.cells).toBeCloseTo((10 * 50 * 564) / 1043, 1);
  expect(metrics.italic.cells).toBeCloseTo(metrics.upright.cells, 1);
  expect(metrics.upright.arrow).toBeCloseTo(metrics.upright.single, 1);
  expect(metrics.mono).toContain('JetBrains Mono');
  expect(metrics.title).toContain('Daikonic Transit Sans');
  expect(metrics.body).toContain('Daikonic Transit System');
});

for (const theme of ['light', 'daikonic'])
  for (const width of [1280, 800]) {
    test(`compact form rhythm and checkbox labels at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`./?theme=${theme}`);
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'spacing.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          'namespace spacing\nversion "1.0.0"\nenum Party:\n Party1\n Party2\ntype Record:\n firstName string (0..1)\n lastName string (0..1)\n enabled boolean (0..1)\n receiver Party (1..1)\n'
        )
      });
      await page.getByTestId('ns-type-link-spacing.Record#Data').click();
      const preview = page.getByTestId('panel-formPreview');
      if (width === 800) {
        await page.getByRole('button', { name: 'Show Preview panel', exact: true }).click();
        await page.getByRole('tab', { name: 'Form', exact: true }).dblclick();
      }
      const firstName = preview.getByLabel('First Name', { exact: true });
      await expect(firstName).toBeVisible();
      await expect(firstName).toHaveCSS('height', '24px');
      await expect(firstName).toHaveCSS('font-weight', '350');
      const receiver = preview.getByRole('combobox', { name: 'Receiver', exact: true });
      await receiver.click();
      await page.getByRole('option', { name: 'Party1', exact: true }).click();
      const receiverValue = receiver.locator('[data-slot="select-value"]');
      await expect(receiverValue).toHaveText('Party1');
      await expect(receiverValue).toHaveCSS('overflow-y', 'visible');
      await expect(receiverValue).toHaveCSS('font-weight', '350');
      await expect(page.getByRole('tab', { name: 'Form', exact: true }).locator('.studio-dock-tab__label')).toHaveCSS(
        'font-weight',
        '400'
      );
      await expect(firstName).toHaveCSS('padding-block-end', '2px');
      await firstName.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(firstName).toBeFocused();
      expect(await firstName.evaluate((control) => control.matches(':focus-visible'))).toBe(true);
      expect(await firstName.evaluate((control) => getComputedStyle(control).boxShadow)).not.toBe('none');
      await dismissLocalTransportNotices(page);
      const checkbox = preview.getByRole('checkbox', { name: 'Enabled', exact: true });
      await preview.getByText('Enabled', { exact: true }).click();
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toHaveCSS('top', '-1px');
      const spacing = await checkbox.evaluate((control) => {
        const label = control.parentElement!.querySelector('label')!;
        return label.getBoundingClientRect().left - control.getBoundingClientRect().right;
      });
      expect(spacing).toBeGreaterThanOrEqual(8);
      await expect(preview.locator('.preview-layout-grid').first()).toHaveCSS('row-gap', '8px');
      await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
      const importModel = page.getByRole('button', { name: 'Import Model', exact: true });
      await expect(importModel).toHaveCSS('font-weight', '500');
      const buttonLabel = importModel.locator('[data-slot="button-label"]');
      await expect(buttonLabel).toHaveCSS('text-box-edge', 'cap alphabetic');
      const buttonAlignment = await buttonLabel.evaluate((label) => {
        const center = (element: Element) => {
          const box = element.getBoundingClientRect();
          return box.top + box.height / 2;
        };
        const button = label.closest('button')!;
        return { label: center(label) - center(button), icon: center(button.querySelector('svg')!) - center(button) };
      });
      expect(Math.abs(buttonAlignment.label)).toBeLessThan(0.5);
      expect(Math.abs(buttonAlignment.icon)).toBeLessThan(0.5);
      await importModel.click();
      const dialog = page.getByRole('dialog', { name: 'Import Model', exact: true });
      await expect(dialog).toBeVisible();
      await waitForEntranceAnimations(page);
      const fields = dialog.locator('.z2f-field').filter({ has: page.getByRole('checkbox') });
      expect(await fields.count()).toBeGreaterThan(0);
      for (const field of await fields.all()) {
        const geometry = await field.evaluate((element) => {
          const input = element.querySelector('[role="checkbox"]')!;
          const label = element.querySelector('label')!;
          const c = input.getBoundingClientRect(),
            l = label.getBoundingClientRect();
          return { gap: l.left - c.right, width: c.width, fits: l.right <= element.getBoundingClientRect().right + 1 };
        });
        expect(geometry.gap).toBeGreaterThanOrEqual(8);
        expect(geometry.width).toBe(16);
        expect(geometry.fits).toBe(true);
      }
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath('import.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByTestId('settings-perspective');
      await expect(settings).toBeVisible();
      await expect(settings).toHaveCSS('padding-left', '12px');
      await expect(settings).toHaveCSS('padding-top', '8px');
      const privacy = settings.getByTestId('settings-privacy-section');
      const privacyGeometry = await privacy.evaluate((section) => {
        const control = section.querySelector('[role="checkbox"]')!.getBoundingClientRect();
        const label = section.querySelector('label')!.getBoundingClientRect();
        const help = section.querySelector('[data-slot="field-description"]')!.getBoundingClientRect();
        return { gap: label.left - control.right, helpOffset: help.left - label.left };
      });
      expect(privacyGeometry).toEqual({ gap: 8, helpOffset: 0 });
      const themeSelect = settings.getByRole('combobox', { name: /theme/i });
      await expect(themeSelect).toHaveCSS('height', '24px');
      await expect(themeSelect).toHaveCSS('padding-block-end', '0px');
      const selectAlignment = await themeSelect.evaluate((control) => {
        const field = control.getBoundingClientRect();
        const wrapper = control.parentElement!.getBoundingClientRect();
        const chevron = control.parentElement!.querySelector('svg')!.getBoundingClientRect();
        return {
          wrapperHeight: wrapper.height,
          chevronOffset: chevron.top + chevron.height / 2 - (field.top + field.height / 2)
        };
      });
      expect(selectAlignment.wrapperHeight).toBeCloseTo(24, 2);
      expect(Math.abs(selectAlignment.chevronOffset)).toBeLessThan(0.5);
      await themeSelect.selectOption(theme === 'light' ? 'daikonic' : 'light');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'light' ? 'daikonic' : 'light');
      await themeSelect.selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await waitForEntranceAnimations(page);
      await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true });
    });
  }
