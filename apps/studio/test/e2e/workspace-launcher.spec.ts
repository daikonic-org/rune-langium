// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { fullSourceEditor } from '../helpers/source-editor.js';

for (const width of [1440, 390])
  test(`workspace launcher search, navigation and unavailable starters at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto('./');
    const launcher = page.getByTestId('workspaces-perspective');
    if (width === 390) {
      const search = page.getByRole('button', { name: /^Search types, text & files/ });
      const bounds = (await search.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(40);
      await search.click();
      await expect(page.getByRole('dialog', { name: 'Search Studio' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(search).toBeFocused();
    }
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
    for (const name of ['New workspace', 'Open folder', 'Import files…'])
      await expect(launcher.getByRole('button', { name, exact: true })).toBeVisible();
    const project = launcher.getByRole('button', { name: /Model authoring/ });
    await project.focus();
    await page.keyboard.press('Enter');
    await expect(launcher.getByRole('heading', { name: 'Model authoring', exact: true })).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'Use example', exact: true })).toBeDisabled();
    if (width === 390) {
      await launcher.getByRole('button', { name: 'Back to examples', exact: true }).click();
      await expect(project).toBeFocused();
    }
    await launcher.getByRole('textbox', { name: 'Search example projects' }).fill('missing example');
    await expect(launcher.getByRole('heading', { name: 'Model authoring', exact: true })).toBeHidden();
    await launcher.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(project).toHaveAttribute('aria-pressed', 'true');
    await launcher.getByRole('button', { name: 'Reference models', exact: true }).click();
    await expect(launcher.getByRole('heading', { name: 'Reference models', exact: true })).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'Use example', exact: true })).toBeHidden();
    await launcher.getByRole('button', { name: 'Workspaces', exact: true }).click();
    expect(await launcher.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('launcher.png') });
    await launcher.getByRole('button', { name: 'New workspace', exact: true }).click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    if (width === 390) {
      const actions = page.getByRole('button', { name: 'Workspace actions', exact: true });
      await expect(actions).toBeVisible();
      const header = page.getByTestId('app-header');
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await actions.click();
      await expect(page.getByRole('button', { name: 'Import Model', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Import Model', exact: true })).toBeHidden();
      await expect(actions).toBeFocused();
    }
    await page.getByTestId('rail-workspaces').click();
    await launcher.getByRole('button', { name: 'New workspace', exact: true }).click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-workspaces').click();
    await expect(launcher.getByTestId('workspace-row')).toHaveCount(2);
    const row = launcher.getByTestId('workspace-row').first();
    await expect(row).toContainText('Browser only');
    await expect(row).toContainText('No Git remote');
    const rename = row.getByRole('button', { name: /^Rename / });
    await rename.click();
    await row.getByRole('textbox', { name: 'Workspace name' }).fill('Bond examples');
    await row.getByRole('textbox', { name: 'Workspace name' }).press('Enter');
    await expect(row.getByRole('button', { name: 'Open Bond examples', exact: true })).toBeVisible();
    if (width === 390) {
      for (const button of [
        row.getByRole('button', { name: 'Rename Bond examples', exact: true }),
        row.getByRole('button', { name: 'Delete Bond examples', exact: true }),
        launcher.getByRole('button', { name: 'Refresh recent workspaces', exact: true })
      ]) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(await launcher.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    const nameBounds = (await row.locator('.studio-recent-workspace__name').boundingBox())!;
    expect(nameBounds.width).toBeGreaterThanOrEqual(100);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('renamed-recents.png') });
    // Tab-driven focus must have a painted outline, not merely match :focus-visible.
    await launcher.getByRole('button', { name: 'Workspaces', exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => {
        const focused = document.activeElement!;
        const style = getComputedStyle(focused);
        return { visible: focused.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth };
      })
    ).toEqual({ visible: true, style: 'solid', width: '2px' });
    await page.reload();
    await expect(page.getByTestId('app-header')).toContainText('Bond examples');
    await page.getByTestId('rail-workspaces').click();
    await expect(launcher.getByRole('button', { name: 'Open Bond examples', exact: true })).toBeVisible();
  });

test('opens checked public starter source as an editable copy with examples and no writable remote', async ({
  page
}) => {
  test.setTimeout(60000);
  const files: Record<string, string> = {
    'model/example.rosetta': 'namespace starter\ntype Money:\n amount number (1..1)\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'examples/money.example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'starter-money',
      name: 'Starter money',
      type: { model: 'local', namespace: 'starter', kind: 'Data', name: 'Money' },
      payload: 'examples/money.json',
      codec: 'json'
    }),
    'examples/money.json': JSON.stringify({ amount: 10.123456789 }),
    'README.md': '# Checked starter fixture\n'
  };
  const blobs = new Map(
    Object.entries(files).map(([path, text]) => {
      const sha = createHash('sha1')
        .update(`blob ${Buffer.byteLength(text)}\0`)
        .update(text)
        .digest('hex');
      return [sha, { path, text }];
    })
  );
  const commit = 'a'.repeat(40),
    tree = 'b'.repeat(40);
  await page.route('https://api.github.com/repos/fixture/starter/**', async (route) => {
    expect(route.request().headers()).not.toHaveProperty('authorization');
    const url = route.request().url();
    if (url.includes('/commits/')) return route.fulfill({ json: { sha: commit, commit: { tree: { sha: tree } } } });
    if (url.includes('/git/trees/'))
      return route.fulfill({
        json: {
          truncated: false,
          tree: [...blobs].map(([sha, file]) => ({
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha,
            size: Buffer.byteLength(file.text)
          }))
        }
      });
    const blob = blobs.get(url.split('/').pop()!);
    if (!blob) throw new Error('Unexpected source request');
    return route.fulfill({ body: blob.text, contentType: 'text/plain' });
  });
  await page.goto('./');
  const copied = await page.evaluate(async () => {
    const openerPath = '/src/workspace/open-starter.ts',
      sourcePath = '/src/services/starter-source.ts',
      managerPath = '/src/workspace/workspace-manager.ts',
      persistencePath = '/src/workspace/persistence.ts';
    const [opening, source, management, storage] = await Promise.all([
      import(openerPath),
      import(sourcePath),
      import(managerPath),
      import(persistencePath)
    ]);
    const manager = new management.WorkspaceManager({
      opfsRoot: await navigator.storage.getDirectory(),
      tabId: 'starter-fixture',
      studioVersion: 'test'
    });
    const starter = {
      id: 'fixture',
      name: 'Checked starter',
      description: 'Fixture',
      repository: 'fixture/starter',
      ref: 'v1',
      examples: ['Money'],
      requiredCapabilities: [],
      status: 'available'
    };
    const result = await opening.createStarterOpener({
      source: source.readStarterSource,
      create: (input: unknown) => opening.createStarterWorkingCopy(manager, input)
    })({ starter, signal: new AbortController().signal });
    await manager.close(result.workspaceId);
    return storage.loadWorkspace(result.workspaceId);
  });
  expect(copied.kind).toBe('browser-only');
  expect(copied).not.toHaveProperty('gitBacking');
  expect(copied.starterProvenance).toEqual({ repository: 'fixture/starter', commit });
  const launcher = page.getByTestId('workspaces-perspective');
  await launcher.getByRole('button', { name: 'Refresh recent workspaces' }).click();
  await launcher.getByRole('button', { name: 'Open Checked starter', exact: true }).click();
  await page.getByTestId('ns-type-link-starter.Money#Data').click();
  await page.getByTestId('rail-prototype').click();
  const row = page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Starter money' });
  await expect(row).toContainText('saved');
  await row.click();
  await expect(
    page.getByRole('region', { name: 'input fields', exact: true }).getByLabel('Amount', { exact: true })
  ).toHaveValue('10.123456789');
});

test('opens a native folder, saves source through guarded project IO and reopens without replacing metadata', async ({
  page
}) => {
  test.setTimeout(60000);
  await page.goto('./');
  const source = 'namespace folder\ntype Money:\n amount number (1..1)\n';
  await page.evaluate(async (source) => {
    const folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('launcher-native-fixture', { create: true });
    const model = await folder.getDirectoryHandle('model', { create: true });
    for (const [root, name, text] of [
      [model, 'example.rosetta', source],
      [folder, 'studio-config.yml', 'schemaVersion: 1\n']
    ] as const) {
      const stream = await (await root.getFileHandle(name, { create: true })).createWritable();
      await stream.write(text);
      await stream.close();
    }
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => folder });
  }, source);
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.getByTestId('ns-type-link-folder.Money#Data').click();
  const toggle = page.getByRole('button', { name: 'Source', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const content = fullSourceEditor(page).locator('.cm-content');
  await content.click();
  await content.press('ControlOrMeta+A');
  await page.keyboard.insertText(source + '// Edited in Studio\n');
  await content.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('launcher-native-fixture');
        return (
          await (await (await folder.getDirectoryHandle('model')).getFileHandle('example.rosetta')).getFile()
        ).text();
      })
    )
    .toContain('Edited in Studio');
  await page.reload();
  await page.getByTestId('ns-type-link-folder.Money#Data').click();
  expect(
    await page.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('launcher-native-fixture');
      return (await (await folder.getFileHandle('studio-config.yml')).getFile()).text();
    })
  ).toBe('schemaVersion: 1\n');
});
