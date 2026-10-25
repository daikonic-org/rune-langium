// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type BrowserContext } from '@playwright/test';
import { URI } from 'langium';
import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { declarationDocuments } from './curated-declaration-fixture.js';
export async function serveCuratedDeclarations(
  context: BrowserContext,
  sources: readonly (readonly [string, string])[]
) {
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
