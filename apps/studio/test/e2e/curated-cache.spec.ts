// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { URI } from 'langium';

const namespace = 'cached.example';
const bundleId = 'cdm';
const key = (ns: string) =>
  JSON.stringify([bundleId, `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-10-aaaaaaaaaaaa/ns/${ns}.json.gz`]);
const source = 'namespace cached.example\nimport cached.base.*\n\ntype Example extends Base:\n  count int (0..1)\n';

async function fixtures() {
  const { RuneDsl } = createRuneDslServices();
  const files = [
    { name: 'base', namespace: 'cached.base', content: 'namespace cached.base\n\ntype Base:\n  value string (1..1)\n' },
    { name: 'example', namespace, content: source }
  ];
  const documents = files.map((file) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(file.content, URI.parse(`cdm/${file.name}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents);
  expect(documents.flatMap((doc) => doc.diagnostics ?? [])).toEqual([]);
  return documents.map((doc, i) => ({
    uri: `cdm/${files[i]!.name}.rosetta`,
    content: '',
    sourceLoaded: false,
    serializedModel: serializeRuneModel(RuneDsl.serializer.JsonSerializer, doc.parseResult.value),
    exports: [{ type: 'Data', name: i === 0 ? 'Base' : 'Example', path: '/elements@0' }],
    bundleId,
    namespace: files[i]!.namespace,
    artifactKey: key(files[i]!.namespace)
  }));
}

async function load(page: Page) {
  return page.evaluate(
    async ({ namespace, artifactKey }) => {
      const modulePath = '/src/services/workspace.ts';
      const workspace = await import(modulePath);
      const result = await workspace.parseWorkspaceViaRouter([], {
        curatedBundles: [{ id: 'cdm', version: 'latest' }],
        hydrateNamespaces: [namespace],
        requireCuratedHydration: true
      });
      const linked = await workspace.linkDocument('cdm/example.rosetta');
      const linkedBase = await workspace.linkDocument('cdm/base.rosetta');
      const loadedSource = await workspace.loadCuratedNamespaceSource('cdm', 'latest', namespace, artifactKey);
      return {
        linked: linked.linked && linkedBase.linked,
        errors: [...linked.errors, ...linkedBase.errors],
        paths: result.curatedRefOnlyFiles.cdm.map((file: { path: string }) => file.path),
        source: loadedSource.documents
      };
    },
    { namespace, artifactKey: key(namespace) }
  );
}

async function serveArtifacts(context: BrowserContext, documents: Awaited<ReturnType<typeof fixtures>>) {
  const requests: Array<{ known: string[]; returned: number }> = [];
  let sourceRequests = 0;
  await context.route('**/api/parse', async (route) => {
    const body = route.request().postDataJSON();
    const required = body.hydrateNamespaces?.includes(namespace);
    const known = body.knownCuratedArtifacts ?? [];
    const selected = required ? documents.filter((doc) => !known.includes(doc.artifactKey)) : [];
    if (required) requests.push({ known, returned: selected.length });
    await route.fulfill({
      json: {
        ok: true,
        models: [],
        errors: {},
        deferredExports: [],
        hydrationState: { documents: selected },
        requiredCuratedArtifacts: required
          ? documents.map((doc) => ({ key: doc.artifactKey, bundleId, namespace: doc.namespace, documentCount: 1 }))
          : []
      }
    });
  });
  await context.route('**/api/curated-source', async (route) => {
    sourceRequests++;
    await route.fulfill({
      json: { artifactKey: key(namespace), documents: [{ uri: 'cdm/example.rosetta', content: source }] }
    });
  });
  return { requests, sourceRequestCount: () => sourceRequests };
}

test('curated JSON and selected source survive reloads and are reusable in another tab', async ({ page, context }) => {
  const documents = await fixtures();
  const { requests, sourceRequestCount } = await serveArtifacts(context, documents);

  await page.goto('./');
  const first = await load(page);
  expect(first).toMatchObject({
    linked: true,
    errors: [],
    paths: ['base.rosetta', 'example.rosetta'],
    source: [{ uri: 'cdm/example.rosetta', content: source }]
  });
  await page.reload();
  expect(await load(page)).toEqual(first);
  const otherTab = await context.newPage();
  await otherTab.goto('./');
  expect(await load(otherTab)).toEqual(first);
  await otherTab.close();

  expect(requests.map((request) => request.returned)).toEqual([2, 0, 0]);
  expect(requests[0]!.known).toEqual([]);
  expect(requests[1]!.known.sort()).toEqual(documents.map((doc) => doc.artifactKey).sort());
  expect(requests[2]!.known.sort()).toEqual(requests[1]!.known);
  expect(sourceRequestCount()).toBe(1);
});

test('a lost persisted payload causes a normal refetch and preserves cross-namespace linking', async ({
  page,
  context
}) => {
  const documents = await fixtures();
  const { requests } = await serveArtifacts(context, documents);
  await page.goto('./');
  const first = await load(page);
  await page.evaluate(async (artifactKey) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rune-curated-artifacts', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('payloads', 'readwrite');
        tx.objectStore('payloads').delete(JSON.stringify(['documents', artifactKey]));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  }, key(namespace));
  await page.reload();
  expect(await load(page)).toEqual(first);
  expect(requests.map((request) => request.returned)).toEqual([2, 0, 2]);
});

for (const { poisonedNamespace, serializedModel } of [
  { poisonedNamespace: namespace, serializedModel: '{broken' },
  { poisonedNamespace: 'cached.base', serializedModel: '{broken' },
  { poisonedNamespace: namespace, serializedModel: '{"$type":"Data","name":"WrongRoot","attributes":[]}' }
]) {
  test(`a corrupt deferred model ${serializedModel} in ${poisonedNamespace} is evicted and refetched on first link`, async ({
    page,
    context
  }) => {
    const documents = await fixtures();
    const { requests } = await serveArtifacts(context, documents);
    await page.goto('./');
    const first = await load(page);
    await page.evaluate(
      async ({ document, serializedModel }) => {
        const modulePath = '/src/services/curated-artifact-cache.ts';
        const { curatedArtifactCache } = await import(modulePath);
        await curatedArtifactCache.putDocuments(document.artifactKey, [{ ...document, serializedModel }]);
      },
      { document: documents.find((doc) => doc.namespace === poisonedNamespace)!, serializedModel }
    );
    await page.reload();
    expect(await load(page)).toEqual(first);
    await page.reload();
    expect(await load(page)).toEqual(first);
    expect(requests.map((request) => request.returned)).toEqual([2, 0, 2, 0]);
  });
}
