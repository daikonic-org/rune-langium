// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { URI } from 'langium';
import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const sources = [
  ['terms', 'namespace example.terms\ntype Terms:\n amount number (1..1)\n'],
  [
    'functions',
    'namespace example.functions\nimport example.terms.*\nfunc External:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n'
  ]
] as const;

async function serve(context: BrowserContext) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  const documents = (await declarationDocuments(sources)).map((doc) => ({
    ...doc,
    artifactKey: JSON.stringify([
      'cdm',
      `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-18-aaaaaaaaaaaa/ns/${doc.namespace}.json.gz`
    ])
  }));
  await context.route('**/api/parse', async (route) => {
    const body = route.request().postDataJSON();
    const files: Array<{ name: string; content: string }> = body.files ?? [];
    const { RuneDsl } = createRuneDslServices();
    const curated = sources.map(([name, source]) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`file:///[cdm]/${name}.rosetta`))
    );
    const users = files.map((file) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        file.content,
        URI.parse(`file:///workspace/${file.name}`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([...curated, ...users]);
    const required =
      body.hydrateNamespaces?.length || files.some((file) => file.content.includes('import example.')) ? documents : [];
    const userDocuments = users.map((doc, i) => ({
      uri: files[i]!.name,
      content: files[i]!.content,
      serializedModel: serializeRuneModel(RuneDsl.serializer.JsonSerializer, doc.parseResult.value),
      exports: []
    }));
    await route.fulfill({
      json: {
        ok: true,
        models: [],
        errors: {},
        deferredExports: documents.map((doc) => ({
          namespace: doc.namespace,
          filePath: doc.uri,
          exports: doc.exports.map((entry) => ({ ...entry, name: entry.name.split('.').at(-1) }))
        })),
        hydrationState: {
          documents: [
            ...userDocuments,
            ...required.filter((doc) => !(body.knownCuratedArtifacts ?? []).includes(doc.artifactKey))
          ]
        },
        requiredCuratedArtifacts: required.map((doc) => ({
          key: doc.artifactKey,
          bundleId: 'cdm',
          namespace: doc.namespace,
          documentCount: 1
        }))
      }
    });
  });
  await context.route('**/api/curated-source', async (route) => {
    const body = route.request().postDataJSON();
    const document = documents.find((doc) => doc.namespace === body.namespace)!;
    expect(body.expectedArtifactKey).toBe(document.artifactKey);
    const source = sources.find(([, text]) => text.startsWith(`namespace ${body.namespace}\n`))![1];
    await route.fulfill({
      json: { artifactKey: document.artifactKey, documents: [{ uri: document.uri, content: source }] }
    });
  });
}

for (const mode of ['modify', 'extend'] as const)
  test(`${mode} creates a persistent editable declaration from the Inspector title`, async ({
    page,
    context
  }, info) => {
    test.setTimeout(60000);
    await serve(context);
    await page.setViewportSize({ width: 1461, height: 988 });
    await page.goto('./');
    await page.getByRole('button', { name: 'New blank workspace', exact: true }).click();
    await page.getByTestId('rail-workspaces').click();
    await page.getByTestId('model-loader').getByRole('button', { name: /CDM/ }).first().click();
    await page.getByTestId('rail-explore').click();
    const original = mode === 'modify' ? 'example.functions.External' : 'example.terms.Terms';
    const kind = mode === 'modify' ? 'RosettaFunction' : 'Data';
    await page.getByTestId('namespace-search').fill(mode === 'modify' ? 'External' : 'Terms');
    await typeNavigationButton(page, original, kind).click();
    const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
    if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
    const title = page.locator('[data-pane="inspector"] [data-slot="type-header"]');
    const action = title.getByRole('button', { name: mode === 'modify' ? 'Modify local copy' : 'Extend declaration' });
    await expect(action).toBeEnabled({ timeout: 20000 });
    for (const width of [960, 1280, 1461]) {
      await page.setViewportSize({ width, height: 988 });
      await expect
        .poll(async () => {
          const bounds = (await title.boundingBox())!;
          const overflowing: string[] = [];
          for (const control of await title.getByRole('button').all()) {
            const box = (await control.boundingBox())!;
            if (box.x < bounds.x - 1 || box.x + box.width > bounds.x + bounds.width + 1)
              overflowing.push((await control.getAttribute('aria-label')) ?? 'control');
          }
          return overflowing;
        })
        .toEqual([]);
    }
    await action.click();
    const dialog = page.getByRole('dialog', {
      name: mode === 'modify' ? 'Modify External' : 'Extend Terms',
      exact: true
    });
    await dialog.getByLabel('Local namespace').fill('local.test');
    await dialog
      .getByRole('button', { name: mode === 'modify' ? 'Create local copy' : 'Create extension', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const sourcePane = page.locator('[data-pane="source"] .cm-content');
    await expect(sourcePane).toContainText('namespace local.test', { timeout: 20000 });
    await expect(title.getByText('local.test', { exact: true })).toBeVisible();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toHaveCount(0);
    if (mode === 'extend') {
      await expect(sourcePane).toContainText('type TermsExtension extends example.terms.Terms:');
      await expect(page.locator('[data-pane="inspector"]').getByText('inherited from Terms')).toBeVisible();
    } else {
      const bodyEditor = page.getByTestId('implementation-editor').locator('.cm-content');
      await expect(bodyEditor).toBeVisible();
      await bodyEditor.click();
      await bodyEditor.press('ControlOrMeta+A');
      await page.keyboard.insertText('set result: terms -> amount * 2');
      await bodyEditor.press('Tab');
      await expect(sourcePane).toContainText('set result: terms -> amount * 2');
      await dismissLocalTransportNotices(page);
      expect((await new AxeBuilder({ page }).include('[data-pane="inspector"]').analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath('local-implementation.png') });
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: 'Choose a function', exact: true }).click();
      await page.getByRole('option', { name: /External.*local.test/ }).click();
      const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true });
      await expect(amount).toBeVisible({ timeout: 20000 });
      await amount.fill('12');
      await amount.press('Tab');
      const execute = page.getByRole('button', { name: 'Execute', exact: true });
      await expect(execute).toBeEnabled();
      await execute.click();
      await expect(page.getByRole('region', { name: 'result output' })).toContainText('24');
    }
    await page.reload();
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill(mode === 'modify' ? 'External' : 'TermsExtension');
    await typeNavigationButton(page, `local.test.${mode === 'modify' ? 'External' : 'TermsExtension'}`, kind).click();
    if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
    await expect(title.getByText('local.test', { exact: true })).toBeVisible();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toHaveCount(0);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('local-declaration-restored.png') });
    await page.getByTestId('namespace-search').fill(mode === 'modify' ? 'External' : 'Terms');
    await typeNavigationButton(page, original, kind).click();
    await expect(title.getByRole('button', { name: 'Modify local copy' })).toBeEnabled();
    await expect(title.getByText('Reference Only', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('curated-title-actions.png') });
  });
