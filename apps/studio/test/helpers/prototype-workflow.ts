// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { dismissLocalTransportNotices } from './expression-workspace.js';

export interface WorkflowJourney {
  id: string;
  title: string;
  run: (page: Page, evidence: WorkflowEvidence) => Promise<void>;
}

interface WorkflowEvidence {
  checkpoint: (name: string) => Promise<void>;
  beforeReload?: () => Promise<void>;
  accessibility: (name: string, results: Awaited<ReturnType<AxeBuilder['analyze']>>) => Promise<void>;
}

export const workflowJourneys: WorkflowJourney[] = [];
function journey(id: string, title: string, run: WorkflowJourney['run']) {
  workflowJourneys.push({
    id,
    title,
    run: async (page, evidence) => {
      await run(page, evidence);
      await evidence.checkpoint(id);
    }
  });
}

const source = `namespace workflow
version "1.0.0"
typeAlias Amount: number
type Money:
 amount Amount (1..1)
 currency string (1..1)
func AddMoney:
 inputs:
  value Money (1..1)
  other Money (1..1)
 output:
  result Money (1..1)
 condition SameCurrency:
  value -> currency = other -> currency
 set result:
  Money { amount: value -> amount + other -> amount, currency: value -> currency }
func ScaleAmount:
 inputs:
  value Money (1..1)
  factor number (1..1)
 output:
  result Money (1..1)
 set result:
  Money { amount: value -> amount * factor, currency: value -> currency }
func Amount:
 inputs:
  value Money (1..1)
 output:
  amount number (1..1)
 set amount: value -> amount
func EchoMoney:
 inputs:
  values Money (0..*)
 output:
  result Money (0..*)
 set result: values
func EchoNotes:
 inputs:
  notes string (0..*)
 output:
  result string (0..*)
 set result: notes
func OptionalMoney:
 inputs:
  value Money (0..1)
 output:
  result string (1..1)
 set result: "done"
func StringList:
 inputs: items string (0..*)
 output: result string (0..*)
 set result: items
func StringListCopy:
 inputs: items string (0..*)
 output: result string (0..*)
 set result: items
func NumberList:
 inputs: items number (0..*)
 output: result number (0..*)
 set result: items
func AliasAmount:
 inputs: value Amount (1..1)
 output: result Amount (1..1)
 set result: value`;

async function openWorkflow(page: Page) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('rail-prototype').click();
  await expect(page.getByRole('region', { name: 'Prototype workflow' })).toBeVisible();
  // Never hide hosted transport failures in the production evidence.
  if (['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname)) {
    await dismissLocalTransportNotices(page);
  }
}
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: `${name} — workflow`, exact: true }).click();
}
async function money(page: Page, name: string, amount: string, currency = 'USD') {
  const fields = page.getByRole('region', { name: `${name} fields`, exact: true });
  await fields.getByRole('spinbutton', { name: 'Amount', exact: true }).fill(amount);
  await fields.getByRole('textbox', { name: 'Currency', exact: true }).fill(currency);
}
async function sum(page: Page) {
  await choose(page, 'AddMoney');
  await money(page, 'value', '1250');
  await money(page, 'other', '25');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled({ timeout: 15000 });
}

journey(
  'validation',
  'validates each input and function preconditions before explicit execution',
  async (page, evidence) => {
    await openWorkflow(page);
    await sum(page);
    await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
    await page.getByRole('region', { name: 'other fields' }).getByRole('textbox', { name: 'Currency' }).fill('EUR');
    await expect(page.getByRole('button', { name: /^value: Checks passed/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^other: Checks passed/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /^AddMoney: 1 issue/ }).click();
    await expect(page.getByText(/Diagnostic:.*SameCurrency/)).toBeVisible();
    await evidence.checkpoint('function-condition-invalid');
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'other fields' }).getByRole('textbox', { name: 'Currency' }).fill('USD');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' }).fill('');
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
    await page.getByRole('button', { name: /^value: .*issues?/ }).click();
    await page
      .getByRole('button', { name: /value.amount:/ })
      .first()
      .click();
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toBeFocused();
  }
);

