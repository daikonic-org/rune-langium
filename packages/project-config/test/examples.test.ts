// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { declarationKey } from '@rune-langium/core/project-contract';
import { createProjectSnapshot } from '../src/project-snapshot.js';
import { readExamples, ExampleDescriptorSchema } from '../src/examples.js';
const type = { model: 'local', namespace: 'example', kind: 'Data', name: 'Trade' };
const descriptor = (id: string) => ({
  schemaVersion: 1,
  id,
  name: 'Trade ' + id,
  type,
  payload: 'samples/' + id + '.json',
  codec: 'JSON'
});
async function snapshot(files: [string, string][] = []) {
  return createProjectSnapshot(
    'p',
    new Map([['studio-config.yml', 'schemaVersion: 1\nexamples: samples\n'], ...files]),
    () => []
  );
}
describe('portable example descriptors', () => {
  it('reads separate stable IDs of one full type from the configured root', async () => {
    const project = await snapshot(
      ['a', 'b'].flatMap(
        (id) =>
          [
            ['samples/' + id + '.example.json', JSON.stringify(descriptor(id))],
            ['samples/' + id + '.json', JSON.stringify({ amount: id === 'a' ? 1 : 2 })]
          ] as [string, string][]
      )
    );
    const read = readExamples(project, new Set([declarationKey(type)]));
    expect(read.examples.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(read.documents.map((entry) => entry.payload)).toEqual([{ amount: 1 }, { amount: 2 }]);
    expect(read.diagnostics).toEqual([]);
  });
  it('retains a payload and its descriptor when the referenced type is missing', async () => {
    const project = await snapshot([
      ['samples/a.example.json', JSON.stringify(descriptor('a'))],
      ['samples/a.json', '{"amount":10.12345}']
    ]);
    const read = readExamples(project, new Set());
    expect(read.examples).toEqual([descriptor('a')]);
    expect(read.documents[0]?.payload).toEqual({ amount: 10.12345 });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_TYPE_UNAVAILABLE' }));
  });
  it('diagnoses a missing payload without dropping its descriptor', async () => {
    const read = readExamples(await snapshot([['samples/a.example.json', JSON.stringify(descriptor('a'))]]));
    expect(read.examples).toHaveLength(1);
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_PAYLOAD_MISSING' }));
  });
  it.each(['../token', '.studio/token', 'samples/../token', 'rune-config.yml'])(
    'refuses payload outside the examples root: %s',
    async (payload) => {
      const project = await snapshot([
        ['samples/a.example.json', JSON.stringify({ ...descriptor('a'), payload })],
        ['.studio/token', 'PRIVATE-TOKEN-SENTINEL']
      ]);
      const read = readExamples(project);
      expect(read.examples).toEqual([]);
      expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_DESCRIPTOR_INVALID' }));
      expect(JSON.stringify(read)).not.toContain('PRIVATE-TOKEN-SENTINEL');
    }
  );
  it('does not enumerate hidden records or scratch payloads as examples', async () => {
    const read = readExamples(
      await snapshot([
        ['.studio/instances/private.example.json', JSON.stringify(descriptor('private'))],
        ['exports/scratch.example.json', JSON.stringify(descriptor('scratch'))]
      ])
    );
    expect(read.examples).toEqual([]);
    expect(read.diagnostics).toEqual([]);
  });
  it('retains unsupported codec data with a capability diagnostic', async () => {
    const read = readExamples(
      await snapshot([
        ['samples/a.example.json', JSON.stringify({ ...descriptor('a'), codec: 'XML' })],
        ['samples/a.json', '<Trade/>']
      ])
    );
    expect(read.examples).toHaveLength(1);
    expect(read.documents[0]?.rawPayload).toBe('<Trade/>');
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_CODEC_UNAVAILABLE' }));
  });
  it('reports duplicate IDs and shared payload paths without discarding source files', async () => {
    const read = readExamples(
      await snapshot([
        ['samples/a.example.json', JSON.stringify(descriptor('a'))],
        ['samples/b.example.json', JSON.stringify(descriptor('a'))],
        ['samples/a.json', '{}']
      ])
    );
    expect(read.examples).toHaveLength(2);
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_ID_DUPLICATE' }));
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXAMPLE_PAYLOAD_SHARED' }));
  });
  it('excludes editor/session fields from the strict descriptor contract', () => {
    expect(ExampleDescriptorSchema.safeParse({ ...descriptor('a'), selected: true, token: 'private' }).success).toBe(
      false
    );
  });
});
