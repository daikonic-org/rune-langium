// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';
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
import { roundingDirectory, roundingCaller } from '../../../../test/helpers/cdm-rounding.js';
import { vectorDirectory, vectorCaller } from '../../../../test/helpers/cdm-vectors.js';
import { periodRangeDirectory, periodRangeCaller } from '../../../../test/helpers/cdm-period-range.js';
import { calendarDirectory, calendarCaller } from '../../../../test/helpers/cdm-calendar.js';
import { commodityPeriodsCaller, commodityPeriodsDirectory } from '../../../../test/helpers/cdm-commodity-periods.js';

async function openPublishedImplementationProject(
  page: Page,
  directory: string,
  caller: { uri: string; content: string },
  width: number
) {
  const project = await createCuratedRuneProject(directory, caller);
  await page.route('https://www.daikonic.dev/curated/**', async (route) => {
    const bytes = project.fixture.artifacts.get(route.request().url());
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
    name: caller.uri.split('/').at(-1)!,
    buffer: Buffer.from(caller.content.split('\n', 1)[0] + '\n'),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
  await page.getByTestId('rail-prototype').click();
  return project;
}

for (const width of [1440, 390])
  test(`executes calendar implementations delivered with the curated bundle at ${width}px`, async ({ page }, info) => {
    await openPublishedImplementationProject(page, calendarDirectory, calendarCaller, width);
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
    await page.getByRole('button', { name: /^Choose a function:/ }).click();
    await page.getByRole('option', { name: 'AdjustWeekend — example.calendar', exact: true }).click();
    await page.getByLabel('Value', { exact: true }).fill('2024-08-31');
    await page.getByRole('combobox', { name: 'Convention', exact: true }).click();
    await page.getByRole('option', { name: 'MODFOLLOWING', exact: true }).click();
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'adjusted output' })).toContainText('2024-08-30');
    await page.getByRole('button', { name: /^Choose a function:/ }).click();
    await page.getByRole('option', { name: 'AdjustWeekendList — example.calendar', exact: true }).click();
    await page.getByLabel('Value', { exact: true }).fill('2024-08-31');
    await page.getByRole('combobox', { name: 'Convention', exact: true }).click();
    await page.getByRole('option', { name: 'MODFOLLOWING', exact: true }).click();
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'adjusted output' })).toContainText('"2024-08-30"');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await info.attach('rune-calendar-workflow', {
      body: await page.screenshot({ path: info.outputPath('rune-calendar.png') }),
      contentType: 'image/png'
    });
  });

test('executes a published commodity period implementation through Prototype', async ({ page }, info) => {
  const project = await openPublishedImplementationProject(
    page,
    commodityPeriodsDirectory,
    commodityPeriodsCaller,
    1440
  );
  expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([]);
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /^MonthlyCommodityBoundaries.*example.commodity/ }).click();
  await page.getByLabel('Start Date', { exact: true }).fill('2024-01-31');
  await page.getByLabel('End Date', { exact: true }).fill('2024-04-01');
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled();
  await execute.click();
  const output = page.getByRole('region', { name: 'boundaries output' });
  await expect(output).toContainText(/"2024-01-31"[\s\S]*"2024-02-29"[\s\S]*"2024-03-29"[\s\S]*"2024-04-29"/);
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await info.attach('commodity-periods', {
    body: await page.screenshot({ path: info.outputPath('commodity-periods.png') }),
    contentType: 'image/png'
  });
});