journey('payload-graph', 'toggles the payload graph without resetting workflow inputs or its result', async (page) => {
  await openWorkflow(page);
  await sum(page);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  const graph = page.getByRole('region', { name: 'Payload graph', exact: true });
  const toggle = page.getByRole('button', { name: 'Payload graph', exact: true });
  await expect(graph).toHaveCount(0);
  for (let iteration = 0; iteration < 2; iteration++) {
    await toggle.click();
    await expect(graph).toBeVisible();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await toggle.click();
    await expect(graph).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  }
});

journey(
  'optional-object',
  'executes with an absent optional object and validates its members once supplied',
  async (page) => {
    await openWorkflow(page);
    await choose(page, 'OptionalMoney');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toHaveText('"done"');
    await page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' }).fill('10');
    await expect(execute).toBeDisabled();
    await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
    await page.getByRole('region', { name: 'value fields' }).getByRole('textbox', { name: 'Currency' }).fill('USD');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toHaveText('"done"');
  }
);

journey(
  'list-identity',
  'retains compatible list inputs but resets lists when their element type changes',
  async (page) => {
    await openWorkflow(page);
    await choose(page, 'StringList');
    await page.getByRole('button', { name: 'items node actions' }).click();
    await page.getByRole('button', { name: 'Import input…', exact: true }).click();
    await page.getByRole('textbox', { name: 'Import JSON data' }).fill('["kept"]');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.keyboard.press('Escape');
    await choose(page, 'StringListCopy');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('kept');
    await choose(page, 'NumberList');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toHaveText('[]');
  }
);

journey(
  'scalar-bypass',
  'preserves compatible input drafts and supports primitive parameters, scalar output and bypass',
  async (page) => {
    await openWorkflow(page);
    await sum(page);
    await choose(page, 'ScaleAmount');
    const factor = page.getByRole('region', { name: 'ScaleAmount fields' }).getByRole('spinbutton', { name: 'Factor' });
    await factor.fill('2');
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
    await choose(page, 'Amount');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('region', { name: 'amount output' })).toContainText('number');
    await expect(page.getByTestId('instance-payload-output')).toHaveText('1250');
    await expect(page.getByRole('button', { name: 'Save as instance…' })).toHaveCount(0);
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: 'Clear selection', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'input fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    await expect(page.getByTestId('instance-payload-output')).toContainText('1250');
  }
);

