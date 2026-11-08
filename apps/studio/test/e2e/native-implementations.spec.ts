// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import {
  cdmRuneImplementationSources,
  cdmRuneReferenceDocuments,
  cdmEventReference
} from '../../../../test/helpers/cdm-rune-implementations.js';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { seedProjectBackingFiles, projectBackingFiles } from '../helpers/project-backing.js';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { resolveProjectReferences, createMemoryReferenceCache } from '@rune-langium/project-runtime/references';
import {
  calculationPeriodModelSources,
  calculationPeriodCaller,
  calculationPeriodCalendars
} from '../../../../test/helpers/cdm-calculation-period.js';
import { createCuratedFrequencyProject } from '../../../../test/helpers/curated-frequency.js';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import { strikeScheduleDirectory, strikeScheduleCaller } from '../../../../test/helpers/cdm-strike-schedule.js';
const content = `namespace cdm.base.datetime
func AddDays:
 [codeImplementation]
 inputs:
  inputDate date (1..1)
  numDays int (1..1)
 output: resultDate date (1..1)
func DateDifference:
 [codeImplementation]
 inputs:
  firstDate date (1..1)
  secondDate date (1..1)
 output: difference int (1..1)
`;
for (const width of [1440, 390])
  test(`executes calendar implementations delivered with the curated bundle at ${width}px`, async ({ page }, info) => {
    const fixture = await createReferenceArtifacts(
      undefined,
      undefined,
      { cdm: content },
      'https://www.daikonic.dev/curated',
      true
    );
    const resolved = await resolveProjectReferences(
      fixture.snapshot,
      fixture.transport,
      new AbortController().signal,
      createMemoryReferenceCache()
    );
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.lock).toBeDefined();
    await page.route('https://www.daikonic.dev/curated/**', async (route) => {
      const bytes = fixture.artifacts.get(route.request().url());
      if (!bytes) return route.fulfill({ status: 404 });
      await route.fulfill({
        body: Buffer.from(bytes),
        contentType: route.request().url().endsWith('.gz') ? 'application/gzip' : 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'calendar-caller.rosetta',
      buffer: Buffer.from('namespace example.calendar\n'),
      mimeType: 'text/plain'
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, {
      ...Object.fromEntries(fixture.snapshot.files),
      'build-config.lock.json': JSON.stringify(resolved.lock, null, 2) + '\n'
    });
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^AddDays.*cdm.base.datetime/ }).click();
    await page.getByLabel('Input Date', { exact: true }).fill('2020-02-28');
    await page.getByRole('spinbutton', { name: 'Num Days', exact: true }).fill('1');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'resultDate output' })).toContainText('2020-02-29');
    await page.getByRole('button', { name: /^Choose a function:/ }).click();
    await page.getByRole('option', { name: /^DateDifference.*cdm.base.datetime/ }).click();
    await page.getByLabel('First Date', { exact: true }).fill('2020-03-01');
    await page.getByLabel('Second Date', { exact: true }).fill('2020-02-28');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'difference output' })).toContainText('-2');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await info.attach('native-calendar-workflow', {
      body: await page.screenshot({ path: info.outputPath('native-calendar.png') }),
      contentType: 'image/png'
    });
  });

test('executes CDM clearing functions through imported Rune overrides in Prototype', async ({ page }, info) => {
  await page.goto('./');
  const files = [
    ...cdmRuneReferenceDocuments
      .filter((document) => document.uri.startsWith('cdm/'))
      .map((document) => ({ name: `reference-${document.uri.split('/').at(-1)!}`, content: document.content })),
    ...[...cdmRuneImplementationSources].map(([path, content]) => ({ name: path.split('/').at(-1)!, content }))
  ];
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles(
      files.map((file) => ({ name: file.name, mimeType: 'text/plain', buffer: Buffer.from(file.content) }))
    );
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-prototype').click();
  for (const [name, expected] of [
    ['ClearExecution', 'true'],
    ['ClearHistory', '0']
  ] as const) {
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: new RegExp(`^${name}.*cdm.event.common`) }).click();
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText(expected);
    await info.attach(`prototype-${name}`, {
      body: await page.getByTestId('prototype-perspective').ariaSnapshot(),
      contentType: 'text/plain'
    });
  }
});

test('opening a locked bundle copies Rune overrides into editable project sources before Prototype execution', async ({
  page
}) => {
  const fixture = await createReferenceArtifacts(
    undefined,
    undefined,
    { cdm: cdmEventReference },
    'https://www.daikonic.dev/curated',
    true
  );
  const resolved = await resolveProjectReferences(
    fixture.snapshot,
    fixture.transport,
    new AbortController().signal,
    createMemoryReferenceCache()
  );
  expect(resolved.diagnostics).toEqual([]);
  await page.route('https://www.daikonic.dev/curated/**', async (route) => {
    const bytes = fixture.artifacts.get(route.request().url());
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : '',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'caller.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace example.clearing\n')
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    ...Object.fromEntries(fixture.snapshot.files),
    'build-config.lock.json': JSON.stringify(resolved.lock)
  });
  await expect
    .poll(async () => (await projectBackingFiles(page))['model/implementations/cdm/event-common.rosetta'])
    .toContain('override namespace cdm.event.common');
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /^ClearExecution.*cdm.event.common/ }).click();
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('true');
});

