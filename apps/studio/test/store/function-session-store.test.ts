// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { createFunctionSession } from '../../src/store/function-session-store.js';
import type { PreviewSessionClient } from '../../src/services/preview-session-client.js';
import type { InstanceRecord } from '@rune-langium/codegen/instances';

describe('createFunctionSession', () => {
  it('drops a stale result after selecting another function', async () => {
    let resolveFirst!: (value: unknown) => void;
    const client: PreviewSessionClient = {
      schema: vi.fn(async (fqn) => ({
        schemaVersion: 1,
        targetId: fqn,
        title: fqn,
        status: 'ready',
        kind: 'function',
        fields: []
      })),
      execute: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      ),
      dispose: vi.fn()
    };
    const session = createFunctionSession(client);
    await session.selectFunction('test.First');
    expect(client.schema).toHaveBeenCalledWith('test.First#RosettaFunction', expect.any(AbortSignal));
    const running = session.run();
    await session.selectFunction('test.Second');
    resolveFirst('stale');
    await running;

    expect(session.getState()).toMatchObject({ functionFqn: 'test.Second', result: undefined, status: 'idle' });
  });

  it('initializes additional inputs with the shared schema defaults', async () => {
    const client: PreviewSessionClient = {
      validate: vi.fn().mockResolvedValue([]),
      schema: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        targetId: 'test.BuildTrade',
        title: 'Build trade',
        status: 'ready',
        kind: 'function',
        fields: [
          { path: 'names', label: 'Names', kind: 'array', required: false, children: [] },
          { path: 'enabled', label: 'Enabled', kind: 'boolean', required: true },
          { path: 'optionalDate', label: 'Optional date', kind: 'string', format: 'date', required: false },
          { path: 'requiredDate', label: 'Required date', kind: 'string', format: 'date', required: true },
          {
            path: 'status',
            label: 'Status',
            kind: 'enum',
            required: true,
            enumValues: [{ value: 'Draft', label: 'Draft' }]
          }
        ]
      }),
      execute: vi.fn(),
      dispose: vi.fn()
    };
    const session = createFunctionSession(client);
    await session.selectFunction('test.BuildTrade');
    expect(session.getState().inputs).toEqual({
      names: [],
      enabled: false,
      optionalDate: undefined,
      requiredDate: '',
      status: 'Draft'
    });
    session.dispose();
  });

  it('wraps an instance when binding it to a collection input', async () => {
    const client: PreviewSessionClient = {
      validate: vi.fn().mockResolvedValue([]),
      schema: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        targetId: 'test.BuildTrade',
        title: 'Build trade',
        status: 'ready',
        kind: 'function',
        fields: [
          {
            path: 'parties',
            label: 'Parties',
            kind: 'array',
            children: [{ path: 'parties[]', kind: 'object', children: [] }]
          }
        ]
      }),
      execute: vi.fn(),
      dispose: vi.fn()
    };
    const session = createFunctionSession(client);
    await session.selectFunction('test.BuildTrade');
    session.bindInstance('parties', {
      id: 'party-1',
      name: 'Acme',
      typeFqn: 'test.Party',
      data: { name: 'Acme' }
    } as InstanceRecord);

    expect(session.getState().inputs).toEqual({ parties: [{ name: 'Acme' }] });
  });

  it('invalidates a completed result after changing inputs or binding an instance', async () => {
    const client: PreviewSessionClient = {
      validate: vi.fn().mockResolvedValue([]),
      schema: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        targetId: 'test.BuildTrade',
        title: 'Build trade',
        status: 'ready',
        kind: 'function',
        fields: [{ path: 'party', label: 'Party', kind: 'object', children: [] }]
      }),
      execute: vi.fn().mockResolvedValue({ result: 'old' }),
      dispose: vi.fn()
    };
    const session = createFunctionSession(client);
    await session.selectFunction('test.BuildTrade');
    await session.run();
    session.setInputs({ party: { name: 'New' } });

    expect(session.getState()).toMatchObject({ result: undefined, status: 'idle' });

    await session.run();
    session.bindInstance('party', {
      id: 'party-1',
      name: 'Acme',
      typeFqn: 'test.Party',
      data: { name: 'Acme' }
    } as InstanceRecord);

    expect(session.getState()).toMatchObject({ result: undefined, status: 'idle' });
  });
});

it('clearing the function fences a pending schema response', async () => {
  let resolve!: (value: unknown) => void;
  const client = {
    schema: vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    ),
    validate: vi.fn(),
    execute: vi.fn(),
    dispose: vi.fn()
  };
  const session = createFunctionSession(client as never);
  const selection = session.selectFunction('test.Run');
  await session.selectFunction(null);
  resolve({ schemaVersion: 1, targetId: 'test.Run', title: 'Run', status: 'ready', fields: [] });
  await selection;
  expect(session.getState()).toMatchObject({ functionFqn: null, schema: undefined, status: 'idle', inputs: {} });
});

it('clearing a loaded function removes its schema and prior error metadata', async () => {
  const client = {
    schema: vi.fn(async () => ({ schemaVersion: 1, targetId: 'test.Run', title: 'Run', status: 'ready', fields: [] })),
    validate: vi.fn(),
    execute: vi.fn(async () => {
      throw Error('Failed');
    }),
    dispose: vi.fn()
  };
  const session = createFunctionSession(client as never);
  await session.selectFunction('test.Run');
  await session.run();
  await session.selectFunction(null);
  expect(session.getState()).toEqual({
    functionFqn: null,
    boundParameter: null,
    inputs: {},
    result: undefined,
    status: 'idle',
    error: undefined,
    schema: undefined
  });
});

it('blocks unavailable execution while leaving the input form editable', async () => {
  const client = {
    schema: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      targetId: 'test.External',
      title: 'External',
      kind: 'function',
      status: 'ready',
      fields: [],
      executionUnavailable: 'External implementation unavailable.'
    }),
    execute: vi.fn(),
    dispose: vi.fn()
  } as unknown as PreviewSessionClient;
  const session = createFunctionSession(client);
  await session.selectFunction('test.External');
  session.setInput('amount', 12);
  await session.run();
  expect(client.execute).not.toHaveBeenCalled();
  expect(session.getState()).toMatchObject({
    inputs: { amount: 12 },
    status: 'failed',
    error: 'External implementation unavailable.'
  });
});