journey(
  'bulk-binding',
  'imports objects to the grid without replacing the active workflow and binds either input',
  async (page) => {
    await openWorkflow(page);
    await sum(page);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await page.getByRole('button', { name: 'Import objects…', exact: true }).click();
    await page.getByRole('button', { name: 'Imported object type', exact: true }).click();
    await page.getByRole('option', { name: 'Money — workflow', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Import JSON data', exact: true })
      .fill('[{"amount":5,"currency":"USD"},{"amount":10,"currency":"USD"}]');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('prototype-grid').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Imported Money 1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'other Money', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'other fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('5');
    await money(page, 'other', '7');
    await expect(
      page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Imported Money 1' })
    ).toContainText(/saved/i);
  }
);

for (const width of [1440, 700, 390])
  journey(`viewport-${width}`, `keeps validation, layout and fields usable at ${width}px`, async (page, evidence) => {
    await page.setViewportSize({ width, height: 1000 });
    await openWorkflow(page);
    await sum(page);
    await page.getByRole('button', { name: /^value: Checks passed/ }).click();
    await expect(page.getByRole('heading', { name: 'value · validation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'value: Edit layout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'value: Finish editing layout', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await evidence.checkpoint(`layout-editing-${width}`);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    const axe = await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze();
    await evidence.accessibility(`viewport-${width}`, axe);
    expect(axe.violations).toEqual([]);
    await evidence.checkpoint(`viewport-${width}`);
  });

journey(
  'drag-resize',
  'drags a function, resizes columns and retains the workflow across perspectives',
  async (page) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkflow(page);
    await page.getByRole('button', { name: /Choose a function/ }).click();
    const option = await page.getByRole('option', { name: 'ScaleAmount — workflow', exact: true }).boundingBox();
    const target = await page.locator('.workflow-function').boundingBox();
    expect(option).toBeTruthy();
    expect(target).toBeTruthy();
    await page.mouse.move(option!.x + 70, option!.y + 12);
    await page.mouse.down();
    await page.mouse.move(target!.x + 100, target!.y + 22, { steps: 12 });
    await page.mouse.up();
    await money(page, 'value', '1250');
    await page
      .getByRole('region', { name: 'ScaleAmount fields' })
      .getByRole('spinbutton', { name: 'Factor' })
      .fill('2');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
    const divider = page.getByRole('separator', { name: 'Resize inputs and function' });
    await divider.press('Home');
    await expect(divider).toHaveAttribute('aria-valuenow', '22');
    await divider.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', '24');
    const bounds = await divider.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 80, bounds!.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect(divider).not.toHaveAttribute('aria-valuenow', '24');
    const resized = await divider.getAttribute('aria-valuenow');
    await page.getByRole('button', { name: 'Object builder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Object builder', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('rail-prototype').click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
    await expect(page.getByRole('button', { name: 'Object builder', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(divider).toHaveAttribute('aria-valuenow', resized!);
  }
);

journey(
  'list-import',
  'imports a JSON object or array into an object-list parameter without losing cardinality',
  async (page) => {
    await openWorkflow(page);
    await choose(page, 'EchoMoney');
    async function importValues(json: string, name = 'values') {
      await page.getByRole('button', { name: `${name} node actions`, exact: true }).click();
      await page.getByRole('button', { name: 'Import input…', exact: true }).click();
      await page.getByRole('textbox', { name: 'Import JSON data', exact: true }).fill(json);
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await page.keyboard.press('Escape');
    }
    await importValues('[{"amount":2,"currency":"USD"},{"amount":3,"currency":"EUR"}]');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('EUR');
    expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual([
      { amount: 2, currency: 'USD' },
      { amount: 3, currency: 'EUR' }
    ]);
    await importValues('{"amount":4,"currency":"GBP"}');
    await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('GBP');
    expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual([
      { amount: 4, currency: 'GBP' }
    ]);
    await page.getByRole('button', { name: 'values node actions', exact: true }).click();
    await page.getByRole('button', { name: 'Import input…', exact: true }).click();
    await page.getByRole('textbox', { name: 'Import JSON data', exact: true }).fill('[7]');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Import an object or an array of objects' })).toBeVisible();
    await expect(page.getByTestId('instance-payload-output')).toContainText('GBP');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await importValues('[]');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toHaveText('[]');
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: 'Clear selection', exact: true }).click();
    await choose(page, 'EchoNotes');
    await importValues('["first","second"]', 'notes');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('second');
    expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual(['first', 'second']);
  }
);

journey(
  'presentation-persistence',
  'shares symbol layouts and monetary formats across nodes and reload',
  async (page, evidence) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkflow(page);
    await sum(page);
    const value = page.getByRole('region', { name: 'value fields', exact: true });
    const other = page.getByRole('region', { name: 'other fields', exact: true });
    await value.getByLabel('Amount', { exact: true }).fill('1250.12345');
    await page.getByRole('button', { name: 'value: Edit layout', exact: true }).click();
    await value.getByRole('button', { name: 'Move Currency', exact: true }).press('ArrowUp');
    const order = (root: typeof value) =>
      root
        .locator('.preview-layout-grid')
        .first()
        .locator(':scope > [data-layout-field]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')));
    await expect.poll(() => order(value)).toEqual(['currency', 'amount']);
    await expect.poll(() => order(other)).toEqual(['currency', 'amount']);
    await value.getByRole('button', { name: 'Format workflow.Amount', exact: true }).click();
    await page.getByRole('combobox', { name: 'Number format', exact: true }).click();
    await page.getByRole('option', { name: 'Currency', exact: true }).click();
    await expect(value.getByLabel('Amount', { exact: true })).toHaveValue('$1,250.12');
    await expect(other.getByLabel('Amount', { exact: true })).toHaveValue('$25.00');
    const axe = await new AxeBuilder({ page }).include('.preview-format-editor').analyze();
    await evidence.accessibility('monetary-format', axe);
    expect(axe.violations).toEqual([]);
    await evidence.checkpoint('monetary-format');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await value.getByLabel('Amount', { exact: true }).focus();
    await expect(value.getByLabel('Amount', { exact: true })).toHaveValue('1250.12345');
    await value.getByLabel('Currency', { exact: true }).focus();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275.12345');
    await evidence.checkpoint('formatted-raw-result');
    await evidence.beforeReload?.();
    await page.reload();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('rail-prototype').click();
    await choose(page, 'AddMoney');
    await expect.poll(() => order(value)).toEqual(['currency', 'amount']);
    await expect.poll(() => order(other)).toEqual(['currency', 'amount']);
    await value.getByLabel('Amount', { exact: true }).fill('1250.12345');
    await value.getByLabel('Currency', { exact: true }).fill('USD');
    await expect(value.getByLabel('Amount', { exact: true })).toHaveValue('$1,250.12');
    await page.setViewportSize({ width: 390, height: 1000 });
    await value.getByLabel('Amount', { exact: true }).scrollIntoViewIfNeeded();
    const bounds = (await value.getByLabel('Amount', { exact: true }).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await evidence.checkpoint('restored-layout-phone');
  }
);

journey(
  'output-persistence',
  'saves a function object output as an instance and restores it after reload',
  async (page, evidence) => {
    await openWorkflow(page);
    await sum(page);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await page.getByRole('button', { name: 'Save as instance…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New instance', exact: true });
    await dialog.getByLabel('Instance name', { exact: true }).fill('Calculated money');
    await dialog.getByRole('button', { name: 'Create instance', exact: true }).click();
    // Creation offers an input binding while a compatible function is active.
    await page
      .getByRole('dialog', { name: 'Use object as input', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    const row = page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Calculated money' });
    await expect(row).toContainText('workflow.Money');
    await expect(row.getByText('saved', { exact: true })).toBeVisible();
    await evidence.checkpoint('saved-function-output');
    await evidence.beforeReload?.();
    await page.reload();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('rail-prototype').click();
    await expect(row).toContainText('workflow.Money');
    await expect(row.getByText('saved', { exact: true })).toBeVisible();
    await row.click();
    await page
      .getByRole('dialog', { name: 'Use object as input', exact: true })
      .getByRole('button', { name: 'Use as input', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const restored = page.getByRole('region', { name: 'input fields', exact: true });
    await expect(restored.getByLabel('Amount', { exact: true })).toHaveValue('1275');
    await expect(restored.getByLabel('Currency', { exact: true })).toHaveValue('USD');
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  }
);

journey(
  'type-navigation',
  'round-trips from workflow types through Inspector without losing drafts or results',
  async (page, evidence) => {
    await openWorkflow(page);
    await sum(page);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    const input = page.locator('.workflow-inputs [data-workflow-node="value"]');
    await input.getByRole('button', { name: 'View Money in Explore' }).click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
    if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
    const title = page.locator('[data-pane="inspector"] [data-slot="type-header"]');
    await expect(title.locator('[data-slot="type-name-input"]')).toHaveValue('Money');
    await title.locator('[data-slot="type-header-namespace"]').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Back to Prototype' })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCSS('opacity', '1');
    await evidence.checkpoint('inspector-return-menu');
    await page.getByRole('menuitem', { name: 'Back to Prototype' }).click();
    await expect(
      page.getByRole('region', { name: 'value fields', exact: true }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await input.locator('header').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Go to type', exact: true }).click();
    await title.getByRole('button', { name: 'Back to Prototype', exact: true }).click();
    const fn = page.locator('.workflow-function .workflow-node');
    await fn.getByRole('button', { name: 'View AddMoney in Explore' }).focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Go to type', exact: true }).click();
    await expect(title.locator('[data-slot="type-name-input"]')).toHaveValue('AddMoney');
    await title.getByRole('button', { name: 'Declaration navigation' }).click();
    await page.getByRole('menuitem', { name: 'Back to Prototype' }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: 'Clear selection', exact: true }).click();
    await choose(page, 'AliasAmount');
    await page
      .locator('.workflow-function')
      .getByRole('button', { name: 'View Amount in Explore', exact: true })
      .click();
    await expect(title.locator('[data-slot="type-name-input"]')).toHaveValue('Amount');
    await expect(title).toContainText('Type Alias');
    await title.getByRole('button', { name: 'Back to Prototype', exact: true }).click();
    const axe = await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze();
    await evidence.accessibility('navigation-axe', axe);
    expect(axe.violations).toEqual([]);
  }
);
