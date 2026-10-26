// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { encodeRuneJson } from '@rune-langium/core/serialization';
import {
  isRepositoryExample,
  openReferenceExamples,
  prepareReferenceExample,
  referenceExampleKey
} from '../src/reference-examples.js';
const origin = {
  model: 'cdm',
  repository: 'https://github.com/finos/common-domain-model',
  release: 'nightly',
  commit: '1704b23907b3dc4b87ba7a0133cb75aad9b43c77'
};
const type = { model: 'cdm', namespace: 'cdm.event.common', kind: 'Data', name: 'TradeState' };
const fixture = new URL('../../../test/fixtures/third-party/cdm-examples/', import.meta.url);
const text = readFileSync(new URL('ird-ex28-bullet-payments.json', fixture), 'utf8');
const path =
  'rosetta-source/src/main/resources/ingest/output/fpml-confirmation-to-trade-state/fpml-5-10-products-rates/ird-ex28-bullet-payments.json';
it('imports real CDM Rune JSON without losing metadata or reference namespaces', () => {
  const expected = JSON.parse(readFileSync(new URL('sources.json', fixture), 'utf8'));
  for (const [file, checksum] of Object.entries(expected.sha256))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(file, fixture)))
        .digest('hex')
    ).toBe(checksum);
  const example = prepareReferenceExample(origin, path, text, [type, { ...type, kind: 'RosettaFunction' }]);
  expect(example.type).toEqual(type);
  expect(example.source).toMatchObject({ ...origin, path, format: 'RUNE_JSON' });
  expect(example.warnings).toEqual([]);
  expect(encodeRuneJson(example.data)).toEqual(JSON.parse(text));
  expect(example.data).toMatchObject({ trade: { tradeDate: { value: '2001-04-29', meta: {} } } });
});
it('rejects model/type collisions and requires explicit legacy type selection', () => {
  expect(() => prepareReferenceExample(origin, path, text, [{ ...type, model: 'other' }])).toThrow(/missing|ambiguous/);
  expect(() => prepareReferenceExample(origin, path, text, [type, { ...type, kind: 'Choice' }])).toThrow(/ambiguous/);
  expect(() =>
    prepareReferenceExample(origin, path, '{"@model":"fpml","@type":"cdm.event.common.TradeState"}', [type])
  ).toThrow(/model differs/);
  expect(() => prepareReferenceExample(origin, path, '{"trade":{}}', [type])).toThrow(/Choose its exact/);
  expect(prepareReferenceExample(origin, path, '{"tradeDate":{"@data":"2001-04-29"}}', [type], type)).toMatchObject({
    data: { tradeDate: { value: '2001-04-29', meta: {} } },
    source: { format: 'RUNE_JSON' }
  });
  expect(() => prepareReferenceExample(origin, path, text, [type], { ...type, model: 'local' })).toThrow(/differs/);
});
it('reports release mismatch and leaves the active source identity unchanged', () => {
  const example = prepareReferenceExample({ ...origin, release: '6.0.0' }, path, text, [type]);
  expect(example.warnings[0]).toContain('differs');
  expect(example.source.release).toBe('6.0.0');
  expect(referenceExampleKey(example.source)).toBe(referenceExampleKey({ ...example.source, release: 'nightly' }));
});
it('filters configuration/binary/build artifacts and refuses malformed payloads', () => {
  expect(isRepositoryExample(path)).toBe(true);
  for (const file of [
    'pom.xml',
    'examples/a.pdf',
    'rosetta-source/src/main/resources/functions/execution-descriptor.json',
    'examples/target/generated.json'
  ])
    expect(isRepositoryExample(file)).toBe(false);
  for (const body of ['{', '[]', 'null', '<FpML/>'])
    expect(() => prepareReferenceExample(origin, path, body, [type])).toThrow();
});
it('verifies exact-commit Git blobs, ignores non-payload entries and refuses checksum/truncated/changed commits', async () => {
  const bytes = new TextEncoder().encode(text),
    blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const responses = () => [
    Response.json({ sha: origin.commit, commit: { tree: { sha: 'b'.repeat(40) } } }),
    Response.json({
      truncated: false,
      tree: [
        { path, sha: blob, size: bytes.length, mode: '100644', type: 'blob' },
        { path: 'pom.xml', sha: 'c'.repeat(40), mode: '100644', type: 'blob', size: 1 }
      ]
    }),
    new Response(bytes)
  ];
  const sequence = responses(),
    fetcher = vi.fn(async () => sequence.shift()!);
  const catalog = await openReferenceExamples(origin, new AbortController().signal, fetcher);
  expect(catalog.entries).toHaveLength(1);
  expect(await catalog.read(catalog.entries[0]!)).toBe(text);
  expect(fetcher.mock.calls).toHaveLength(3);
  const corrupt = responses();
  corrupt[2] = new Response(new Uint8Array(bytes.length));
  const bad = await openReferenceExamples(
    origin,
    new AbortController().signal,
    vi.fn(async () => corrupt.shift()!)
  );
  await expect(bad.read(bad.entries[0]!)).rejects.toThrow(/checksum/);
  await expect(
    openReferenceExamples(
      origin,
      new AbortController().signal,
      vi.fn(async () => Response.json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } }))
    )
  ).rejects.toThrow(/differs/);
});
it('distinguishes full declaration identities when a legacy payload can be imported as different object types', () => {
  const source = { ...origin, path, format: 'JSON' as const };
  expect(referenceExampleKey(source, type)).not.toBe(referenceExampleKey(source, { ...type, name: 'Other' }));
  expect(referenceExampleKey(source, type)).not.toBe(referenceExampleKey(source, { ...type, kind: 'Choice' }));
});
