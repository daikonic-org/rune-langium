// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ChoiceOptionRow — read-only display row for a single Choice option.
 *
 * Renders: type label with kind-colored badge + remove button.
 * Removing an option triggers both member and edge removal.
 *
 * @module
 */

import { INSPECTOR_ROW_CLASS, inspectorRowAttributes, type InspectorRowProps } from './inspector/inspector-row.js';

import { getKindBadgeClasses } from './TypeSelector.js';
import { TypeLink } from './TypeLink.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { X } from 'lucide-react';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import type { TypeOption, NavigateToNodeCallback } from '../../types.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChoiceOptionRowProps extends InspectorRowProps {
  /** The type name for this choice option. */
  typeName: string;
  /** Node ID owning this choice. */
  nodeId: string;
  /** Available type options (for badge styling lookup). */
  availableTypes: TypeOption[];
  /** Remove this option. */
  onRemove: (nodeId: string, typeName: string) => void;
  /** Whether the row is disabled. */
  disabled?: boolean;
  /** Callback to navigate to a type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph node IDs for resolving type name to node ID. */
  allNodeIds?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ChoiceOptionRow({
  typeName,
  nodeId,
  availableTypes,
  onRemove,
  disabled = false,
  onNavigateToNode,
  allNodeIds,
  selected,
  onSelect
}: ChoiceOptionRowProps) {
  const editorCtx = useEditorActionsContext();
  const effectiveReadOnly = Boolean(disabled || editorCtx?.readOnly);
  const matchedType = availableTypes.find((opt) => opt.label === typeName);
  const kind = matchedType?.kind ?? 'data';

  function handleRemove() {
    onRemove(nodeId, typeName);
  }

  return (
    <div
      role="listitem"
      {...inspectorRowAttributes({ selected, onSelect }, typeName)}
      data-slot="choice-option-row"
      className={`${INSPECTOR_ROW_CLASS} flex items-center gap-2`}
    >
      {/* Kind badge / clickable type link */}
      <TypeLink
        typeName={typeName}
        onNavigateToNode={onNavigateToNode}
        allNodeIds={allNodeIds}
        className={`shrink-0 ${getKindBadgeClasses(kind)}`}
      />

      {matchedType?.namespace && (
        <span className="text-xs text-muted-foreground truncate">{matchedType.namespace}</span>
      )}

      {/* Remove button — icon-only `<X />` in a ghost icon-button so
          the affordance matches FormPreviewPanel and AttributeRow.
          Replaces the literal "✕" Unicode glyph (font-dependent
          baseline jitter). */}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleRemove}
        disabled={effectiveReadOnly}
        aria-label={`Remove option ${typeName}`}
        title={`Remove option ${typeName}`}
        className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

export { ChoiceOptionRow };
