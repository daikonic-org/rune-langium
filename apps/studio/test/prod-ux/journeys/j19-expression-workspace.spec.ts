// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expressionReferenceFiles } from '../../../../../packages/codegen/test/helpers/cdm-reference.js';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { REPORT_DIR } from '../evidence.js';
import {
  loadPinnedFunction,
  openBuilder,
  expectCenterPaneBounds,
  enlargeDialogText
} from '../../helpers/expression-workspace.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectBodyProjection, expectEditorExpansion } from '../../helpers/body-projection.js';

test.describe('J19 — Expression workspace production acceptance', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J19 Builder keeps drafts private, Apply commits and one Undo restores',
    { annotation: { type: 'journey-subid', description: 'builder' } },
    async ({ page, evidence }) => {
      await loadPinnedFunction(page);
      const implementation = page.getByRole('region', { name: 'Function implementation' });
      const rune = implementation.getByTestId('implementation-editor');
      await expect(rune).toContainText('-1 * arg');
      let dialog = await openBuilder(page);
      await dialog.getByRole('button', { name: 'Text', exact: true }).click();
      await dialog.getByRole('textbox').fill('if arg < 0 then -2 * arg else arg');
      await evidence.checkpoint('private-builder-draft');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(rune).toContainText('-1 * arg');
      dialog = await openBuilder(page);
      await dialog.getByRole('button', { name: 'Text', exact: true }).click();
      await expect(dialog.getByRole('textbox')).toContainText('-1 * arg');
      await dialog.getByRole('textbox').fill('if arg < 0 then -2 * arg else arg');
      await evidence.measure('expressionApply', 'pinned Abs', async () => {
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(rune).toContainText('-2 * arg');
      });
      await evidence.checkpoint('builder-applied');
      await rune.locator('.cm-content').press('ControlOrMeta+z');
      await expect(rune).toContainText('-1 * arg');
      await evidence.checkpoint('one-undo-restored');
    }
  );

  test(
    'J19 Data conditions switch independently and project both languages',
    { annotation: { type: 'journey-subid', description: 'conditions' } },
    async ({ page, evidence }) => {
      await loadPinnedFunction(page);
      await page.getByTestId('namespace-search').fill('Frequency');
      await typeNavigationButton(page, 'cdm.base.datetime.Frequency', 'Data').click();
      await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
      await page.getByRole('tab', { name: 'PositivePeriodMultiplier', exact: true }).click();
      const condition = page.getByRole('region', { name: 'Condition expression' });
      const details = page
        .locator('details')
        .filter({ has: page.locator('summary', { hasText: 'Condition details' }) });
      await expect(details).not.toHaveAttribute('open', '');
      await expect(page.getByLabel('Condition name', { exact: true })).toBeHidden();
      await expectEditorExpansion(condition);
      const rune = condition.getByTestId('implementation-editor').locator('.cm-content');
      await expect(rune).toContainText('periodMultiplier > 0');
      await rune.press('ControlOrMeta+a');
      await page.keyboard.insertText('periodMultiplier > 1');
      for (const language of ['TypeScript', 'Python'] as const) {
        const generated = await expectBodyProjection(condition, language, 'periodMultiplier');
        await expect(generated).toContainText('periodMultiplier');
        await expect(generated).toContainText('1');
        await expect(condition.getByRole('alert')).toHaveCount(0);
        await evidence.checkpoint(`condition-${language.toLowerCase()}`);
      }
      await page.getByRole('tab', { name: 'TermPeriod', exact: true }).click();
      await expect(condition).toContainText('PeriodExtendedEnum');
      await page.getByRole('tab', { name: 'PositivePeriodMultiplier', exact: true }).click();
      await expect(condition).toContainText('periodMultiplier > 1');
      await evidence.checkpoint('condition-edit-retained');
    }
  );

  for (const baseFirst of [false, true]) {
    test(
      `J19 split-file dispatch resolves the base with base first=${baseFirst}`,
      { annotation: { type: 'journey-subid', description: `dispatch-${baseFirst ? 'base' : 'variant'}-first` } },
      async ({ page, evidence }) => {
        const clientErrors: string[] = [];
        page.on('pageerror', (error) => clientErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') clientErrors.push(message.text());
        });
        await page.goto('./');
        const base = {
          name: 'base.rosetta',
          mimeType: 'text/plain',
          buffer: Buffer.from(`namespace checkout.dispatch
enum Kind:
 Cash
func Compute:
 inputs: kind Kind (1..1)
          amount int (1..1)
 output: result int (1..1)
 set result: amount
`)
        };
        const variant = {
          name: 'variant.rosetta',
          mimeType: 'text/plain',
          buffer: Buffer.from(`namespace checkout.dispatch
func Compute(kind: Kind -> Cash):
 set result: amount + 1
`)
        };
        await page
          .locator('input[type="file"][accept=".rosetta"]')
          .setInputFiles(baseFirst ? [base, variant] : [variant, base]);
        await page.getByTestId('namespace-search').fill('Compute');
        await typeNavigationButton(page, 'checkout.dispatch.Compute', 'RosettaFunction').click();
        await page.getByRole('button', { name: 'Inspector', exact: true }).click();
        const implementation = page.getByRole('region', { name: 'Function implementation' });
        const rune = implementation.getByTestId('implementation-editor').locator('.cm-content');
        await expect(rune).toContainText('set result: amount');
        await expect(rune).not.toContainText('amount + 1');
        await rune.press('ControlOrMeta+a');
        await page.keyboard.insertText(' set result: amount + 10\n // trailing body comment');
        for (const language of ['TypeScript', 'Python']) {
          await implementation.getByRole('button', { name: language, exact: true }).click();
          const generated = implementation.getByRole('textbox', { name: `Generated ${language.toLowerCase()}` });
          await generated.press(language === 'TypeScript' || !baseFirst ? 'ControlOrMeta+End' : 'ControlOrMeta+Home');
          if (language === 'Python' && baseFirst) await generated.press('PageDown');
          await expect(generated).toContainText('10');
          await expect(implementation.getByRole('alert')).toHaveCount(0);
          await evidence.checkpoint(`dispatch-${language.toLowerCase()}`);
        }
        const inspector = page.locator('[data-testid="center-stack"] [data-pane="inspector"]');
        await expect(inspector).toContainText('Inputs (2)');
        await expect(inspector).not.toContainText('No output type');
        await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: 'Inspector', exact: true }).click();
        const source = fullSourceEditor(page).locator('.cm-content');
        await source.press('ControlOrMeta+Home');
        await expect(source).toContainText('amount + 10');
        await expect(source).not.toContainText('Compute(kind:');
        await evidence.checkpoint('source-reveals-edited-base');
        expect(
          clientErrors.filter((message) => /completionResultRange|undelivered notifications/.test(message))
        ).toEqual([]);
      }
    );
  }

  test(
    'J19 ten-operation CDM body remains continuous with complete typed projections',
    { annotation: { type: 'journey-subid', description: 'multi-operation' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
        expressionReferenceFiles().map(({ uri, content }) => ({
          name: uri.split('/').at(-1)!,
          mimeType: 'text/plain',
          buffer: Buffer.from(content)
        }))
      );
      await page.getByTestId('namespace-search').fill('ConvertToAdjustableOrRelativeDate');
      await typeNavigationButton(
        page,
        'cdm.base.datetime.ConvertToAdjustableOrRelativeDate',
        'RosettaFunction'
      ).click();
      await page.getByRole('button', { name: 'Inspector', exact: true }).click();
      const implementation = page.getByRole('region', { name: 'Function implementation' });
      const rune = implementation.getByTestId('implementation-editor');
      await expect(rune).toHaveCount(1);
      await expect(rune).toContainText('alias relativeDate:');
      await evidence.checkpoint('continuous-cdm-body');
      for (const language of ['TypeScript', 'Python'] as const) {
        await evidence.measure('expressionProjection', `CDM ${language}`, async () => {
          await expectBodyProjection(implementation, language, 'relativeDate', 'periodMultiplier');
        });
        await evidence.checkpoint(`complete-cdm-${language.toLowerCase()}`);
      }
    }
  );

  test(
    'J19 curated function preserves read-only source and authoritative projections',
    { annotation: { type: 'journey-subid', description: 'curated-readonly' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await page.getByTestId('rail-explore').click();
      await page.getByTestId('namespace-search').fill('Abs');
      await typeNavigationButton(page, 'cdm.base.math.Abs', 'RosettaFunction').click();
      await page.getByRole('button', { name: 'Inspector', exact: true }).click();
      const implementation = page.getByRole('region', { name: 'Function implementation' });
      const rune = implementation.getByTestId('implementation-editor').locator('.cm-content');
      await expect(rune).toHaveAttribute('aria-readonly', 'true');
      await expect(implementation).toContainText('set result:');
      const original = await rune.innerText();
      await rune.press('x');
      await expect(rune).toHaveText(original);
      await expect(implementation.getByRole('button', { name: 'Builder', exact: true })).toBeDisabled();
      for (const language of ['TypeScript', 'Python'] as const) {
        await expectBodyProjection(
          implementation,
          language,
          language === 'TypeScript' ? 'input.arg' : 'input["arg"]',
          'return'
        );
        await evidence.checkpoint(`curated-${language.toLowerCase()}`);
      }
      await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
      await page.getByRole('button', { name: 'Inspector', exact: true }).click();
      const source = fullSourceEditor(page).locator('.cm-content');
      await expect(source).toHaveAttribute('aria-readonly', 'true');
      await expect(source).toContainText('func Abs:');
      await evidence.checkpoint('curated-source-readonly');
    }
  );

  test(
    'J19 compact Builder supports large fonts, narrow panes and keyboard return',
    { annotation: { type: 'journey-subid', description: 'compact-accessibility' } },
    async ({ page, evidence }, testInfo) => {
      await page.setViewportSize({ width: 800, height: 800 });
      await loadPinnedFunction(page);
      const font = page.getByRole('button', { name: /Pane font size:/ }).first();
      while ((await font.getAttribute('data-font-scale-current')) !== 'lg') await font.click();
      await evidence.checkpoint('compact-large-font-inspector');
      await expectCenterPaneBounds(page);
      const dialog = await openBuilder(page);
      await enlargeDialogText(page, dialog);
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
      const dir = path.join(REPORT_DIR, 'axe', 'J19', `attempt${testInfo.retry}`);
      await mkdir(dir, { recursive: true });
      for (const mode of ['builder', 'text']) {
        if (mode === 'text') await dialog.getByRole('button', { name: 'Text', exact: true }).click();
        const results = await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();
        await writeFile(path.join(dir, `${mode}.json`), JSON.stringify(results, null, 2));
        await evidence.checkpoint(`compact-${mode}`);
        expect(results.violations).toEqual([]);
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(page.getByTestId('implementation-editor').locator('.cm-content')).toBeFocused();
    }
  );
});
