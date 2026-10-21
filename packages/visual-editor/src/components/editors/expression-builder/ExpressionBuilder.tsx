// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ExpressionBuilder — root component for the visual expression editor.
 *
 * Provides Builder/Text mode toggle via tabs, renders function sections
 * (inputs, output) with labeled headers, and shows live DSL preview.
 *
 * Uses the useExpressionBuilder hook (zustand store + zundo undo/redo)
 * for state management, and wires keyboard navigation.
 *
 * @module
 */

import { useState, useCallback, useRef, type ReactNode } from 'react';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import type { ExpressionEditorSlotProps } from '../../../types.js';
import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';
import type { FunctionScope } from '../../../store/expression-store.js';
import { BlockRenderer } from './BlockRenderer.js';
import { DslPreview } from './DslPreview.js';
import { OperatorPalette } from './OperatorPalette.js';
import { ReferencePicker } from './ReferencePicker.js';
import { useContextFilter } from '../../../hooks/useContextFilter.js';
import { useExpressionBuilder } from '../../../hooks/useExpressionBuilder.js';
import { useKeyboardNavigation } from '../../../hooks/useKeyboardNavigation.js';
import { parseExpression } from '../../../adapters/parse-expression.js';
import { astToExpressionNode } from '../../../adapters/ast-to-expression-node.js';

export interface ExpressionBuilderProps extends ExpressionEditorSlotProps {
  scope: FunctionScope;
  defaultMode?: 'builder' | 'text';
  /** Callback when a node is dragged to a placeholder target. */
  onDragNode?: (draggedNodeId: string, targetNodeId: string) => void;
  /** Optional raw AST expression object — when provided, used directly instead of parsing value text. */
  expressionAst?: unknown;
  /** Host text surface; the standalone embedder retains its textarea fallback. */
  renderTextEditor?: (props: { value: string; onChange(text: string): void; onBlur(): void }) => ReactNode;
}

export function ExpressionBuilder({
  value,
  onChange,
  onBlur,
  scope,
  placeholder,
  error,
  defaultMode = 'builder',
  onDragNode,
  expressionAst,
  renderTextEditor
}: ExpressionBuilderProps) {
  // Convert AST directly if available, otherwise fall back to text parsing
  const initialTree = expressionAst ? astToExpressionNode(expressionAst, value ?? '') : parseExpression(value ?? '');

  const [textValue, setTextValue] = useState(value ?? '');
  const handleBuilderChange = useCallback(
    (text: string) => {
      setTextValue(text);
      onChange?.(text);
    },
    [onChange]
  );
  const {
    tree,
    mode,
    selectedNodeId,
    paletteOpen,
    paletteAnchorId,
    replaceNode,
    selectNode,
    setMode,
    openPalette,
    closePalette,
    handleBlur,
    setTreeFromText,
    store
  } = useExpressionBuilder({
    value: value ?? '',
    onChange: handleBuilderChange,
    onBlur,
    scope,
    initialTree,
    defaultMode
  });

  const [referenceTargetId, setReferenceTargetId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Wire keyboard navigation (undo/redo, arrow keys, copy/paste, etc.)
  useKeyboardNavigation({ store, containerRef });

  const handleModeSwitch = useCallback(
    (newMode: 'builder' | 'text') => {
      if (newMode === mode) return;
      if (newMode === 'builder') setTreeFromText(parseExpression(textValue));
      setParseError(null);
      setMode(newMode);
    },
    [mode, textValue, setTreeFromText, setMode]
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setTextValue(newText);
      onChange?.(newText);
    },
    [onChange]
  );

  const handleTextBlur = useCallback(() => {
    onChange?.(textValue);
    handleBlur();
  }, [textValue, onChange, handleBlur]);

  const handleActivatePlaceholder = useCallback(
    (nodeId: string) => {
      openPalette(nodeId);
    },
    [openPalette]
  );

  const handleOpenReferencePicker = useCallback(() => {
    setReferenceTargetId(paletteAnchorId);
    closePalette();
  }, [paletteAnchorId, closePalette]);

  const handleEditReference = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      setReferenceTargetId(nodeId);
      closePalette();
    },
    [selectNode, closePalette]
  );

  const handlePaletteSelect = useCallback(
    (node: ExpressionNode) => {
      const targetId = referenceTargetId ?? paletteAnchorId;
      if (targetId) {
        replaceNode(targetId, node);
      }
      closePalette();
      setReferenceTargetId(null);
    },
    [referenceTargetId, paletteAnchorId, replaceNode, closePalette]
  );

  const handlePaletteClose = useCallback(() => {
    closePalette();
  }, [closePalette]);

  const handleReferenceClose = useCallback(() => {
    setReferenceTargetId(null);
  }, []);

  // Context-aware operator filtering
  const { categories: filteredCategories } = useContextFilter(tree, paletteAnchorId);

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
      data-testid="expression-builder"
      tabIndex={-1}
    >
      {/* Mode toggle tabs */}
      <div className="flex gap-1 border-b border-border pb-1">
        <button
          type="button"
          className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
            mode === 'builder' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => handleModeSwitch('builder')}
          data-testid="tab-builder"
        >
          Builder
        </button>
        <button
          type="button"
          className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
            mode === 'text' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => handleModeSwitch('text')}
          data-testid="tab-text"
        >
          Text
        </button>
      </div>

      {/* Builder mode */}
      {mode === 'builder' && (
        <>
          <div
            className="relative min-h-8 rounded border border-border/50 bg-background/50 p-2"
            role="tree"
            aria-label="Expression blocks"
          >
            <BlockRenderer
              node={tree}
              selectedNodeId={selectedNodeId}
              onSelect={selectNode}
              onEditReference={handleEditReference}
              onActivatePlaceholder={handleActivatePlaceholder}
              onDragNode={onDragNode}
            />
            <OperatorPalette
              open={paletteOpen}
              onSelect={handlePaletteSelect}
              onClose={handlePaletteClose}
              filteredCategories={filteredCategories}
              onOpenReferencePicker={handleOpenReferencePicker}
            />
            <ReferencePicker
              open={referenceTargetId !== null}
              scope={scope}
              onSelect={handlePaletteSelect}
              onClose={handleReferenceClose}
            />
          </div>
          <DslPreview tree={tree} />
        </>
      )}

      {/* Text mode */}
      {mode === 'text' &&
        (renderTextEditor ? (
          renderTextEditor({
            value: textValue,
            onChange: (text) => {
              setTextValue(text);
              onChange?.(text);
            },
            onBlur: handleTextBlur
          })
        ) : (
          <Textarea
            aria-label="Expression draft"
            className="min-h-20 resize-y font-mono"
            value={textValue}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
            placeholder={placeholder}
            data-testid="text-editor"
          />
        ))}

      {/* Scope info */}
      {scope.inputs.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Inputs</span>
          <div className="flex flex-wrap gap-1">
            {scope.inputs.map((input) => (
              <span
                key={input.name}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground"
              >
                {input.name}
                {input.typeName && `: ${input.typeName}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {scope.output && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Output</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
            {scope.output.name}
            {scope.output.typeName && `: ${scope.output.typeName}`}
          </span>
        </div>
      )}

      {(error || parseError) && <span className="text-xs text-destructive">{error ?? parseError}</span>}

      {!value && placeholder && mode === 'builder' && (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}
