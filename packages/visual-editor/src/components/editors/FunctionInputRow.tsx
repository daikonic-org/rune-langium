// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * FunctionInputRow — read-only display row for a single Function input
 * parameter. Extracted from `FunctionForm.tsx` so it can be registered as
 * a `FormMeta.render` override against `AttributeSchema` (Phase 8 / US6 —
 * function inputs share `AttributeSchema` per `generated/zod-schemas.ts:640`).
 *
 * Renders: bullet handle | param name | type link | remove button.
 *
 * @module
 */

import { X } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { InspectorMemberSummary } from './inspector/InspectorMemberSummary.js';
import type { InspectorRowProps } from './inspector/inspector-row.js';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import type { TypeOption, NavigateToNodeCallback } from '../../types.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FunctionInputRowProps extends InspectorRowProps {
  /** Display projection of the input — name + resolved type label. */
  member: { name: string; typeName?: string };
  /** Node ID of the parent function — forwarded to `onRemove`. */
  nodeId: string;
  /** Available type options (for symmetry with sibling rows; unused today). */
  availableTypes: TypeOption[];
  /** Remove this input parameter by name. */
  onRemove: (nodeId: string, paramName: string) => void;
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

function FunctionInputRow({
  member,
  nodeId,
  availableTypes: _availableTypes,
  onRemove,
  disabled = false,
  onNavigateToNode,
  allNodeIds,
  selected,
  onSelect
}: FunctionInputRowProps) {
  const editorCtx = useEditorActionsContext();
  const effectiveReadOnly = Boolean(disabled || editorCtx?.readOnly);
  return (
    <InspectorMemberSummary
      name={member.name}
      typeName={member.typeName ?? 'string'}
      slot="input-param-row"
      nameSlot="param-name"
      onNavigateToNode={onNavigateToNode}
      allNodeIds={allNodeIds}
      selected={selected}
      onSelect={onSelect}
    >
      {/* Icon-button replaces literal "✕" Unicode glyph. Mirrors the pattern
       * applied to AttributeRow / ChoiceOptionRow in the same commit batch —
       * lucide <X /> in a ghost icon-button, hover:text-destructive override
       * preserves the prior visual affordance. */}
      <Button
        data-slot="remove-param-btn"
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => onRemove(nodeId, member.name)}
        disabled={effectiveReadOnly}
        className="ml-auto shrink-0 text-destructive hover:text-destructive/80"
        aria-label={`Remove input ${member.name}`}
        title={`Remove input ${member.name}`}
      >
        <X className="size-3" />
      </Button>
    </InspectorMemberSummary>
  );
}

export { FunctionInputRow };
