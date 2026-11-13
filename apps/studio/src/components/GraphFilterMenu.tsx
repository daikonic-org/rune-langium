// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * GraphFilterMenu — Popover menu for toggling graph node/edge visibility by kind.
 *
 * Shows checkboxes for each node type (Data, Choice, Enum, etc.) and
 * edge type (Inheritance, References, etc.) with color-coded indicators.
 */

import { useCallback } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { Button } from '@rune-langium/design-system/ui/button';
import { Separator } from '@rune-langium/design-system/ui/separator';
import { Filter, GitBranch, ArrowRight, List, Hash, Braces, Tag, FileText } from 'lucide-react';
import { useEditorStore } from '@rune-langium/visual-editor';
import type { TypeKind, EdgeKind } from '@rune-langium/visual-editor';
import { cn } from '@rune-langium/design-system/utils';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Node kind display config. */
const NODE_KINDS: Array<{ kind: TypeKind; label: string; color: string; icon: typeof GitBranch }> = [
  { kind: 'data', label: 'Data', color: 'var(--color-data)', icon: Braces },
  { kind: 'choice', label: 'Choice', color: 'var(--color-choice)', icon: List },
  { kind: 'enum', label: 'Enum', color: 'var(--color-enum)', icon: Hash },
  { kind: 'func', label: 'Function', color: 'var(--color-func)', icon: ArrowRight },
  { kind: 'record', label: 'Record', color: 'var(--color-data)', icon: FileText },
  { kind: 'typeAlias', label: 'Type Alias', color: '#8A8A96', icon: Tag },
  { kind: 'basicType', label: 'Basic Type', color: '#8A8A96', icon: Tag },
  { kind: 'annotation', label: 'Annotation', color: '#8A8A96', icon: Tag }
];

/** Edge kind display config. */
const EDGE_KINDS: Array<{ kind: EdgeKind; label: string; color: string; dashed?: boolean }> = [
  { kind: 'extends', label: 'Inheritance', color: 'var(--color-data)' },
  { kind: 'enum-extends', label: 'Enum Inheritance', color: 'var(--color-enum)' },
  { kind: 'attribute-ref', label: 'References', color: 'var(--color-edge-ref)', dashed: true },
  { kind: 'choice-option', label: 'Choice Options', color: 'var(--color-choice)' },
  { kind: 'type-alias-ref', label: 'Type Alias Refs', color: '#8A8A96', dashed: true }
];

