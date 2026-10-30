// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles, seedProjectBackingFiles } from './project-backing.js';
import { dismissLocalTransportNotices } from './expression-workspace.js';

import { reloadJourney, type JourneyObserver } from './journey-observer.js';

export async function checkWorkspaceSettings(page: Page, theme: string, observer: JourneyObserver = {}): Promise<void> {
  const restorationErrors: string[] = [];
  const collectRestorationErrors = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() === 'error' && message.text().includes('Failed to load instances from OPFS'))
      restorationErrors.push(message.text());
  };
  page.on('console', collectRestorationErrors);
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  const source = 'namespace settings\nversion "1.0.0"\ntype Money:\n amount number (1..1)\n';
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'money.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(
    page,
    {
      'money.rosetta': source,
      'rune-config.yml': 'model: {name: Workspace settings}\n',
      'build-config.yml':
        'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets:\n  types: {generator: typescript, output: generated/types}\n',
      'studio-config.yaml':
        '# Shared folders\nschemaVersion: 1\nexamples: examples # input examples\ncustom: retained\n',
      'workspace-examples/saved.example.json': JSON.stringify({
        schemaVersion: 1,
        id: 'saved',
        name: 'Saved settings example',
        type: { model: 'local', namespace: 'settings', name: 'Money', kind: 'Data' },
        codec: 'JSON',
        payload: 'workspace-examples/saved.json'
      }),
      'workspace-examples/saved.json': '{"amount":21}\n'
    },
    observer
  );
  await page.getByTestId('rail-settings').click();
  await dismissLocalTransportNotices(page);
  const settings = page.getByTestId('settings-perspective');
  await settings.getByLabel('Theme', { exact: true }).selectOption(theme);
  await expect(settings.getByText('Workspace configuration', { exact: true })).toBeVisible();
  const examples = settings.getByLabel('Examples', { exact: true });
  await expect(examples).toHaveAttribute('data-slot', 'input');
  await expect(examples).toHaveValue('examples');
  await expect(settings.getByRole('button', { name: 'Save workspace settings', exact: true })).toBeDisabled();
  await examples.fill('workspace-examples');
  await settings.getByRole('button', { name: 'Save workspace settings', exact: true }).click();
  await expect(settings.getByText('Workspace settings saved.', { exact: true })).toBeVisible();
  const saved = await projectBackingFiles(page);
  expect(saved['studio-config.yaml']).toContain('examples: workspace-examples # input examples');
  expect(saved['studio-config.yaml']).toContain('# Shared folders');
  expect(saved['studio-config.yaml']).toContain('custom: retained');
  expect(saved['studio-config.yml']).toBeUndefined();
  await observer.checkpoint?.(`workspace-settings-${theme}`);
  expect((await new AxeBuilder({ page }).include('[data-testid="settings-perspective"]').analyze()).violations).toEqual(
    []
  );
  await examples.fill('');
  await expect(settings.getByRole('button', { name: 'Save workspace settings', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Reload settings', exact: true }).click();
  await expect(examples).toHaveValue('workspace-examples');
  await reloadJourney(page, observer);
  await page.getByTestId('rail-settings').click();
  await expect(settings.getByLabel('Theme', { exact: true })).toHaveValue(theme);
  await expect(examples).toHaveValue('workspace-examples');
  await settings.getByRole('button', { name: 'Manage references', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reference models', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page
    .getByRole('navigation', { name: 'Project launcher' })
    .getByRole('button', { name: 'Workspaces', exact: true })
    .click();
  await expect(page.getByRole('list', { name: 'Example projects' })).not.toContainText(/[a-f0-9]{40}/);
  await page.getByTestId('rail-settings').click();
  await settings.getByRole('button', { name: 'Configure exports', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'types', exact: true })).toBeVisible();
  await page.getByTestId('rail-prototype').click();
  await expect(
    page.getByTestId('prototype-grid').locator('tbody tr').filter({ hasText: 'Saved settings example' })
  ).toContainText('saved');
  expect((await projectBackingFiles(page))['workspace-examples/saved.json']).toBe('{"amount":21}\n');
  await observer.checkpoint?.('saved-example-restored');
  page.off('console', collectRestorationErrors);
  expect(restorationErrors).toEqual([]);
}
