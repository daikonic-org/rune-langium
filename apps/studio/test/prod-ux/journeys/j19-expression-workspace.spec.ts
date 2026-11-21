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
  openComposeExpression,
  openInlineRuneDraft,
  expectCenterPaneBounds,
  enlargeExpressionText
} from '../../helpers/expression-workspace.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectBodyProjection, expectEditorExpansion } from '../../helpers/body-projection.js';
import { expectWorkspaceHeaderBounds } from '../../helpers/app-header.js';

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
      await expect(rune.locator('.cm-line').first()).not.toHaveText(/^\s/);
      const row = await openComposeExpression(page);
      const stage = async () => {
        const draft = await openInlineRuneDraft(page, row);
        const input = draft.getByRole('textbox', { name: 'Rune source editor' });
        await expect(input).toContainText('-1 * arg');
        await input.fill('if arg < 0 then -2 * arg else arg');
        await draft.getByRole('button', { name: 'Done', exact: true }).click();
      };
      await stage();
      await evidence.checkpoint('private-builder-draft');
      await row.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(row.getByRole('button', { name: 'Edit -1', exact: true })).toBeVisible();
      await stage();
      await evidence.measure('expressionApply', 'pinned Abs', async () => {
        await row.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(row.getByRole('button', { name: 'Edit -2', exact: true })).toBeVisible();
      });
      await evidence.checkpoint('builder-applied');
      await page.getByRole('button', { name: 'Undo expression edit', exact: true }).click();
      await expect(row.getByRole('button', { name: 'Edit -1', exact: true })).toBeVisible();
      await evidence.checkpoint('one-undo-restored');
    }
  );

  test(
    'J19 inline TypeScript edits preserve renamed implicit callback bindings',
    { annotation: { type: 'journey-subid', description: 'callback-bindings' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'callbacks.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(`namespace callbacks
func Filter:
 inputs:
  values number (0..*)
  ^item number (1..1)
 output: result number (0..*)
 set result: values filter [item > 0]
`)
      });
      await page.getByTestId('namespace-search').fill('Filter');
      await typeNavigationButton(page, 'callbacks.Filter', 'RosettaFunction').click();
      const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
      if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
      const implementation = page.getByRole('region', { name: 'Function implementation' });
      const projection = await expectBodyProjection(
        implementation,
        'TypeScript',
        'item1 => item1 > 0',
        'return result'
      );
      const baseline = await projection.innerText();
      await projection.press('ControlOrMeta+a');
      await page.keyboard.insertText(baseline.replace('> 0', '> item1'));
      await implementation.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(implementation.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
      await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
      const rune = implementation.getByTestId('implementation-editor').locator('.cm-content');
      await expect(rune).toContainText('filter [item > item]');
      await expect(rune).not.toContainText('item1');
      await evidence.checkpoint('callback-alias-restored');
      await rune.press('ControlOrMeta+z');
      await expect(rune).toContainText('filter [item > 0]');
    }
  );

  test(
    'J19 inline TypeScript regex edits retain linked pattern origins',
    { annotation: { type: 'journey-subid', description: 'pattern-origins' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'patterns.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(`namespace patterns
func Pattern:
 output: result pattern (1..1)
 set result: "^x+$"
`)
      });
      await page.getByTestId('namespace-search').fill('Pattern');
      await typeNavigationButton(page, 'patterns.Pattern', 'RosettaFunction').click();
      const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
      if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
      const implementation = page.getByRole('region', { name: 'Function implementation' });
      const projection = await expectBodyProjection(implementation, 'TypeScript', '/^x+$/', 'return result');
      const baseline = await projection.innerText();
      await projection.press('ControlOrMeta+a');
      await page.keyboard.insertText(baseline.replace('/^x+$/', '/^y+$/'));
      await implementation.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(implementation.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
      await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
      const rune = implementation.getByTestId('implementation-editor').locator('.cm-content');
      await expect(rune).toContainText('"^y+$"');
      await expect(implementation.getByRole('alert')).toHaveCount(0);
      await evidence.checkpoint('pattern-literal-applied');
      await rune.press('ControlOrMeta+z');
      await expect(rune).toContainText('"^x+$"');
      await evidence.checkpoint('pattern-literal-undo');
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
      await expect(condition.getByRole('button', { name: 'Edit periodMultiplier', exact: true })).toBeVisible();
      await condition.getByRole('button', { name: 'Edit Rune text', exact: true }).click();
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
      await condition.getByRole('button', { name: 'Rune', exact: true }).click();
      await expect(condition.getByRole('button', { name: 'Edit 1', exact: true })).toBeVisible();
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
      await expect(rune).toHaveAttribute('aria-readonly', 'true');
      for (const language of ['TypeScript', 'Python'] as const) {
        await expectBodyProjection(implementation, language, 'arg', 'return', { readOnly: true });
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
      await expectWorkspaceHeaderBounds(page);
      await evidence.checkpoint('compact-large-font-inspector');
      await expectCenterPaneBounds(page);
      const row = await openComposeExpression(page);
      await enlargeExpressionText(page, row);
      const bounds = await row.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
      const dir = path.join(REPORT_DIR, 'axe', 'J19', `attempt${testInfo.retry}`);
      await mkdir(dir, { recursive: true });
      let draft;
      for (const mode of ['builder', 'text']) {
        if (mode === 'text') draft = await openInlineRuneDraft(page, row);
        const results = await new AxeBuilder({ page })
          .include('[aria-label="Composition source"]')
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();
        await writeFile(path.join(dir, `${mode}.json`), JSON.stringify(results, null, 2));
        await evidence.checkpoint(`compact-${mode}`);
        expect(results.violations).toEqual([]);
      }
      await draft!.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(draft!).not.toBeVisible();
      await expect(row.getByRole('button', { name: 'Expression actions', exact: true })).toBeFocused();
    }
  );
});
