// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * AttributeEditor — Inline editor for type attributes (T069).
 */

import { useState, useCallback, memo } from 'react';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';

export interface AttributeEditorProps {
  nodeId: string;
  onAddAttribute: (nodeId: string, name: string, typeName: string, cardinality: string) => void;
  onRemoveAttribute: (nodeId: string, name: string) => void;
  onCancel?: () => void;
}

export const AttributeEditor = memo(function AttributeEditor({
  nodeId,
  onAddAttribute,
  onRemoveAttribute: _onRemoveAttribute,
  onCancel
}: AttributeEditorProps) {
  const [name, setName] = useState('');
  const [typeName, setTypeName] = useState('string');
  const [cardinality, setCardinality] = useState('1..1');

  const handleAdd = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddAttribute(nodeId, trimmed, typeName, cardinality);
    setName('');
  }, [nodeId, name, typeName, cardinality, onAddAttribute]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleAdd();
      } else if (e.key === 'Escape') {
        onCancel?.();
      }
    },
    [handleAdd, onCancel]
  );

  return (
    <div className="rune-attribute-editor" data-testid="attribute-editor">
      <div className="rune-attribute-editor__header">Add Attribute</div>
      <div className="rune-attribute-editor__form">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Attribute name"
          aria-label="Attribute name"
          autoFocus
        />
        <Input
          type="text"
          value={typeName}
          onChange={(e) => setTypeName(e.target.value)}
          placeholder="Type"
          aria-label="Attribute type"
        />
        <Input
          type="text"
          value={cardinality}
          onChange={(e) => setCardinality(e.target.value)}
          placeholder="Cardinality"
          aria-label="Cardinality"
        />
        <Button type="button" size="xs" onClick={handleAdd} disabled={!name.trim()}>
          Add
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
