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
    [...files].some((path) => !/^examples\/implementations\/cdm\/[a-z-]+\.rosetta$/.test(path))
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
      (entry.implementation !== undefined && !files.has(entry.implementation))
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
    '| Qualified function | TS fallback | Python fallback | Rune route | Requirements / source |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const entry of inventory.functions) {
    const { model, namespace, name } = entry.symbol;
    const source = inventory.sources.find((source) => source.model === model);
    const link = `https://github.com/${source.repository}/blob/${source.commit}/${entry.source.path}`;
    const target = (language) => {
      const status = entry.targets[language].status;
      if (status === 'available') return 'Bundled';
      if (status === 'rune-body') return 'Rune body';
      if (status === 'unavailable') return 'Missing';
      throw new Error(`Unknown implementation status: ${status}`);
    };
    const rune = entry.rune;
    let notes = escape(rune.requirements);
    if (rune.implementation) notes += ` Source: \`${escape(rune.implementation)}\` (explicit override).`;
    if (rune.variants.length) {
      const bodies = rune.variants.filter((variant) => variant.hasRuneBody).length;
      notes += ` Upstream: ${bodies}/${rune.variants.length} selectors have bodies; closure execution is separate.`;
    }
    lines.push(
      `| [\`${namespace}.${name}\`](${link}) | ${target('typescript')} | ${target('python')} | ${escape(rune.route)} | ${notes} |`
    );
  }
  lines.push('<!-- native-implementation-inventory:end -->', '');
  return lines.join('\n');
}
