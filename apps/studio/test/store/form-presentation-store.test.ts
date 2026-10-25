// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, expect, it, vi } from 'vitest';
const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: read,
  writeWorkbenchSettings: write
}));
import {
  useFormPresentationStore,
  readFormPreferences,
  formatPreviewNumber,
  type FormPreferences
} from '../../src/store/form-presentation-store.js';
const empty = (): FormPreferences => ({ layouts: {}, formats: {} });
const currency = { style: 'currency' as const, currency: 'USD', grouping: true, fractionDigits: 2 };
beforeEach(() => {
  useFormPresentationStore.setState({ workspaces: {} });
  read.mockReset();
  write.mockReset().mockResolvedValue(undefined);
});

it('restores each workspace independently when reads finish out of order', async () => {
  let finishA!: (value: unknown) => void;
  read.mockImplementation((id) =>
    id === 'a'
      ? new Promise((resolve) => {
          finishA = resolve;
        })
      : Promise.resolve({ ...empty(), formats: { 'builtin:number': currency } })
  );
  const a = useFormPresentationStore.getState().load('a');
  await useFormPresentationStore.getState().load('b');
  useFormPresentationStore.getState().update('b', (current) => ({
    ...current,
    layouts: { 'data:test.Trade': { columns: 2, order: ['amount'], spans: {} } }
  }));
  finishA(empty());
  await a;
  expect(useFormPresentationStore.getState().workspaces.b?.preferences).toMatchObject({
    layouts: { 'data:test.Trade': { columns: 2 } },
    formats: { 'builtin:number': currency }
  });
  expect(useFormPresentationStore.getState().workspaces.a?.preferences).toEqual(empty());
  expect(write).toHaveBeenCalledWith(
    'b',
    'form-presentation',
    expect.objectContaining({ layouts: { 'data:test.Trade': { columns: 2, order: ['amount'], spans: {} } } })
  );
});
it('deduplicates restores for simultaneous Preview and Prototype mounts', async () => {
  read.mockResolvedValue(empty());
  await Promise.all([useFormPresentationStore.getState().load('a'), useFormPresentationStore.getState().load('a')]);
  expect(read).toHaveBeenCalledTimes(1);
});
it('reports a failed save and retries the current preferences without losing edits', async () => {
  read.mockResolvedValue(empty());
  write.mockRejectedValueOnce(new Error('quota'));
  await useFormPresentationStore.getState().load('a');
  useFormPresentationStore
    .getState()
    .update('a', (current) => ({ ...current, formats: { 'typeAlias:test.Amount': currency } }));
  await vi.waitFor(() =>
    expect(useFormPresentationStore.getState().workspaces.a?.error).toContain('could not be saved')
  );
  await useFormPresentationStore.getState().retry('a');
  expect(useFormPresentationStore.getState().workspaces.a?.error).toBeUndefined();
  expect(write).toHaveBeenLastCalledWith(
    'a',
    'form-presentation',
    expect.objectContaining({ formats: { 'typeAlias:test.Amount': currency } })
  );
});
it('retries a failed restore instead of replacing saved settings with defaults', async () => {
  read
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ ...empty(), formats: { 'builtin:number': currency } });
  await useFormPresentationStore.getState().load('a');
  expect(useFormPresentationStore.getState().workspaces.a?.error).toContain('could not be loaded');
  useFormPresentationStore.getState().setEditing('a', true);
  useFormPresentationStore.getState().update('a', () => empty());
  expect(useFormPresentationStore.getState().workspaces.a?.editing).not.toBe(true);
  expect(useFormPresentationStore.getState().workspaces.a?.revision).toBe(0);
  await useFormPresentationStore.getState().retry('a');
  expect(write).not.toHaveBeenCalled();
  expect(useFormPresentationStore.getState().workspaces.a?.preferences.formats['builtin:number']).toEqual(currency);
});
it('ignores an older save failure after a newer edit was saved', async () => {
  let reject!: (error: Error) => void;
  read.mockResolvedValue(empty());
  write
    .mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        })
    )
    .mockResolvedValue(undefined);
  await useFormPresentationStore.getState().load('a');
  useFormPresentationStore
    .getState()
    .update('a', (current) => ({ ...current, formats: { 'builtin:number': currency } }));
  useFormPresentationStore.getState().update('a', (current) => ({ ...current, formats: {} }));
  reject(new Error('older failure'));
  await vi.waitFor(() => expect(useFormPresentationStore.getState().workspaces.a?.revision).toBe(2));
  expect(useFormPresentationStore.getState().workspaces.a?.error).toBeUndefined();
});
it('filters malformed persisted settings without letting stale data dictate fields', () => {
  expect(
    readFormPreferences({
      layouts: {
        bad: { columns: 9 },
        good: { columns: 2, order: ['amount', 4, 'amount'], spans: { amount: 'full', other: -1 } }
      },
      formats: { bad: { ...currency, currency: 'not a code' }, good: { ...currency, fractionDigits: 100 } }
    })
  ).toEqual({
    layouts: { good: { columns: 2, order: ['amount'], spans: { amount: 'full' } } },
    formats: { good: { style: 'currency', currency: 'USD', grouping: true } }
  });
});
it('formats decimal strings and special values without mutating the payload', () => {
  const raw = '123456789012345678.123456';
  expect(formatPreviewNumber(raw, currency)).toBe(
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(raw as unknown as number)
  );
  expect(raw).toBe('123456789012345678.123456');
  expect(formatPreviewNumber(-1234.56789, currency)).toContain('1,234.57');
  expect(formatPreviewNumber('', currency)).toBe('');
  expect(formatPreviewNumber(NaN, currency)).toBe('NaN');
});