export interface GraphFilterMenuProps {
  compact?: boolean;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

export const GraphFilterMenu = withInstrumentation(
  function GraphFilterMenu({ compact = false, className, align = 'start' }: GraphFilterMenuProps) {
    const visibility = useEditorStore((s) => s.visibility);
    const toggleNodeKind = useEditorStore((s) => s.toggleNodeKind);
    const toggleEdgeKind = useEditorStore((s) => s.toggleEdgeKind);
    const showAllNodeKinds = useEditorStore((s) => s.showAllNodeKinds);
    const showAllEdgeKinds = useEditorStore((s) => s.showAllEdgeKinds);
    const focusMode = useEditorStore((s) => s.focusMode ?? false);
    const focusRelatedExcludedKinds = useEditorStore((s) => s.focusRelatedExcludedKinds ?? new Set());
    const toggleFocusRelatedExcludedKind = useEditorStore((s) => s.toggleFocusRelatedExcludedKind ?? (() => {}));

    const { visibleNodeKinds, visibleEdgeKinds } = visibility;

    const allNodesVisible = visibleNodeKinds.size === NODE_KINDS.length;
    const allEdgesVisible = visibleEdgeKinds.size === EDGE_KINDS.length;
    const filtersActive = !allNodesVisible || !allEdgesVisible;

    const handleResetAll = useCallback(() => {
      showAllNodeKinds();
      showAllEdgeKinds();
    }, [showAllNodeKinds, showAllEdgeKinds]);

    const includeBasicTypesInFocus = !focusRelatedExcludedKinds.has('basicType');
    const includeTypeAliasesInFocus = !focusRelatedExcludedKinds.has('typeAlias');

    const handleToggleBasicTypesInFocus = useCallback(() => {
      toggleFocusRelatedExcludedKind('basicType');
    }, [toggleFocusRelatedExcludedKind]);

    const handleToggleTypeAliasesInFocus = useCallback(() => {
      toggleFocusRelatedExcludedKind('typeAlias');
    }, [toggleFocusRelatedExcludedKind]);

    return (
      <Popover>
        <PopoverTrigger
          render={
            compact ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={cn('text-muted-foreground', className)}
                data-active={filtersActive ? 'true' : undefined}
                aria-label="Filter visible types and relationships"
                title="Filter visible types and relationships"
              >
                <Filter className="size-4" />
              </Button>
            ) : (
              <Button
                variant={filtersActive ? 'default' : 'secondary'}
                size="xs"
                title="Filter visible types and relationships"
                className={className}
              >
                <Filter />
                Filter
              </Button>
            )
          }
        />
        <PopoverContent className="w-64 p-0" align={align} sideOffset={4}>
          <div className="p-3">
            {/* Node kinds section */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node Types</span>
              {!allNodesVisible && (
                <Button variant="link" size="xs" onClick={showAllNodeKinds} type="button">
                  Show all
                </Button>
              )}
            </div>
            <div className="space-y-0.5">
              {NODE_KINDS.map(({ kind, label, color, icon: Icon }) => {
                const active = visibleNodeKinds.has(kind);
                return (
                  <Button
                    key={kind}
                    variant="ghost"
                    size="xs"
                    className={cn('w-full justify-start', !active && 'text-muted-foreground line-through')}
                    aria-pressed={active}
                    onClick={() => toggleNodeKind(kind)}
                    type="button"
                  >
                    <span
                      className="size-2.5 rounded-sm shrink-0"
                      style={{
                        backgroundColor: active ? color : 'transparent',
                        border: `1.5px solid ${active ? color : 'currentColor'}`
                      }}
                    />
                    <Icon className="size-3.5 shrink-0" style={{ opacity: active ? 1 : 0.4 }} />
                    <span>{label}</span>
                  </Button>
                );
              })}
            </div>

            <Separator className="my-2" />

            {/* Edge kinds section */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Relationships
              </span>
              {!allEdgesVisible && (
                <Button variant="link" size="xs" onClick={showAllEdgeKinds} type="button">
                  Show all
                </Button>
              )}
            </div>
            <div className="space-y-0.5">
              {EDGE_KINDS.map(({ kind, label, color, dashed }) => {
                const active = visibleEdgeKinds.has(kind);
                return (
                  <Button
                    key={kind}
                    variant="ghost"
                    size="xs"
                    className={cn('w-full justify-start', !active && 'text-muted-foreground line-through')}
                    aria-pressed={active}
                    type="button"
                    onClick={() => toggleEdgeKind(kind)}
                  >
                    <span className="w-4 shrink-0 flex items-center">
                      <span
                        className="w-full h-0"
                        style={{
                          borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${active ? color : 'currentColor'}`,
                          opacity: active ? 1 : 0.4
                        }}
                      />
                    </span>
                    <span>{label}</span>
                  </Button>
                );
              })}
            </div>

            <Separator className="my-2" />

            {/* Focus-related type behavior */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Focus Mode</div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn('w-full justify-between', !focusMode && 'text-muted-foreground')}
                aria-pressed={includeBasicTypesInFocus}
                onClick={handleToggleBasicTypesInFocus}
                title="When off, Basic Types are removed from focus-related neighbors"
              >
                <span>Include Basic Types In Related</span>
                <span
                  className={cn(
                    'inline-flex h-4 w-8 items-center rounded-full border transition-colors',
                    includeBasicTypesInFocus ? 'bg-primary/20 border-primary/40' : 'bg-muted border-border'
                  )}
                >
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full bg-current transition-transform',
                      includeBasicTypesInFocus ? 'translate-x-4 text-primary' : 'translate-x-0.5 text-muted-foreground'
                    )}
                  />
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn('w-full justify-between', !focusMode && 'text-muted-foreground')}
                aria-pressed={includeTypeAliasesInFocus}
                onClick={handleToggleTypeAliasesInFocus}
                title="When off, Type Alias nodes are removed from focus-related neighbors"
              >
                <span>Include Type Aliases In Related</span>
                <span
                  className={cn(
                    'inline-flex h-4 w-8 items-center rounded-full border transition-colors',
                    includeTypeAliasesInFocus ? 'bg-primary/20 border-primary/40' : 'bg-muted border-border'
                  )}
                >
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full bg-current transition-transform',
                      includeTypeAliasesInFocus ? 'translate-x-4 text-primary' : 'translate-x-0.5 text-muted-foreground'
                    )}
                  />
                </span>
              </Button>
            </div>

            <Separator className="my-2" />

            {/* Reset button */}
            <Button variant="secondary" size="xs" className="w-full" onClick={handleResetAll} type="button">
              Reset all filters
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
  { op: 'GraphFilterMenu' }
);
