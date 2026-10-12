// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInstanceReadiness, PREVIEW_PREPARATION_TIMEOUT_MS } from '../../src/services/instance-readiness.js';

afterEach(() => vi.useRealTimers());

describe('createInstanceReadiness', () => {
  it.each(['hydrate', 'worker'] as const)('bounds an unresponsive %s stage and permits retry', async (stage) => {
    vi.useFakeTimers();
    let retry = false;
    let preparationSignal: AbortSignal | undefined;
    const never = (signal: AbortSignal) => {
      preparationSignal = signal;
      return new Promise<never>(() => {});
    };
    const readiness = createInstanceReadiness({
      findNamespaces: () => ['cdm.party'],
      hydrate: (namespace, signal) => (!retry && stage === 'hydrate' ? never(signal) : Promise.resolve()),
      waitForWorkerFiles: (signal) => (!retry && stage === 'worker' ? never(signal) : Promise.resolve(9))
    });
    const pending = expect(readiness.ensure('cdm.party.Party', new AbortController().signal)).rejects.toThrow(
      'Preparing preview timed out'
    );
    await vi.advanceTimersByTimeAsync(PREVIEW_PREPARATION_TIMEOUT_MS);
    await pending;
    expect(preparationSignal?.aborted).toBe(true);
    retry = true;
    await expect(readiness.ensure('cdm.party.Party', new AbortController().signal)).resolves.toBe(9);
    readiness.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps shared preparation alive when one panel cancels its wait', async () => {
    let acknowledge!: (revision: number) => void;
    const waitForWorkerFiles = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          acknowledge = resolve;
        })
    );
    const readiness = createInstanceReadiness({
      findNamespaces: () => [],
      hydrate: async () => {},
      waitForWorkerFiles
    });
    const first = new AbortController();
    const cancelled = expect(readiness.ensure('test.Check', first.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    const second = readiness.ensure('test.Check', new AbortController().signal);
    first.abort();
    await cancelled;
    acknowledge(3);
    await expect(second).resolves.toBe(3);
    expect(waitForWorkerFiles).toHaveBeenCalledTimes(1);
    readiness.dispose();
  });
  it('waits for hydrated files to reach the worker', async () => {
    const calls: string[] = [];
    const readiness = createInstanceReadiness({
      findNamespaces: () => ['cdm.base.staticdata.party'],
      hydrate: async (ns) => {
        calls.push(`hydrate:${ns}`);
      },
      waitForWorkerFiles: async () => {
        calls.push('worker-ready');
        return 7;
      }
    });

    expect(await readiness.ensure('cdm.base.staticdata.party.Address', new AbortController().signal)).toBe(7);
    expect(calls).toEqual(['hydrate:cdm.base.staticdata.party', 'worker-ready']);
    readiness.dispose();
  });

  it('sends unknown user types to the worker without inventing a namespace', async () => {
    const calls: string[] = [];
    const readiness = createInstanceReadiness({
      findNamespaces: () => [],
      hydrate: async () => calls.push('hydrate'),
      waitForWorkerFiles: async () => {
        calls.push('worker-ready');
        return 3;
      }
    });

    await expect(readiness.ensure('user.missing.Type', new AbortController().signal)).resolves.toBe(3);
    expect(calls).toEqual(['worker-ready']);
  });

  it('allows a later explicit retry after hydration fails', async () => {
    let attempt = 0;
    const readiness = createInstanceReadiness({
      findNamespaces: () => ['cdm.base.staticdata.party'],
      hydrate: async () => {
        attempt++;
        if (attempt === 1) throw new Error('network unavailable');
      },
      waitForWorkerFiles: async () => 9
    });

    await expect(readiness.ensure('cdm.base.staticdata.party.Address', new AbortController().signal)).rejects.toThrow(
      'network unavailable'
    );
    await expect(readiness.ensure('cdm.base.staticdata.party.Address', new AbortController().signal)).resolves.toBe(9);
  });

  it('hydrates deferred dependencies reported by an otherwise user-authored schema', async () => {
    const calls: string[] = [];
    const readiness = createInstanceReadiness({
      findNamespaces: () => [],
      findNamespacesForUnresolved: (names) => (names.includes('Party') ? ['cdm.party'] : []),
      hydrate: async (namespace) => calls.push(`hydrate:${namespace}`),
      waitForWorkerFiles: async () => {
        calls.push('worker-ready');
        return 4;
      }
    });

    await expect(
      readiness.hydrateSchemaDependencies(
        {
          schemaVersion: 1,
          targetId: 'acme.Trade',
          title: 'Trade',
          status: 'ready',
          fields: [],
          unsupportedFeatures: ['unresolved-reference:Party']
        },
        new AbortController().signal
      )
    ).resolves.toBe(true);
    expect(calls).toEqual(['hydrate:cdm.party', 'worker-ready']);
  });
});
