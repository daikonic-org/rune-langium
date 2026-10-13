// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useMemo, useRef } from 'react';
import { useExternalSync } from '@zod-to-form/react';
import { useFormState, type FieldValues, type UseFormReturn, type Path, type PathValue } from 'react-hook-form';
import { authoredValuesEqual } from '../store/edit-reconcile.js';
import { useLatestRef } from './useLatestRef.js';
import { getMetadataMemberName } from '../store/metadata-target.js';

const MEMBERS = new Set(['attributes', 'inputs', 'enumValues']);
function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (entry, key) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[key] : undefined),
    value
  );
}
function dirtyPaths(value: unknown, path: string[] = []): string[][] {
  if (value === true) return [path];
  return value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => dirtyPaths(child, [...path, key]))
    : [];
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value : [];
}
function sameRange(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const l = left as { offset: number; end: number },
    r = right as { offset: number; end: number };
  return l.offset === r.offset && l.end === r.end;
}

/** The upstream source trigger and one RHF reset, with member-identity-aware dirty paths. */
export function useInspectorExternalSync<T extends FieldValues, S>(
  form: UseFormReturn<T>,
  source: S,
  toValues: (source: S) => T,
  { parseEpoch = 0 }: { parseEpoch?: number }
) {
  const epoch = useLatestRef(parseEpoch);
  const baselineEpoch = useRef(parseEpoch);
  // Subscribe before the reset so RHF's current dirty paths are available to the adapter.
  const state = useFormState({ control: form.control });
  const dirtyRef = useLatestRef(state.dirtyFields);
  const defaultsRef = useLatestRef(state.defaultValues);
  const adapted = useMemo<UseFormReturn<T>>(
    () => ({
      ...form,
      reset(values, options) {
        if (!values || typeof values === 'function') {
          form.reset(values, options);
          return;
        }
        const current = form.getValues();
        const previous = defaultsRef.current;
        let stale = false;
        const drafts = dirtyPaths(dirtyRef.current).flatMap((path) => {
          let destination = path;
          if (MEMBERS.has(path[0] ?? '') && path.length > 1) {
            const member = at(current, path.slice(0, 2)) as Record<string, unknown> | undefined;
            const oldRows = rows(at(previous, [path[0]!]));
            const ranged = oldRows.filter((row) => sameRange(row.$cstRange, member?.$cstRange));
            const identity = getMetadataMemberName(member);
            const old = ranged.length
              ? ranged
              : oldRows.filter((row) => identity !== undefined && getMetadataMemberName(row) === identity);
            const origin = old.length === 1 ? old[0] : undefined;
            const candidates = rows(at(values, [path[0]!]));
            const indexed = candidates.map((row, index) => ({ row, index }));
            const sameEpoch = epoch.current === baselineEpoch.current;
            const rangeMatches = indexed.filter(
              ({ row }) => origin && sameEpoch && sameRange(origin.$cstRange, row.$cstRange)
            );
            const matches =
              sameEpoch && origin?.$cstRange
                ? rangeMatches
                : indexed.filter(({ row }) => origin && getMetadataMemberName(row) === getMetadataMemberName(origin));
            if (matches.length !== 1) {
              stale = true;
              return [];
            }
            destination = [path[0]!, String(matches[0]!.index), ...path.slice(2)];
          }
          const draft = at(current, path);
          if (authoredValuesEqual(draft, at(values, destination))) return [];
          const error = form.getFieldState(path.join('.') as Path<T>).error;
          return [{ path: destination.join('.') as Path<T>, value: draft, error }];
        });
        form.reset(values, { ...options, keepDirtyValues: false });
        baselineEpoch.current = epoch.current;
        for (const draft of drafts) {
          form.setValue(draft.path, draft.value as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: true });
          if (draft.error) form.setError(draft.path, { type: draft.error.type, message: draft.error.message });
        }
        if (stale)
          form.setError('root.identity', {
            type: 'stale',
            message: 'A draft was cleared because its member could not be uniquely matched after the source changed.'
          });
      }
    }),
    [form, dirtyRef, defaultsRef, epoch]
  );
  useExternalSync(adapted, source, toValues);
}
