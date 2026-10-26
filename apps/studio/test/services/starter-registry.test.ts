// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { listStarterProjects, type StarterProject } from '../../src/services/starter-registry.js';
import { createStarterOpener } from '../../src/workspace/open-starter.js';

const starter: StarterProject = {
  id: 'fixture',
  name: 'Model authoring',
  description: 'An editable model.',
  repository: 'example/starter',
  ref: 'v1',
  examples: ['Money'],
  requiredCapabilities: [],
  status: 'available'
};
it('offers published example repositories at exact verified revisions', () => {
  const catalog = listStarterProjects();
  expect(catalog.map((entry) => entry.repository)).toEqual([
    'daikonic-org/rune-starter',
    'daikonic-org/rune-cdm-example'
  ]);
  for (const entry of catalog) {
    expect(entry.status).toBe('available');
    expect(entry.ref).toMatch(/^[a-f0-9]{40}$/);
  }
});
it('copies checked public source into an editable working copy with provenance and no push remote', async () => {
  const files = new Map([['model/example.rosetta', 'namespace example\ntype Money:\n amount number (1..1)\n']]);
  const source = vi.fn().mockResolvedValue({ files, commit: 'a'.repeat(40) });
  const create = vi.fn().mockResolvedValue({ workspaceId: 'copy' });
  const openStarter = createStarterOpener({ source, create });
  const signal = new AbortController().signal;
  expect(await openStarter({ starter, signal })).toEqual({
    workspaceId: 'copy',
    provenance: { repository: 'example/starter', commit: 'a'.repeat(40) }
  });
  expect(source).toHaveBeenCalledWith(starter, signal);
  expect(create).toHaveBeenCalledWith({
    name: starter.name,
    files,
    provenance: { repository: starter.repository, commit: 'a'.repeat(40) },
    signal
  });
  expect(create.mock.calls[0][0]).not.toHaveProperty('gitBacking');
  expect(create.mock.calls[0][0]).not.toHaveProperty('readOnly');
});
it('does not create a workspace for unavailable, canceled, malformed or empty sources', async () => {
  const source = vi.fn().mockResolvedValue({ files: new Map(), commit: 'not-a-commit' });
  const create = vi.fn();
  const open = createStarterOpener({ source, create });
  await expect(
    open({ starter: { ...starter, status: 'unavailable' }, signal: new AbortController().signal })
  ).rejects.toThrow(/unavailable/i);
  expect(source).not.toHaveBeenCalled();
  const abort = new AbortController();
  abort.abort();
  await expect(open({ starter, signal: abort.signal })).rejects.toThrow();
  await expect(open({ starter, signal: new AbortController().signal })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it('retains no private source paths or reference-only flags in the copy contract', async () => {
  const source = vi.fn().mockResolvedValue({
    files: new Map([
      ['.studio/token', 'secret'],
      ['model/a.rosetta', 'namespace a']
    ]),
    commit: 'a'.repeat(40)
  });
  const create = vi.fn();
  await expect(
    createStarterOpener({ source, create })({ starter, signal: new AbortController().signal })
  ).rejects.toThrow(/path/i);
  expect(create).not.toHaveBeenCalled();
});
it('checks the exact public source bytes, refuses truncated trees and keeps authentication out of requests', async () => {
  const { readStarterSource } = await import('../../src/services/starter-source.js');
  const bytes = new TextEncoder().encode('namespace example\ntype Money:\n amount number (1..1)\n');
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`),
    full = new Uint8Array(header.length + bytes.length);
  full.set(header);
  full.set(bytes, header.length);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', full))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const commit = 'a'.repeat(40),
    tree = 'b'.repeat(40);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ sha: commit, commit: { tree: { sha: tree } } }))
    .mockResolvedValueOnce(
      Response.json({
        truncated: false,
        tree: [{ path: 'model/example.rosetta', type: 'blob', mode: '100644', sha: hash, size: bytes.length }]
      })
    )
    .mockResolvedValueOnce(new Response(bytes));
  const result = await readStarterSource(starter, new AbortController().signal, fetcher);
  expect(result.commit).toBe(commit);
  expect(result.files.get('model/example.rosetta')).toContain('type Money');
  for (const [, options] of fetcher.mock.calls) {
    expect(options.credentials).toBe('omit');
    expect(options.headers).not.toHaveProperty('Authorization');
  }
  const truncated = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ sha: commit, commit: { tree: { sha: tree } } }))
    .mockResolvedValueOnce(Response.json({ truncated: true, tree: [] }));
  await expect(readStarterSource(starter, new AbortController().signal, truncated)).rejects.toThrow(/truncated/i);
  const corrupted = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ sha: commit, commit: { tree: { sha: tree } } }))
    .mockResolvedValueOnce(
      Response.json({
        truncated: false,
        tree: [{ path: 'model/example.rosetta', type: 'blob', mode: '100644', sha: hash, size: bytes.length }]
      })
    )
    .mockResolvedValueOnce(new Response('changed'));
  await expect(readStarterSource(starter, new AbortController().signal, corrupted)).rejects.toThrow(/checksum|size/i);
});