test('executes pinned FixingDate dispatch through published helpers and explicit calendar data in Prototype', async ({
  page
}, info) => {
  const fixture = await createReferenceArtifacts(
    undefined,
    undefined,
    calculationPeriodModelSources(),
    'https://www.daikonic.dev/curated',
    true
  );
  const resolved = await resolveProjectReferences(
    fixture.snapshot,
    fixture.transport,
    new AbortController().signal,
    createMemoryReferenceCache()
  );
  expect(resolved.diagnostics).toEqual([]);
  await page.route('https://www.daikonic.dev/curated/**', async (route) => {
    const bytes = fixture.artifacts.get(route.request().url());
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : '',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'calculation.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace example.calculation\n')
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    ...Object.fromEntries(fixture.snapshot.files),
    'build-config.lock.json': JSON.stringify(resolved.lock),
    'model/calculation.rosetta': calculationPeriodCaller,
    'model/test-calendars.rosetta': calculationPeriodCalendars.content
  });
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /^FixingPeriod.*example.calculation/ }).click();
  await page.getByLabel('Start', { exact: true }).fill('2024-03-01');
  await page.getByLabel('End', { exact: true }).fill('2024-03-08');
  await page.getByRole('spinbutton', { name: 'Offset', exact: true }).fill('1');
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled();
  await execute.click();
  const output = page.getByRole('region', { name: 'result output' });
  await expect(output).toContainText('2024-03-06');
  await expect(output).toContainText('2024-03-11');
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await info.attach('calculation-period', {
    body: await page.screenshot({ path: info.outputPath('calculation-period.png') }),
    contentType: 'image/png'
  });
});

for (const width of [1440, 390])
  test(`installs the Strata Rune port and executes its CDM frequency adapter at ${width}px`, async ({ page }, info) => {
    const project = await createCuratedFrequencyProject();
    await page.route('https://www.daikonic.dev/curated/**', async (route) => {
      const bytes = project.fixture.artifacts.get(route.request().url());
      await route.fulfill({
        status: bytes ? 200 : 404,
        body: bytes ? Buffer.from(bytes) : '',
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'frequency.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace example.frequency\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
    await expect
      .poll(async () => (await projectBackingFiles(page))['model/implementations/cdm/strata-frequency.rosetta'])
      .toContain('namespace com.opengamma.strata.basics.schedule');
    await expect
      .poll(async () => (await projectBackingFiles(page))['model/implementations/cdm/frequency.rosetta'])
      .toContain('EventsPerYear(');
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^AnnualPeriods.*example.frequency/ }).click();
    const form = page.getByTestId('prototype-perspective').getByTestId('panel-formPreview');
    const period = form.getByRole('combobox', { name: 'Period', exact: true });
    const roll = form.getByRole('button', { name: /^Roll Convention:/ });
    await period.click();
    await page.getByRole('option', { name: 'M', exact: true }).click();
    await roll.click();
    await page.getByRole('combobox', { name: 'Search Roll Convention', exact: true }).fill('EOM');
    await page.getByRole('option', { name: 'EOM', exact: true }).click();
    const multiplier = form.getByRole('spinbutton', { name: 'Period Multiplier', exact: true });
    await multiplier.fill('3');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('4');
    await multiplier.fill('5');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('SupportedFrequency');
    await period.click();
    await page.getByRole('option', { name: 'T', exact: true }).click();
    await roll.click();
    await page.getByRole('combobox', { name: 'Search Roll Convention', exact: true }).fill('NONE');
    await page.getByRole('option', { name: 'NONE', exact: true }).click();
    await multiplier.fill('1');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('0');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await info.attach('strata-frequency', {
      body: await page.screenshot({ path: info.outputPath('strata-frequency.png') }),
      contentType: 'image/png'
    });
  });

for (const width of [1440, 390])
  test(`maps strike prices and dates through the bundled Rune implementation at ${width}px`, async ({ page }, info) => {
    const project = await createCuratedRuneProject(strikeScheduleDirectory, strikeScheduleCaller);
    await page.route('https://www.daikonic.dev/curated/**', async (route) => {
      const bytes = project.fixture.artifacts.get(route.request().url());
      await route.fulfill({
        status: bytes ? 200 : 404,
        body: bytes ? Buffer.from(bytes) : '',
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'strike.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace example.strike\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
    await expect
      .poll(async () => (await projectBackingFiles(page))['model/implementations/cdm/strike-schedule.rosetta'])
      .toContain('override namespace cdm.ingest.fpml.confirmation.pricequantity');
    await expect
      .poll(async () => (await projectBackingFiles(page))['model/implementations/cdm/strike-schedule-state.rosetta'])
      .toContain('func StrikeDateAtPosition:');
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^StrikeSchedule.*example.strike/ }).click();
    await page.getByRole('button', { name: 'StrikeSchedule node actions' }).click();
    await page.getByRole('button', { name: 'Import input…' }).click();
    await page.getByRole('textbox', { name: 'Import JSON data' }).fill(
      JSON.stringify({
        prices: [
          { amount: 10, currency: { value: 'USD' } },
          { amount: 10, currency: { value: 'EUR' } },
          { amount: 30, currency: { value: 'USD' } }
        ],
        dates: ['2024-03-01', '2024-01-01', '2024-02-01', '2024-04-01']
      })
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    const result = page.getByRole('region', { name: 'result output' });
    for (const date of ['2024-03-01', '2024-01-01', '2024-02-01']) await expect(result).toContainText(date);
    await expect(result).not.toContainText('2024-04-01');
    const payload = result.getByTestId('instance-payload-output');
    await payload.focus();
    await expect(payload).toBeFocused();
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await result.scrollIntoViewIfNeeded();
    await info.attach('strike-schedule', {
      body: await page.screenshot({ path: info.outputPath('strike-schedule.png') }),
      contentType: 'image/png'
    });
  });