for (const width of [1440, 390])
  test(`executes decimal vector operations and cumulative growth from a curated bundle at ${width}px`, async ({
    page
  }, info) => {
    const project = await createCuratedRuneProject(vectorDirectory, vectorCaller);
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
      name: 'vectors.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace example.vectors\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^VectorExample.*example.vectors/ }).click();
    const form = page.getByTestId('prototype-perspective').getByTestId('panel-formPreview');
    const mode = form.getByRole('combobox', { name: 'Arithmetic Op', exact: true });
    await mode.click();
    await page.getByRole('option', { name: 'Divide', exact: true }).click();
    await form.getByRole('spinbutton', { name: 'Left Value', exact: true }).fill('1');
    await form.getByRole('spinbutton', { name: 'Right Value', exact: true }).fill('3');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    const result = page.getByRole('region', { name: 'result output' });
    await expect(result).toContainText('0.3333333333');
    await mode.click();
    await page.getByRole('option', { name: 'Add', exact: true }).click();
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('4');
    await expect(result).toContainText('3');
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^GrowthExample.*example.vectors/ }).click();
    await form.getByRole('spinbutton', { name: 'Base Value', exact: true }).fill('1');
    await form.getByRole('spinbutton', { name: 'First Factor', exact: true }).fill('1.1');
    await form.getByRole('spinbutton', { name: 'Second Factor', exact: true }).fill('1.1');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('1.21');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await result.scrollIntoViewIfNeeded();
    await info.attach('decimal-vectors', {
      body: await page.screenshot({ path: info.outputPath('decimal-vectors.png') }),
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
  test(`builds a calculation period range from a curated Rune override at ${width}px`, async ({ page }, info) => {
    const project = await createCuratedRuneProject(periodRangeDirectory, periodRangeCaller);
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
      name: 'period-range.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace example.periodrange\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^BuildPeriodRange.*example.periodrange/ }).click();
    const form = page.getByTestId('prototype-perspective').getByTestId('panel-formPreview');
    const startDate = form.getByLabel('Start Date', { exact: true });
    await startDate.fill('2023-12-30');
    await form.getByLabel('End Date', { exact: true }).fill('2024-01-02');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    const output = page.getByRole('region', { name: 'result output' });
    await expect(output).toContainText(/"daysInPeriod":\s*3/);
    await expect(output).toContainText(/"daysInLeapYearPeriod":\s*1/);
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await output.scrollIntoViewIfNeeded();
    await info.attach('period-range', {
      body: await page.screenshot({ path: info.outputPath('period-range.png') }),
      contentType: 'image/png'
    });
    await startDate.fill('2024-01-03');
    await execute.click();
    await expect(output).toContainText('OrderedDates');
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

for (const width of [1440, 390])
  test(`rounds decimal ties, increments and significant figures using published native bodies at ${width}px`, async ({
    page
  }, info) => {
    const project = await createCuratedRuneProject(roundingDirectory, roundingCaller);
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
      name: 'rounding.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace example.rounding\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, Object.fromEntries(project.snapshot.files));
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^RoundQuote(?!To).*example.rounding/ }).click();
    const form = page.getByTestId('prototype-perspective').getByTestId('panel-formPreview');
    const value = form.getByRole('spinbutton', { name: 'Value', exact: true });
    const precision = form.getByRole('spinbutton', { name: 'Precision', exact: true });
    const mode = form.getByRole('combobox', { name: 'Rounding Mode', exact: true });
    await value.fill('1.005');
    await precision.fill('2');
    await mode.click();
    await page.getByRole('option', { name: 'Nearest', exact: true }).click();
    await form.getByRole('checkbox', { name: 'Remove Trailing Zeros', exact: true }).check();
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    const result = page.getByRole('region', { name: 'result output' });
    await expect(result).toContainText('1.01');
    await value.fill('-1.005');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('-1.01');
    await precision.fill('-1');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('NonNegativePrecision');

    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^RoundQuoteToNearest.*example.rounding/ }).click();
    await value.fill('-166.5');
    const increment = form.getByRole('spinbutton', { name: 'Nearest', exact: true });
    await increment.fill('50');
    await mode.click();
    await expect(page.getByRole('option', { name: 'Nearest', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Up', exact: true }).click();
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('-200');
    await value.fill('1');
    await increment.fill('3');
    await execute.click();
    await expect(result).toContainText('Non-terminating decimal');
    await increment.fill('0');
    await execute.click();
    await expect(result).toContainText('PositiveNearest');

    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^RoundQuoteToSignificantFigures.*example.rounding/ }).click();
    await value.fill('1023.123456789');
    const figures = form.getByRole('spinbutton', { name: 'Significant Figures', exact: true });
    await figures.fill('5');
    await mode.click();
    await page.getByRole('option', { name: 'Up', exact: true }).click();
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(result).toContainText('1023.2');
    await figures.fill('0');
    await execute.click();
    await expect(result).toContainText('NonZeroSignificantFigures');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await result.scrollIntoViewIfNeeded();
    await info.attach('decimal-rounding', {
      body: await page.screenshot({ path: info.outputPath('decimal-rounding.png') }),
      contentType: 'image/png'
    });
  });
