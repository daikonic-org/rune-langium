// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function files(page: Page, editPom = false) {
  return page.evaluate(async (editPom) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fixture-clone');
    const dir = await root.getDirectoryHandle('files');
    if (editPom) {
      const handle = await dir.getFileHandle('pom.xml');
      const original = await (await handle.getFile()).text();
      const stream = await handle.createWritable();
      await stream.write(original + '\n<!-- external -->');
      await stream.close();
    }
    const result: Record<string, string> = {};
    for await (const [name, entry] of dir.entries())
      if (entry.kind === 'file') result[name] = await (await entry.getFile()).text();
    for (const name of ['HEAD', 'config'])
      result['.git/' + name] = await (
        await (await (await root.getDirectoryHandle('.git')).getFileHandle(name)).getFile()
      ).text();
    return result;
  }, editPom);
}
async function openReview(page: Page) {
  await page.route('**/device-init', (route) =>
    route.fulfill({
      json: {
        device_code: 'fixture',
        user_code: 'TEST-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      }
    })
  );
  await page.route('**/device-poll', (route) =>
    route.fulfill({ json: { access_token: 'fixture-only', scope: 'repo' } })
  );
  await page.goto('/test/fixtures/project-initialization.html');
  await page.getByRole('button', { name: 'Open GitHub', exact: true }).click();
  await page.getByRole('button', { name: /check now/i }).click();
  await page.getByTestId('repo-url-input').fill('example/rates');
  await page.getByTestId('repo-branch-input').fill('release');
  await page.getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Initialize project settings' })).toBeEnabled();
}
for (const width of [1461, 700, 390])
  test('reviews and saves native initialization at ' + width + 'px', async ({ page }, info) => {
    await page.setViewportSize({ width, height: 988 });
    await openReview(page);
    const original = await files(page);
    expect(Object.keys(original).sort()).toEqual(['.git/HEAD', '.git/config', 'pom.xml']);
    await expect(page.getByRole('region', { name: 'Review detected project settings' })).toContainText('unsupported');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(result.violations).toEqual([]);
    await info.attach('initialization-review-' + width, {
      body: await page.screenshot({ path: info.outputPath('review-' + width + '.png') }),
      contentType: 'image/png'
    });
    await page.getByRole('button', { name: 'Initialize project settings' }).click();
    await expect(page.getByText('Opened fixture-clone', { exact: true })).toBeVisible();
    const saved = await files(page);
    expect(saved['build-config.yml']).toBeDefined();
    expect(saved['pom.xml']).toBe(original['pom.xml']);
    expect(saved['.git/HEAD']).toBe('ref: refs/heads/release\n');
    expect(saved['.git/config']).toBe('https://github.com/example/rates.git');
  });
test('keeps a cloned project and review after stale-POM conflict', async ({ page }) => {
  await openReview(page);
  const newer = await files(page, true);
  await page.getByRole('button', { name: 'Initialize project settings' }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  expect(await files(page)).toEqual(newer);
  await expect(page.getByText('build-config.yml', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep browsing' }).click();
  await expect(page.getByText('Opened fixture-clone', { exact: true })).toBeVisible();
  expect(await files(page)).toEqual(newer);
});

test('re-reviews changed POM bytes and saves the new proposal without recloning', async ({ page }) => {
  await openReview(page);
  const newer = await files(page, true);
  await page.getByRole('button', { name: 'Initialize project settings' }).click();
  await expect(page.getByRole('alert')).toContainText('changed');
  await page.getByRole('button', { name: 'Review profiles' }).click();
  await expect(page.getByRole('button', { name: 'Initialize project settings' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Initialize project settings' }).click();
  await expect(page.getByText('Opened fixture-clone', { exact: true })).toBeVisible();
  const saved = await files(page);
  expect(saved['pom.xml']).toBe(newer['pom.xml']);
  expect(saved['build-config.yml']).toBeDefined();
  expect(saved['.git/config']).toBe(newer['.git/config']);
});
