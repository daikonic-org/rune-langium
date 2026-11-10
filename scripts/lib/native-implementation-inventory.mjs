// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { declarationKey } from '../../packages/core/dist/references/project-contract.js';

const routes = new Set([
  'candidate',
  'data-backed',
  'primitive-backed',
  'clock-backed',
  'upstream-variants',
  'assess',
  'rune-source'
]);

/** Git hashes source bytes with the blob header, including their UTF-8 byte length. */
export function nativeSourceBlobHash(text) {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');
}

/** Catalog implementations are exclusive; references and execution evidence live outside this union. */
export function validateCatalogImplementation(entry) {
  const location = (value) =>
    value &&
    typeof value.path === 'string' &&
    /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/.test(value.path) &&
    typeof value.entrypoint === 'string' &&
    value.entrypoint.length > 0;
  const keys = (allowed) => Object.keys(entry).every((key) => allowed.includes(key));
  if (
    entry?.kind === 'rune' &&
    keys(['kind', 'path', 'entrypoint', 'origin']) &&
    location(entry) &&
    ['workspace', 'upstream'].includes(entry.origin)
  )
    return;
  if (
    entry?.kind === 'language-specific' &&
    keys(['kind', 'targets']) &&
    entry.targets &&
    Object.keys(entry.targets).length &&
    Object.entries(entry.targets).every(
      ([language, target]) =>
        ['typescript', 'python'].includes(language) &&
        location(target) &&
        typeof target.id === 'string' &&
        Array.isArray(target.dependencies) &&
        target.dependencies.every((item) => typeof item === 'string')
    )
  )
    return;
  if (entry?.kind === 'unimplemented' && keys(['kind'])) return;
  throw new Error('Implementation must be one Rune path, language-specific targets, or unimplemented.');
}

/** Resolve handwritten Java class inheritance and tests without confusing generated classes or test doubles. */
export function handwrittenJavaReferences(files, namespace, name) {
  const identities = new Set([`${namespace}.functions.${name}`, `${namespace}.${name}`]);
  const implementations = [],
    providers = [],
    tests = [];
  for (const file of files) {
    const text = file.content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const pkg = /\bpackage\s+([\w.]+)\s*;/.exec(text)?.[1];
    const imports = new Map(
      [...text.matchAll(/\bimport\s+([\w.]+)\s*;/g)].map((match) => [match[1].split('.').at(-1), match[1]])
    );
    const classMatch = /\bclass\s+(\w+)\s+extends\s+([\w.]+)/.exec(text);
    if (file.path.startsWith('rosetta-source/src/main/java/') && classMatch) {
      const parent = classMatch[2];
      const qualified = parent.includes('.') ? parent : (imports.get(parent) ?? `${pkg}.${parent}`);
      if (identities.has(qualified)) {
        const target = classMatch[1].endsWith('EmptyDataProvider') ? providers : implementations;
        target.push({ path: file.path, entrypoint: `${pkg}.${classMatch[1]}` });
      }
    }
    if (
      file.path.startsWith('rosetta-source/src/test/java/') &&
      file.path.endsWith('Test.java') &&
      (pkg === `${namespace}.functions` ||
        pkg === namespace ||
        [...imports.values()].some(
          (value) => identities.has(value) || [...identities].some((identity) => value === `${identity}Impl`)
        )) &&
      new RegExp(`\\b${name}(?:Impl|Imp)?\\b`).test(text)
    ) {
      tests.push({
        path: file.path,
        entrypoint: `${pkg}.${file.path
          .split('/')
          .at(-1)
          .replace(/\.java$/, '')}`
      });
    }
  }
  return {
    implementations,
    providers,
    tests,
    ...(!implementations.length
      ? { absence: 'No handwritten production implementation found in the pinned rosetta-source Java tree.' }
      : {})
  };
}

