// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runeFeasibilityIndex, renderNativeImplementationInventory } from './native-implementation-inventory.mjs';

const sources = [{ model: 'cdm', repository: 'finos/common-domain-model', commit: 'a'.repeat(40), release: '7.9.0' }];
const symbol = { model: 'cdm', namespace: 'cdm.example', kind: 'RosettaFunction', name: 'Compute' };
const signature = { inputs: [] };
const entry = {
  symbol,
  signatureSha256: createHash('sha256').update(JSON.stringify(signature)).digest('hex'),
  route: 'data-backed',
  requirements: 'Select supplied data | keep\nerrors explicit.'
};
const assessment = () => ({ schemaVersion: 1, sources, files: [], functions: [entry] });

test('binds reviewed feasibility to the exact cohort, model identity and linked signature', () => {
  const index = runeFeasibilityIndex(assessment(), sources);
  assert.equal(index.get(symbol, signature), entry);
  index.verifyCoverage([{ symbol }]);
  assert.throws(() => index.get({ ...symbol, model: 'fpml' }, signature), /Missing Rune feasibility/);
  assert.throws(() => index.get(symbol, { inputs: [{ name: 'changed' }] }), /signature drift/);
  assert.throws(() => runeFeasibilityIndex(assessment(), [{ ...sources[0], commit: 'b'.repeat(40) }]), /exact audited/);
});

test('fails closed on missing, obsolete, duplicate or unreviewed entries', () => {
  const index = runeFeasibilityIndex(assessment(), sources);
  assert.throws(() => index.verifyCoverage([]), /missing or obsolete/);
  assert.throws(() => index.verifyCoverage([{ symbol }, { symbol }]), /missing or obsolete/);
  assert.throws(
    () => index.verifyCoverage([{ symbol }, { symbol: { ...symbol, name: 'New' } }]),
    /missing or obsolete/
  );
  assert.throws(() => runeFeasibilityIndex({ ...assessment(), functions: [entry, entry] }, sources), /Duplicate/);
  assert.throws(
    () => runeFeasibilityIndex({ ...assessment(), functions: [{ ...entry, route: 'guessed' }] }, sources),
    /Invalid/
  );
});

test('requires an explicit reviewed source for a Rune implementation and rejects path traversal', () => {
  assert.throws(
    () => runeFeasibilityIndex({ ...assessment(), functions: [{ ...entry, route: 'rune-source' }] }, sources),
    /Invalid/
  );
  const path = 'examples/implementations/cdm/compute.rosetta';
  const supplied = { ...entry, route: 'rune-source', implementation: path };
  assert.equal(
    runeFeasibilityIndex({ ...assessment(), files: [path], functions: [supplied] }, sources).get(symbol, signature),
    supplied
  );
  assert.throws(
    () => runeFeasibilityIndex({ ...assessment(), files: ['../../elsewhere.rosetta'] }, sources),
    /source path/
  );
});

test('renders issue status from verified target availability and keeps Rune/data requirements separate', () => {
  const markdown = renderNativeImplementationInventory({
    sources,
    functions: [
      {
        symbol,
        source: { path: 'model/functions.rosetta' },
        targets: { typescript: { status: 'available' }, python: { status: 'unavailable' } },
        rune: {
          ...entry,
          variants: [
            { selector: 'Case', hasRuneBody: true },
            { selector: 'Other', hasRuneBody: false }
          ]
        }
      }
    ]
  });
  assert.match(markdown, /\| Bundled \| Missing \| data-backed \|/);
  assert.match(markdown, /Select supplied data \\\| keep errors explicit/);
  assert.match(markdown, /1\/2 selectors have bodies/);
  assert.match(markdown, /native-implementation-inventory:start/);
  assert.match(markdown, /github.com\/finos\/common-domain-model\/blob\/a{40}\/model\/functions.rosetta/);
});
