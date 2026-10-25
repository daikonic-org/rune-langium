// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { createProjectCaptureBarrier } from '../../src/services/project-capture-barrier.js';
import type { ProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
const input = (revision: string) =>
  ({
    snapshot: { revision },
    receipt: { revision, lockDigest: '2'.repeat(64), overridesDigest: '3'.repeat(64) }
  }) as ProjectRuntimeInput;
it('waits for the saved revision without borrowing an earlier capture', async () => {
  const barrier = createProjectCaptureBarrier();
  barrier.update('w', { managed: true, status: 'captured', input: input('old'), diagnostics: [] });
  const waiting = barrier.wait('new', new AbortController().signal);
  barrier.update('w', { managed: true, status: 'loading', diagnostics: [] });
  const expected = input('new');
  barrier.update('w', { managed: true, status: 'captured', input: expected, diagnostics: [] });
  await expect(waiting).resolves.toBe(expected);
});
it('cancels waiters on workspace replacement and abort without adopting another workspace capture', async () => {
  const barrier = createProjectCaptureBarrier();
  barrier.update('w', { managed: true, status: 'loading', diagnostics: [] });
  const abort = new AbortController();
  const waiting = barrier.wait('new', abort.signal);
  const rejected = expect(waiting).rejects.toThrow(/cancel/i);
  abort.abort();
  await rejected;
  const other = barrier.wait('new', new AbortController().signal);
  const switched = expect(other).rejects.toThrow(/workspace/i);
  barrier.update('other', { managed: true, status: 'captured', input: input('new'), diagnostics: [] });
  await switched;
});

it('lets a preview operation wait for the current draft without requiring it to be saved', async () => {
  const barrier = createProjectCaptureBarrier();
  barrier.update('w', { managed: true, status: 'loading', diagnostics: [] });
  const waiting = barrier.waitCurrent(new AbortController().signal);
  const draft = input('unsaved-draft');
  barrier.update('w', { managed: true, status: 'captured', input: draft, diagnostics: [] });
  await expect(waiting).resolves.toBe(draft);
});
it('releases a cold preview when project discovery establishes an ordinary workspace', async () => {
  const barrier = createProjectCaptureBarrier();
  barrier.update('w', { managed: false, status: 'loading', diagnostics: [] });
  const preview = barrier.waitCurrent(new AbortController().signal);
  barrier.update('w', { managed: false, status: 'legacy', diagnostics: [] });
  await expect(preview).resolves.toBeUndefined();
  await expect(barrier.wait('saved', new AbortController().signal)).rejects.toThrow(/unavailable/i);
});