/** Qualitative assessments are reviewed against an exact cohort and linked signature. */
export function runeFeasibilityIndex(assessment, sources) {
  if (
    assessment.schemaVersion !== 1 ||
    JSON.stringify(assessment.sources) !== JSON.stringify(sources) ||
    !Array.isArray(assessment.functions) ||
    !Array.isArray(assessment.files)
  )
    throw new Error('Rune feasibility must describe the exact audited source cohort.');
  const files = new Set(assessment.files);
  if (
    files.size !== assessment.files.length ||
    [...files].some(
      (path) => !/^packages\/project-runtime\/src\/curated-implementations\/rune\/[a-z-]+\.rosetta$/.test(path)
    )
  )
    throw new Error('Invalid or duplicate Rune implementation source path.');
  const entries = new Map();
  for (const entry of assessment.functions) {
    if (
      !entry.symbol ||
      !['model', 'namespace', 'kind', 'name'].every(
        (key) => typeof entry.symbol[key] === 'string' && entry.symbol[key]
      ) ||
      !sources.some((source) => source.model === entry.symbol.model) ||
      !/^[a-f0-9]{64}$/.test(entry.signatureSha256) ||
      !routes.has(entry.route) ||
      typeof entry.requirements !== 'string' ||
      !entry.requirements.trim() ||
      (entry.route === 'rune-source') !== (entry.implementation !== undefined) ||
      (entry.implementation !== undefined && !files.has(entry.implementation)) ||
      (entry.implementationDispatch !== undefined &&
        (!entry.implementation ||
          !Array.isArray(entry.implementationDispatch) ||
          entry.implementationDispatch.length !== 3 ||
          !entry.implementationDispatch.every((part) => typeof part === 'string' && part.length > 0))) ||
      (entry.javaDependencies !== undefined &&
        (!Array.isArray(entry.javaDependencies) ||
          entry.javaDependencies.some(
            (reference) =>
              !/^test\/fixtures\/third-party\/[\w/-]+\.java$/.test(reference.path) ||
              reference.path.split('/').includes('..') ||
              !/^[a-f0-9]{64}$/.test(reference.sha256) ||
              !/^[\w.$]+$/.test(reference.entrypoint) ||
              !/^https:\/\/repo\.maven\.apache\.org\/maven2\/[\w./-]+\.jar$/.test(reference.sourceUrl)
          )))
    )
      throw new Error('Invalid Rune feasibility entry.');
    const key = declarationKey(entry.symbol);
    if (entries.has(key)) throw new Error('Duplicate Rune feasibility declaration.');
    entries.set(key, entry);
  }
  return {
    files: [...files].sort(),
    get(symbol, signature) {
      const entry = entries.get(declarationKey(symbol));
      if (!entry) throw new Error(`Missing Rune feasibility assessment: ${symbol.namespace}.${symbol.name}`);
      if (createHash('sha256').update(JSON.stringify(signature)).digest('hex') !== entry.signatureSha256)
        throw new Error(`Review Rune feasibility after signature drift: ${symbol.namespace}.${symbol.name}`);
      return entry;
    },
    verifyCoverage(functions) {
      const actual = new Set(functions.map(({ symbol }) => declarationKey(symbol)));
      if (
        functions.length !== actual.size ||
        actual.size !== entries.size ||
        [...entries.keys()].some((key) => !actual.has(key))
      )
        throw new Error('Rune feasibility inventory has missing or obsolete declarations.');
    }
  };
}

/** The issue table is derived from the same inventory CI verifies. */
export function renderNativeImplementationInventory(inventory) {
  const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    '<!-- native-implementation-inventory:start -->',
    '| Qualified function | Effective implementation | Handwritten Java reference | Rune route | Requirements / coverage |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const entry of inventory.functions) {
    const { model, namespace, name } = entry.symbol;
    const source = inventory.sources.find((source) => source.model === model);
    const link = `https://github.com/${source.repository}/blob/${source.commit}/${entry.source.path}`;
    validateCatalogImplementation(entry.implementation);
    const implementation = entry.implementation;
    const selected =
      implementation.kind === 'rune'
        ? `Rune: \`${escape(implementation.path)}\`${implementation.origin === 'workspace' ? ' (explicit override)' : ''}`
        : implementation.kind === 'language-specific'
          ? Object.entries(implementation.targets)
              .map(([language, target]) => `${language}: \`${escape(target.path)}#${escape(target.entrypoint)}\``)
              .join('<br>')
          : 'Unimplemented';
    const java =
      [
        ...entry.referenceJava.implementations.map(
          (reference) =>
            `[\`${escape(reference.entrypoint)}\`](https://github.com/${source.repository}/blob/${source.commit}/${reference.path})`
        ),
        ...(entry.referenceJava.dependencies ?? []).map(
          (reference) => `[\`${escape(reference.entrypoint)}\`](${reference.sourceUrl}) (dependency)`
        )
      ].join('<br>') ||
      (entry.referenceJava.providers?.length
        ? 'Empty data provider only; no handwritten algorithm'
        : 'None in pinned handwritten tree');
    const rune = entry.rune;
    let notes = escape(rune.requirements);
    if (rune.variants.length) {
      const bodies = rune.variants.filter((variant) => variant.hasRuneBody).length;
      notes += ` Upstream: ${bodies}/${rune.variants.length} selectors have bodies; default ${rune.upstreamDefaultHasBody ? 'has a body' : 'unimplemented'}. Execution evidence is separate.`;
    }
    if (entry.regressionSuite)
      notes += ` Regression suite: ${entry.regressionSuite.selectors.length ? entry.regressionSuite.selectors.length + ' body selectors, ' : ''}${entry.regressionSuite.caseCount} cases (\`${entry.regressionSuite.path}\`).`;
    lines.push(`| [\`${namespace}.${name}\`](${link}) | ${selected} | ${java} | ${escape(rune.route)} | ${notes} |`);
  }
  lines.push('<!-- native-implementation-inventory:end -->', '');
  return lines.join('\n');
}
