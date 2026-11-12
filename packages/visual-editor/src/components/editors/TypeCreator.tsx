// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeCreator — Inline UI for creating new type nodes (T068).
 */

import { useState, useCallback, memo } from 'react';
import type { TypeKind } from '../../types.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';

export interface TypeCreatorProps {
  onCreateType: (kind: TypeKind, name: string, namespace: string) => void;
  defaultNamespace?: string;
  onCancel?: () => void;
}

export const TypeCreator = memo(function TypeCreator({
  onCreateType,
  defaultNamespace = 'default',
  onCancel
}: TypeCreatorProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TypeKind>('data');
  const [namespace, setNamespace] = useState(defaultNamespace);

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateType(kind, trimmed, namespace);
    setName('');
  }, [name, kind, namespace, onCreateType]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreate();
      } else if (e.key === 'Escape') {
        onCancel?.();
      }
    },
    [handleCreate, onCancel]
  );

  return (
    <div className="rune-type-creator" data-testid="type-creator">
      <div className="rune-type-creator__header">Create Type</div>
      <div className="rune-type-creator__form">
        <Select value={kind} onValueChange={(val) => setKind(val as TypeKind)}>
          <SelectTrigger aria-label="Type kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="data">Data</SelectItem>
            <SelectItem value="choice">Choice</SelectItem>
            <SelectItem value="enum">Enum</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type name"
          aria-label="Type name"
          autoFocus
        />
        <Input
          type="text"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          placeholder="Namespace"
          aria-label="Namespace"
        />
        <Button type="button" size="xs" onClick={handleCreate} disabled={!name.trim()}>
          Create
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
});
