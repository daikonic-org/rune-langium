#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { isCuratedSourceFile, CuratedModelIdSchema } from '../packages/curated-schema/dist/index.js';
import { URI } from '../packages/core/node_modules/langium/lib/index.js';
import {
  createRuneDslServices,
  addLegacyAnnotations,
  isRosettaFunction,
  isRosettaModel,
  getElementNamespace,
  setProjectDocumentModel,
  projectDeclarationIdentity
} from '../packages/core/dist/index.js';
import { nativeFunctionShape, resolveNativeImplementation } from '../packages/codegen/dist/src/export.js';
import { openGitHubRepository } from '../packages/project-runtime/dist/repository-source.js';
const { values } = parseArgs({
  options: {
    write: { type: 'boolean' },
    sources: { type: 'string' },
    baseline: { type: 'string' },
    'cache-dir': { type: 'string' }
  }
});
const root = resolve(import.meta.dirname, '..');
const sources = JSON.parse(
  await readFile(resolve(root, values.sources ?? 'scripts/fixtures/native-implementation-sources.json'), 'utf8')
);
const cache = resolve(root, values['cache-dir'] ?? 'dist/native-implementation-audit');
const destination = resolve(root, values.baseline ?? 'docs/implementations/native-coverage.json');
const { RuneDsl } = createRuneDslServices();
const documents = [],
  origins = new Map(),
  files = [];
const hash = (text) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');
if (
  !Array.isArray(sources) ||
  !sources.length ||
  sources.length > CuratedModelIdSchema.options.length ||
  new Set(sources.map((source) => source.model)).size !== sources.length
)
  throw new Error('Choose one audited version per model.');
let sourceBytes = 0;
for (const source of sources) {
  if (
    !CuratedModelIdSchema.safeParse(source.model).success ||
    !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
    !/^[a-f0-9]{40}$/.test(source.commit)
  )
    throw new Error('Invalid inventory source identity.');
  const byBlob = new Map();
  const fetcher = (input, options) => {
    const url = String(input),
      base = `https://api.github.com/repos/${source.repository}/`;
    if (!url.startsWith(base)) throw new Error('Unexpected inventory source host.');
    const blob = /\/git\/blobs\/([a-f0-9]{40})$/.exec(url);
    if (blob) {
      const path = byBlob.get(blob[1]);
      if (!path) throw new Error('Unknown inventory blob.');
      // The shared reader still verifies its exact Git SHA and size; public raw reads avoid per-blob API quotas.
      return fetch(`https://raw.githubusercontent.com/${source.repository}/${source.commit}/${path}`, options);
    }
    const headers = new Headers(options?.headers);
    if (process.env.GITHUB_TOKEN) headers.set('Authorization', `Bearer ${process.env.GITHUB_TOKEN}`);
    return fetch(input, { ...options, headers });
  };
  const repository = await openGitHubRepository(
    source.repository,
    source.commit,
    new AbortController().signal,
    fetcher
  );
  const entries = repository.files.filter(
    (file) => file.type === 'blob' && isCuratedSourceFile(source.model, file.path)
  );
  sourceBytes += entries.reduce((sum, file) => sum + (file.size ?? 0), 0);
  if (
    entries.length + files.length > 512 ||
    sourceBytes > 16 * 1024 * 1024 ||
    entries.some((file) => file.size === undefined || file.size > 2 * 1024 * 1024)
  )
    throw new Error('Inventory source cohort exceeds its audited source budget.');
  for (const file of entries) byBlob.set(file.sha, file.path);
  let next = 0;
  const texts = Array.from({ length: entries.length });
  await Promise.all(
    Array.from({ length: Math.min(8, entries.length) }, async () => {
      for (;;) {
        const index = next++,
          file = entries[index];
        if (!file) return;
        const path = resolve(cache, source.model, source.commit, file.path);
        let text;
        try {
          text = await readFile(path, 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (text !== undefined && hash(text) !== file.sha)
          throw new Error(`Cached inventory source checksum mismatch: ${file.path}`);
        if (text === undefined) {
          text = await repository.read(file, 2 * 1024 * 1024);
          if (hash(text) !== file.sha) throw new Error('Decoded inventory text did not retain original bytes.');
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, text);
        }
        texts[index] = text;
      }
    })
  );
  for (const [index, file] of entries.entries()) {
    const origin = { model: source.model, path: file.path, blob: file.sha };
    let document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      texts[index],
      URI.parse(`file:///${source.model}/${file.path}`)
    );
    if (source.model === 'rune-dsl' && file.path.endsWith('/annotations.rosetta'))
      document = addLegacyAnnotations(document, RuneDsl.shared.workspace.LangiumDocumentFactory);
    RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
    setProjectDocumentModel(RuneDsl, document.uri, source.model);
    documents.push(document);
    origins.set(document.uri.toString(), origin);
    files.push(origin);
  }
}
await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true });
const errors = documents.flatMap((doc) => [...doc.parseResult.parserErrors, ...doc.parseResult.lexerErrors]);
if (errors.length) throw new Error(`Inventory parsing failed: ${errors[0].message}`);
const rows = [];
for (const document of documents) {
  const model = document.parseResult.value;
  if (!isRosettaModel(model)) continue;
  for (const node of model.elements.filter(isRosettaFunction)) {
    const annotations = node.annotations.filter(
      (ref) => (ref.annotation.ref?.name ?? ref.annotation.$refText) === 'codeImplementation'
    );
    if (!annotations.length) continue;
    if (
      annotations.some((ref) => !ref.annotation.ref || getElementNamespace(ref.annotation.ref) !== 'com.rosetta.model')
    )
      throw new Error('Inventory annotation identity is unresolved or foreign.');
    const signature = nativeFunctionShape(node);
    if (
      [...signature.inputs, ...(signature.output ? [signature.output] : [])].some(
        (param) => param.kind === 'unresolved'
      )
    )
      throw new Error('Inventory signature types must be linked.');
    const source = origins.get(document.uri.toString());
    const symbol = projectDeclarationIdentity(RuneDsl, node);
    if (!symbol || symbol.model !== source.model)
      throw new Error('Inventory model ownership is missing or inconsistent.');
    rows.push({
      symbol,
      source,
      signature,
      targets: Object.fromEntries(
        ['typescript', 'python'].map((target) => {
          const result = resolveNativeImplementation(node, target);
          return [
            target,
            result?.status === 'available'
              ? { status: 'available', implementation: result.id, dependencies: result.body.dependencies }
              : node.operations.length
                ? { status: 'rune-body' }
                : { status: 'unavailable', reason: result?.reason ?? 'No bundled implementation.' }
          ];
        })
      )
    });
  }
}
const key = (row) => JSON.stringify(row.symbol ?? row);
const compare = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
rows.sort(compare);
files.sort(compare);
const text = JSON.stringify({ schemaVersion: 1, sources, files, functions: rows }, null, 2) + '\n';
if (values.write) await writeFile(destination, text);
else if ((await readFile(destination, 'utf8')) !== text)
  throw new Error(
    'Native implementation inventory changed. Review source/signature/target changes, then regenerate explicitly with --write.'
  );
console.log(
  `${values.write ? 'Updated' : 'Verified'} ${rows.length} native declarations across ${documents.length} verified source files. ${rows.filter((row) => Object.values(row.targets).every((entry) => entry.status === 'available')).length} bundled for both executable targets.`
);
