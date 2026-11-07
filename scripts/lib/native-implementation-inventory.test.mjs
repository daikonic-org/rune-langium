// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runeFeasibilityIndex,
  renderNativeImplementationInventory,
  validateCatalogImplementation,
  handwrittenJavaReferences,
  nativeSourceBlobHash
} from './native-implementation-inventory.mjs';

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
  const path = 'packages/project-runtime/src/curated-implementations/rune/compute.rosetta';
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
        implementation: {
          kind: 'language-specific',
          targets: {
            typescript: { id: 'test', path: 'implementations/compute.ts', entrypoint: 'Compute', dependencies: [] }
          }
        },
        referenceJava: { implementations: [] },
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
  assert.match(markdown, /typescript: `implementations\/compute.ts#Compute`/);
  assert.match(markdown, /None in pinned handwritten tree \| data-backed/);
  assert.match(markdown, /Select supplied data \\\| keep errors explicit/);
  assert.match(markdown, /1\/2 selectors have bodies/);
  assert.match(markdown, /native-implementation-inventory:start/);
  assert.match(markdown, /github.com\/finos\/common-domain-model\/blob\/a{40}\/model\/functions.rosetta/);
});

test('implementation catalog is exclusive and every supplied path is contained', () => {
  const rune = { kind: 'rune', path: 'model/compute.rosetta', entrypoint: 'cdm.example.Compute', origin: 'workspace' };
  const native = {
    kind: 'language-specific',
    targets: { typescript: { id: 'compute', path: 'src/compute.ts', entrypoint: 'Compute', dependencies: [] } }
  };
  for (const entry of [rune, native, { kind: 'unimplemented' }])
    assert.doesNotThrow(() => validateCatalogImplementation(entry));
  for (const entry of [
    { ...rune, targets: native.targets },
    { ...native, path: rune.path },
    { ...rune, path: ['one', 'two'] },
    { ...rune, path: '../bad' },
    { kind: 'language-specific', targets: {} },
    { kind: 'unimplemented', path: 'x' }
  ])
    assert.throws(() => validateCatalogImplementation(entry), /one Rune path/);
});

test('Java references use handwritten production inheritance and exact test identities', () => {
  const files = [
    {
      path: 'rosetta-source/src/main/java/other/ComputeImpl.java',
      content: 'package other; import cdm.example.functions.Compute; public class ComputeImpl extends Compute {}'
    },
    {
      path: 'rosetta-source/src/test/java/cdm/example/functions/ComputeImpl.java',
      content: 'package cdm.example.functions; class ComputeImpl extends Compute {}'
    },
    {
      path: 'rosetta-source/src/test/java/cdm/example/functions/ComputeImplTest.java',
      content: 'package cdm.example.functions; class ComputeImplTest { ComputeImpl value; }'
    },
    {
      path: 'rosetta-source/src/test/java/cdm/example/functions/OtherComputeImplTest.java',
      content: 'package cdm.example.functions; class OtherComputeImplTest { OtherComputeImpl value; }'
    },
    {
      path: 'rosetta-source/src/generated/java/cdm/example/functions/Compute.java',
      content: 'package cdm.example.functions; class Compute {}'
    }
  ];
  const refs = handwrittenJavaReferences(files, 'cdm.example', 'Compute');
  assert.deepEqual(refs.implementations, [{ path: files[0].path, entrypoint: 'other.ComputeImpl' }]);
  assert.deepEqual(refs.tests, [{ path: files[2].path, entrypoint: 'cdm.example.functions.ComputeImplTest' }]);
  assert.match(handwrittenJavaReferences(files, 'cdm.example', 'Missing').absence, /No handwritten production/);
});

test('Git blob checksums include the exact UTF-8 byte length and trailing newline', () => {
  assert.equal(nativeSourceBlobHash('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.notEqual(nativeSourceBlobHash('hello'), nativeSourceBlobHash('hello\n'));
  assert.equal(nativeSourceBlobHash('😀'), createHash('sha1').update('blob 4\0😀').digest('hex'));
});
