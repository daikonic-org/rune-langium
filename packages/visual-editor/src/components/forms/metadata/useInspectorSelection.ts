// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from '../../../hooks/useLatestRef.js';
import type { MetadataNode, MetadataPath } from '../../../store/metadata-target.js';

export interface InspectorRowBinding {
  key: string;
  name: string;
  path?: MetadataPath;
  inherited: boolean;
  readonlyNode?: MetadataNode;
  node?: MetadataNode;
  parseEpoch?: number;
}
export interface InspectorSelection {
  selectedKey?: string;
  selectedRow?: InspectorRowBinding;
  select(key: string): void;
  clear(): void;
  resolve(key: string, scopeKey: string): InspectorRowBinding | undefined;
}

function matchRow(
  previous: InspectorRowBinding,
  rows: readonly InspectorRowBinding[]
): InspectorRowBinding | undefined {
  const identity = previous.node ?? previous.readonlyNode;
  const matches = rows.filter((row) => {
    if (row.key === previous.key) return true;
    const current = row.node ?? row.readonlyNode;
    if (!identity || !current || current.$type !== identity.$type || row.inherited !== previous.inherited) return false;
    if (current === identity) return true;
    if (row.parseEpoch !== previous.parseEpoch) return row.name === previous.name;
    const before = identity.$cstRange;
    const after = current.$cstRange;
    return Boolean(before && after && before.offset === after.offset && before.end === after.end);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function useInspectorSelection(scopeKey: string, rows: readonly InspectorRowBinding[]): InspectorSelection {
  const [selection, setSelection] = useState<{ scope: string; key?: string }>({ scope: scopeKey });
  const cache = useRef<{ scope: string; aliases: Map<string, InspectorRowBinding> }>({
    scope: scopeKey,
    aliases: new Map()
  });
  if (cache.current.scope !== scopeKey) cache.current = { scope: scopeKey, aliases: new Map() };
  for (const [key, previous] of cache.current.aliases) {
    const match = matchRow(previous, rows);
    if (match) cache.current.aliases.set(key, match);
    else cache.current.aliases.delete(key);
  }
  for (const row of rows) cache.current.aliases.set(row.key, row);
  const current = useLatestRef({ scopeKey, aliases: cache.current.aliases });
  const resolve = useCallback(
    (key: string, scope: string) => (scope === current.current.scopeKey ? current.current.aliases.get(key) : undefined),
    [current]
  );
  const selectedKey =
    selection.scope === scopeKey && selection.key && resolve(selection.key, scopeKey) ? selection.key : undefined;
  useEffect(() => {
    if (selection.key && !selectedKey) setSelection({ scope: scopeKey });
  }, [scopeKey, selectedKey, selection.key]);
  return {
    selectedKey,
    selectedRow: selectedKey ? resolve(selectedKey, scopeKey) : undefined,
    select: useCallback((key: string) => setSelection({ scope: scopeKey, key }), [scopeKey]),
    clear: useCallback(() => setSelection({ scope: scopeKey }), [scopeKey]),
    resolve
  };
}
