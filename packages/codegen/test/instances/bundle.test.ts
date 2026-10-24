// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import type { LangiumDocument } from 'langium';
import {
  buildManifest,
  computeModelFingerprint,
  parseManifest,
  serializeManifest,
  type InstanceRecord
} from '../../src/instances/bundle.js';

function fakeDocs(texts: string[]): LangiumDocument[] {
  return texts.map((text) => ({ textDocument: { getText: () => text } })) as never;
}

const RECORD: InstanceRecord = {
  id: '01J000000000000000000001',
  name: 'My Party',
  typeFqn: 'test.Party',
  data: { name: 'Acme Corp' },
  createdAt: 1000,
  modifiedAt: 1000
};

describe('bundle manifest', () => {
  it('round-trips through serialize/parse', () => {
    const manifest = buildManifest([RECORD], 'deadbeef', undefined);
    const json = serializeManifest(manifest);
    const parsed = parseManifest(json);
    expect(parsed).toEqual(manifest);
  });

  it('includes gitCommitSha only when provided, never as the gating field', () => {
    const withGit = buildManifest([RECORD], 'deadbeef', 'abc1234');
    expect(withGit.modelFingerprint).toBe('deadbeef');
    expect(withGit.gitCommitSha).toBe('abc1234');

    const withoutGit = buildManifest([RECORD], 'deadbeef', undefined);
    expect(withoutGit.gitCommitSha).toBeUndefined();
  });

  it('rejects a manifest with an unknown formatVersion', () => {
    const bad = JSON.stringify({ formatVersion: 999, modelFingerprint: 'x', instances: [] });
    expect(() => parseManifest(bad)).toThrow(/formatVersion/);
  });
});

describe('computeModelFingerprint — hash input must not be ambiguous across document boundaries (finding #11)', () => {
  it('produces DIFFERENT fingerprints for a single doc "a\\nb" vs. two docs "a" and "b"', async () => {
    // A naive `.join('\n')` of sorted texts makes these two, semantically
    // different document sets produce the IDENTICAL hash input string
    // ("a\nb" either way) — and therefore the identical hash, even though
    // one is one document and the other is two.
    const oneDoc = fakeDocs(['a\nb']);
    const twoDocs = fakeDocs(['a', 'b']);

    const fpOne = await computeModelFingerprint(oneDoc);
    const fpTwo = await computeModelFingerprint(twoDocs);

    expect(fpOne).not.toBe(fpTwo);
  });

  it('is still stable and order-independent for a genuinely identical document set', async () => {
    const docsA = fakeDocs(['b', 'a']);
    const docsB = fakeDocs(['a', 'b']);

    expect(await computeModelFingerprint(docsA)).toBe(await computeModelFingerprint(docsB));
  });
});

it('decodes typed legacy records without accepting arbitrary scratch JSON', async () => {
  const { parseInstanceRecord } = await import('../../src/instances/bundle.js');
  expect(parseInstanceRecord(JSON.stringify(RECORD))).toEqual(RECORD);
  const typeIdentity = { model: 'local', namespace: 'test', kind: 'Data', name: 'Party' };
  expect(parseInstanceRecord(JSON.stringify({ ...RECORD, typeIdentity })).typeIdentity).toEqual(typeIdentity);
  for (const value of [{ token: 'secret' }, { ...RECORD, data: undefined }, { ...RECORD, modifiedAt: 'yesterday' }]) {
    expect(() => parseInstanceRecord(JSON.stringify(value))).toThrow();
  }
});