it('keeps temporary edit mode across form remounts and late saves without persisting it', async () => {
  let complete!: () => void;
  read.mockResolvedValue(empty());
  write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  await useFormPresentationStore.getState().load('a');
  useFormPresentationStore
    .getState()
    .update('a', (current) => ({ ...current, formats: { 'builtin:number': currency } }));
  useFormPresentationStore.getState().setEditing('a', true);
  await useFormPresentationStore.getState().load('a');
  complete();
  await vi.waitFor(() => expect(useFormPresentationStore.getState().workspaces.a?.saving).toBe(false));
  expect(useFormPresentationStore.getState().workspaces.a?.editing).toBe(true);
  expect(write.mock.calls[0]![2]).not.toHaveProperty('editing');
});

it('prefers repository presentation and leaves browser preferences unimported until explicit acceptance', async () => {
  const canonical = '["local","test","RosettaTypeAlias","Amount",null]';
  const local = { ...empty(), formats: { 'typeAlias:test.Amount': currency } };
  read.mockResolvedValue(local);
  const preferences = { ...empty(), formats: { [canonical]: currency } };
  const repository = {
    load: vi.fn().mockResolvedValue({ preferences: empty(), hasFiles: false, diagnostics: [] }),
    save: vi.fn().mockResolvedValue(undefined),
    previewLegacy: vi.fn().mockReturnValue({ preferences, diagnostics: [] })
  };
  await useFormPresentationStore.getState().setRepository('portable', repository);
  const entry = useFormPresentationStore.getState().workspaces.portable!;
  expect(entry.preferences).toEqual(empty());
  expect(entry.legacy?.preferences).toEqual(preferences);
  expect(repository.save).not.toHaveBeenCalled();
  await useFormPresentationStore.getState().acceptLegacy('portable');
  expect(repository.save).toHaveBeenCalledWith(preferences);
  expect(useFormPresentationStore.getState().workspaces.portable?.preferences).toEqual(preferences);
  expect(write).not.toHaveBeenCalled();
  await useFormPresentationStore.getState().setRepository('portable', undefined);
});
it('loads repository files without replaying stale personal settings and saves edits through that repository', async () => {
  const preferences = { ...empty(), formats: { canonical: currency } };
  const repository = {
    load: vi.fn().mockResolvedValue({ preferences, hasFiles: true, diagnostics: [] }),
    save: vi.fn().mockResolvedValue(undefined),
    previewLegacy: vi.fn()
  };
  await useFormPresentationStore.getState().setRepository('portable-existing', repository);
  expect(read).not.toHaveBeenCalled();
  useFormPresentationStore.getState().update('portable-existing', (current) => ({
    ...current,
    formats: { canonical: { ...currency, fractionDigits: 3 } }
  }));
  await vi.waitFor(() => expect(repository.save).toHaveBeenCalledOnce());
  expect(write).not.toHaveBeenCalled();
  expect(repository.save.mock.calls[0]?.[0].formats.canonical.fractionDigits).toBe(3);
  await useFormPresentationStore.getState().setRepository('portable-existing', undefined);
});
