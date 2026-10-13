// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useRef, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { useEditorCommitRegistry } from '../../../hooks/editor-commit-lifecycle.js';
import { useMetadataTarget } from './MetadataTargetContext.js';
import { getMetadataItems } from '../../../store/metadata-ops.js';
import { authoredValuesEqual } from '../../../store/edit-reconcile.js';
import type { MetadataItem, MetadataEditResult } from '../../../store/metadata-target.js';

/** Renew only a uniquely unchanged item across reparse; same-epoch replacement stays stale. */
export function useMetadataItemLease(
  field: 'annotations' | 'synonyms' | 'enumSynonyms',
  index: number,
  expected: MetadataItem
) {
  const binding = useMetadataTarget();
  const lease = useRef({ expected, epoch: binding?.currentTarget()?.parseEpoch });
  return (value: MetadataItem): MetadataEditResult => {
    if (binding?.readOnly) return { status: 'readOnly' };
    const target = binding?.currentTarget();
    if (!binding || !target) return { status: 'stale' };
    const items = getMetadataItems(target.expected, field);
    if (target.parseEpoch !== lease.current.epoch) {
      const matching = items.filter((item) => authoredValuesEqual(item, lease.current.expected));
      if (matching.length !== 1 || matching[0] !== items[index]) return { status: 'stale' };
      lease.current = { expected: matching[0]!, epoch: target.parseEpoch };
    }
    if (items[index] !== lease.current.expected) return { status: 'stale' };
    if (authoredValuesEqual(value, lease.current.expected)) return { status: 'committed' };
    const result = binding.commit({ kind: 'replace', field, index, expected: lease.current.expected, value });
    if (result.status === 'committed') {
      const live = binding.currentTarget();
      const item = live && getMetadataItems(live.expected, field)[index];
      if (item && live) lease.current = { expected: item, epoch: live.parseEpoch };
    }
    return result;
  };
}

/** Rich edits share the declaration save barrier; transient commit errors remain retryable. */
export function useMetadataItemCommit(
  field: 'annotations' | 'synonyms' | 'enumSynonyms',
  index: number,
  expected: MetadataItem,
  path: string
) {
  const { getValues, getFieldState, setError, clearErrors } = useFormContext();
  const binding = useMetadataTarget();
  const replace = useMetadataItemLease(field, index, expected);
  const registry = useEditorCommitRegistry();
  const commit = () => {
    const state = getFieldState(path);
    if (!binding || (state.invalid && state.error?.type !== 'commit')) return;
    if (binding.readOnly) {
      const current = binding.currentTarget();
      const item = current && getMetadataItems(current.expected, field)[index];
      return item && !authoredValuesEqual(getValues(path), item) ? false : undefined;
    }
    const result = replace(getValues(path));
    if (result.status === 'committed') clearErrors(path);
    else {
      setError(path, {
        type: result.status === 'invalid' ? 'validate' : 'commit',
        message:
          result.status === 'invalid' ? result.issues[0]?.message : 'This item changed before the edit could be saved.'
      });
      if (result.status === 'readOnly' || result.status === 'stale') return false;
    }
  };
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => registry?.register(() => latest.current()), [registry]);
  return commit;
}
