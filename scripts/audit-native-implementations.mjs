#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  runeFeasibilityIndex,
  renderNativeImplementationInventory,
  nativeSourceBlobHash,
  handwrittenJavaReferences,
  validateCatalogImplementation
} from './lib/native-implementation-inventory.mjs';
import { isCuratedSourceFile, CuratedModelIdSchema } from '../packages/curated-schema/dist/index.js';
import { AstUtils, URI } from '../packages/core/node_modules/langium/lib/index.js';
import {
  createRuneDslServices,
  addLegacyAnnotations,
  isRosettaFunction,
  isRosettaModel,
  getElementNamespace,
  getEffectiveProjectDeclaration,
  namespaceOverrideDiagnostics,
  namespaceOverrideSignatureDiagnostics,
  setProjectDocumentModel,
  projectDeclarationIdentity
} from '../packages/core/dist/index.js';
import { nativeFunctionShape } from '../packages/codegen/dist/src/export.js';
import {
  selectCdmImplementation,
  NATIVE_IMPLEMENTATIONS
} from '../packages/project-runtime/dist/curated-implementations/cdm.js';
import {
  cdmCodeListResource,
  prepareCdmCodeLists
} from '../packages/project-runtime/dist/curated-implementations/code-list-resources.js';
import { openGitHubRepository } from '../packages/project-runtime/dist/repository-source.js';
const { values } = parseArgs({
  options: {
    write: { type: 'boolean' },
    sources: { type: 'string' },
    baseline: { type: 'string' },
    'cache-dir': { type: 'string' },
    feasibility: { type: 'string' },
    'issue-markdown': { type: 'string' }
  }
});
const root = resolve(import.meta.dirname, '..');
const testSuites = {
  'packages/codegen/test/implementations': {
    'cdm-dispatch': 'cdm-dispatch',
    'cdm-calculation-period': 'calculation-period',
    'cdm-frequency': 'frequency',
    'cdm-strike-schedule': 'strike-schedule',
    'cdm-rounding': 'rounding',
    'cdm-vectors': 'vectors',
    'cdm-calendar': 'calendar',
    'cdm-commodity-periods': 'commodity-periods',
    'cdm-period-range': 'period-range'
  },
  'packages/project-runtime/test': {
    'cdm-code-list-loader': 'code-list-loader',
    'cdm-strata-schedules': 'strata-schedules'
  }
};
const dispatchSuites = await Promise.all(
  Object.entries(testSuites).flatMap(([testDirectory, suites]) =>
    Object.entries(suites).map(async ([directory, testName]) => {
      const base = `test/fixtures/third-party/${directory}`;
      const manifest = JSON.parse(await readFile(resolve(root, base, 'sources.json'), 'utf8'));
      const casesPath = `${base}/cases.json`;
      const casesText = await readFile(resolve(root, casesPath), 'utf8');
      return {
        declarations: manifest.declarations,
        path: `${testDirectory}/${testName}.test.ts`,
        casesPath,
        casesText,
        cases: JSON.parse(casesText)
      };
    })
  )
);
const sources = JSON.parse(
  await readFile(resolve(root, values.sources ?? 'scripts/fixtures/native-implementation-sources.json'), 'utf8')
);
const cache = resolve(root, values['cache-dir'] ?? 'dist/native-implementation-audit');
const destination = resolve(root, values.baseline ?? 'docs/implementations/native-coverage.json');
const feasibility = runeFeasibilityIndex(
  JSON.parse(await readFile(resolve(root, values.feasibility ?? 'docs/implementations/rune-feasibility.json'), 'utf8')),
  sources
);
const { RuneDsl } = createRuneDslServices();
const documents = [],
  origins = new Map(),
  files = [],
  javaFiles = [],
  referenceFiles = [],
  resourceFiles = [],
  cdmCodeListFiles = [],
  notices = [];
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
  const references = repository.files.filter(
    (file) =>
      file.type === 'blob' &&
      (/^rosetta-source\/src\/(main|test)\/java\/.*\.java$/.test(file.path) ||
        /^(LICEN[CS]E|NOTICE)(\.md|\.txt)?$/.test(file.path))
  );
  const resources = repository.files.filter(
    (file) => source.model === 'cdm' && file.type === 'blob' && cdmCodeListResource(file.path)
  );
  const inputs = [...entries, ...references, ...resources].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
  sourceBytes += [...entries, ...resources].reduce((sum, file) => sum + (file.size ?? 0), 0);
  if (
    entries.length + files.length > 512 ||
    sourceBytes > 16 * 1024 * 1024 ||
    entries.some((file) => file.size === undefined || file.size > 2 * 1024 * 1024)
  )
    throw new Error('Inventory source cohort exceeds its audited source budget.');
  for (const file of inputs) byBlob.set(file.sha, file.path);
  let next = 0;
  const texts = Array.from({ length: inputs.length });
  await Promise.all(
    Array.from({ length: Math.min(8, inputs.length) }, async () => {
      for (;;) {
        const index = next++,
          file = inputs[index];
        if (!file) return;
        const path = resolve(cache, source.model, source.commit, file.path);
        let text;
        try {
          text = await readFile(path, 'utf8');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (text !== undefined && nativeSourceBlobHash(text) !== file.sha)
          throw new Error(`Cached inventory source checksum mismatch: ${file.path}`);
        if (text === undefined) {
          text = await repository.read(file, 2 * 1024 * 1024);
          if (nativeSourceBlobHash(text) !== file.sha)
            throw new Error('Decoded inventory text did not retain original bytes.');
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, text);
        }
        texts[index] = text;
      }
    })
  );
  for (const [index, file] of inputs.entries()) {
    const origin = { model: source.model, path: file.path, blob: file.sha };
    if (resources.includes(file)) {
      resourceFiles.push({ ...origin, sha256: createHash('sha256').update(texts[index]).digest('hex') });
      cdmCodeListFiles.push({ path: file.path, content: texts[index] });
      continue;
    }
    if (references.includes(file)) {
      const reference = { ...origin, sha256: createHash('sha256').update(texts[index]).digest('hex') };
      if (file.path.endsWith('.java')) {
        referenceFiles.push(reference);
        javaFiles.push({ ...reference, content: texts[index] });
      } else notices.push(reference);
      continue;
    }
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
const cdmCodeLists = prepareCdmCodeLists(cdmCodeListFiles);
const runeDocuments = [],
  runeSources = new Map(),
  implementationFiles = [];
for (const path of feasibility.files) {
  const content = await readFile(resolve(root, path), 'utf8');
  const uri = URI.parse(`file:///local/${path}`);
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
  RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
  setProjectDocumentModel(RuneDsl, uri, 'local');
  runeDocuments.push(document);
  runeSources.set(uri.toString(), path);
  implementationFiles.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
}
await RuneDsl.shared.workspace.DocumentBuilder.build([...documents, ...runeDocuments], { eagerLinking: true });
const errors = [...documents, ...runeDocuments].flatMap((doc) => [
  ...doc.parseResult.parserErrors,
  ...doc.parseResult.lexerErrors
]);
if (errors.length) throw new Error(`Inventory parsing failed: ${errors[0].message}`);
for (const document of runeDocuments) {
  const model = document.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Rune implementation source must be a model.');
  const diagnostics = [
    ...namespaceOverrideDiagnostics(RuneDsl, model),
    ...namespaceOverrideSignatureDiagnostics(RuneDsl, model)
  ];
  if (diagnostics.length) throw new Error(diagnostics[0].message);
  if ([...document.references].some((reference) => reference.error))
    throw new Error(`Unresolved Rune implementation reference: ${document.uri}`);
}
const functions = documents.flatMap((document) => {
  const model = document.parseResult.value;
  return isRosettaModel(model) ? model.elements.filter(isRosettaFunction) : [];
});
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
    const assessment = feasibility.get(symbol, signature);
    for (const reference of assessment.javaDependencies ?? []) {
      const bytes = await readFile(resolve(root, reference.path));
      if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256)
        throw new Error('Handwritten Java dependency checksum mismatch: ' + reference.path);
    }
    if (assessment.implementation) {
      const effective = getEffectiveProjectDeclaration(node);
      const path = effective && runeSources.get(AstUtils.getDocument(effective).uri.toString());
      if (!isRosettaFunction(effective) || !effective.operations.length || path !== assessment.implementation)
        throw new Error(`Rune implementation is not the linked override: ${symbol.namespace}.${symbol.name}`);
    }
    const variants = functions
      .filter(
        (candidate) =>
          candidate.name === node.name &&
          candidate.dispatchAttribute &&
          getElementNamespace(candidate) === symbol.namespace
      )
      .map((candidate) => ({
        selector: projectDeclarationIdentity(RuneDsl, candidate)?.dispatch,
        hasRuneBody: candidate.operations.length > 0
      }));
    const selected = selectCdmImplementation(node, cdmCodeLists);
    const hasRuneBody = node.operations.length > 0 || variants.some((variant) => variant.hasRuneBody);
    const implementation = assessment.implementation
      ? {
          kind: 'rune',
          path: assessment.implementation,
          entrypoint: `${symbol.namespace}.${symbol.name}`,
          origin: 'workspace'
        }
      : hasRuneBody
        ? { kind: 'rune', path: source.path, entrypoint: `${symbol.namespace}.${symbol.name}`, origin: 'upstream' }
        : selected?.kind === 'language-specific'
          ? {
              kind: 'language-specific',
              targets: Object.fromEntries(
                Object.entries(selected.targets).map(([language, target]) => [
                  language,
                  {
                    id: selected.id,
                    path: target.path,
                    entrypoint: target.entrypoint,
                    dependencies: target.dependencies
                  }
                ])
              )
            }
          : { kind: 'unimplemented' };
    if (
      assessment.implementation &&
      (selected?.kind !== 'rune' || !assessment.implementation.endsWith('/' + selected.path))
    )
      throw new Error('Published Rune selection differs from the reviewed effective implementation.');
    validateCatalogImplementation(implementation);
    const suite = dispatchSuites.find((suite) =>
      suite.declarations.some(
        (declaration) =>
          declaration.namespace === symbol.namespace &&
          declaration.name === symbol.name &&
          declaration.kind === symbol.kind
      )
    );
    const cases =
      suite?.cases.filter(
        (entry) => entry.function === symbol.name || (!entry.function && suite.declarations.length === 1)
      ) ?? [];
    const dispatchAttribute = functions.find(
      (candidate) =>
        candidate.name === node.name &&
        candidate.dispatchAttribute &&
        getElementNamespace(candidate) === symbol.namespace
    )?.dispatchAttribute?.$refText;
    rows.push({
      symbol,
      source,
      signature,
      implementation,
      referenceJava: {
        ...handwrittenJavaReferences(
          javaFiles.filter((file) => file.model === symbol.model),
          symbol.namespace,
          symbol.name
        ),
        ...(assessment.javaDependencies ? { dependencies: assessment.javaDependencies } : {})
      },
      rune: {
        route: assessment.route,
        requirements: assessment.requirements,
        upstreamDefaultHasBody: node.operations.length > 0,
        variants
      },
      ...(suite && cases.length
        ? {
            regressionSuite: {
              path: suite.path,
              cases: suite.casesPath,
              casesSha256: createHash('sha256').update(suite.casesText).digest('hex'),
              selectors: [
                ...new Set(
                  cases
                    .filter((entry) => !entry.expectedError)
                    .flatMap((entry) => {
                      const selector = entry.selector ?? entry.inputs?.[dispatchAttribute];
                      return selector === undefined ? [] : [selector];
                    })
                )
              ].sort(),
              caseCount: cases.length
            }
          }
        : {})
    });
  }
}
const key = (row) => JSON.stringify(row.symbol ?? row);
const compare = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
rows.sort(compare);
files.sort(compare);
const ownedPaths = new Set([
  ...implementationFiles.map((file) => file.path),
  'packages/project-runtime/src/curated-implementations/cdm.ts',
  'packages/project-runtime/src/curated-implementations/code-list-resources.ts',
  'packages/project-runtime/src/code-lists.ts',
  'packages/project-runtime/src/curated-implementations/rune/LICENSE',
  ...rows.flatMap((row) =>
    row.implementation.kind === 'language-specific'
      ? Object.values(row.implementation.targets).map((target) => target.path)
      : []
  )
]);
// Include shared target helpers, which contribute to the self-contained published bodies.
const targetDirectories = new Set(
  rows.flatMap((row) =>
    row.implementation.kind === 'language-specific'
      ? Object.values(row.implementation.targets).map((target) => dirname(target.path))
      : []
  )
);
for (const directory of targetDirectories)
  for (const file of await readdir(resolve(root, directory)))
    if (file.endsWith('.ts')) ownedPaths.add(`${directory}/${file}`);
for (const path of ownedPaths)
  if (!implementationFiles.some((file) => file.path === path)) {
    const content = await readFile(resolve(root, path), 'utf8');
    implementationFiles.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
implementationFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
feasibility.verifyCoverage(rows);
const inventory = {
  schemaVersion: 3,
  sources,
  files,
  implementationFiles,
  referenceFiles,
  notices,
  functions: rows,
  resourceFiles
};
const text = JSON.stringify(inventory, null, 2) + '\n';
if (values.write) await writeFile(destination, text);
else if ((await readFile(destination, 'utf8')) !== text)
  throw new Error(
    'Native implementation inventory changed. Review source/signature/target changes, then regenerate explicitly with --write.'
  );
if (values['issue-markdown'])
  await writeFile(resolve(values['issue-markdown']), renderNativeImplementationInventory(inventory));
console.log(
  `${values.write ? 'Updated' : 'Verified'} ${rows.length} declarations across ${documents.length} verified source files; ${NATIVE_IMPLEMENTATIONS.length} language-specific and ${rows.filter((row) => row.implementation.kind === 'rune').length} effective Rune entries (dispatch completeness is separate).`
);
