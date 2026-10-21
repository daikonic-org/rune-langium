// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * StructureMetaIndicators — header indicator cluster for a Structure View
 * Data / Choice / Function node (Phase A; Function added in Phase C).
 *
 * Renders up to three compact Popover-trigger buttons on the right side of the
 * node header, each shown ONLY when its meta is non-empty:
 *   - doc (ⓘ / Info)         — opens a popover with the type's documentation.
 *   - conditions (✓ + count) — opens a popover listing each condition.
 *   - annotations (@ + count)— opens a popover listing the annotation chips.
 *
 * Triggers carry `nodrag nopan` so React Flow doesn't claim the pointerdown,
 * and the popover content portals out of the node — no node-size / layout
 * changes (the cluster is inline in the existing header).
 *
 * Renders nothing when all three are empty.
 */

import { Info, ListChecks, AtSign } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import type { StructureConditionMeta } from '../../types/structure-view.js';

export interface StructureMetaIndicatorsProps {
  readonly definition?: string;
  readonly annotations?: readonly string[];
  readonly conditions?: readonly StructureConditionMeta[];
}

const TRIGGER_CLASS =
  'nodrag nopan inline-flex items-center gap-0.5 rounded px-1 text-2xs leading-none text-muted-foreground ' +
  'hover:text-foreground hover:bg-accent transition-colors';

export function StructureMetaIndicators({
  definition,
  annotations,
  conditions
}: StructureMetaIndicatorsProps): React.ReactElement | null {
  const hasDoc = typeof definition === 'string' && definition.trim().length > 0;
  const hasConditions = (conditions?.length ?? 0) > 0;
  const hasAnnotations = (annotations?.length ?? 0) > 0;

  if (!hasDoc && !hasConditions && !hasAnnotations) return null;

  return (
    <span data-slot="structure-meta-indicators" className="inline-flex shrink-0 items-center gap-1">
      {hasDoc ? (
        <Popover>
          <PopoverTrigger
            render={
              <button type="button" className={TRIGGER_CLASS} aria-label="Documentation" title="Documentation">
                <Info className="size-3" aria-hidden="true" />
              </button>
            }
          />
          <PopoverContent align="end" sideOffset={4} className="w-auto max-w-xs p-2 text-xs">
            <p className="whitespace-pre-wrap text-popover-foreground">{definition}</p>
          </PopoverContent>
        </Popover>
      ) : null}

      {hasConditions ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={TRIGGER_CLASS}
                aria-label={`Conditions (${conditions!.length})`}
                title={`Conditions (${conditions!.length})`}
              >
                <ListChecks className="size-3" aria-hidden="true" />
                <span>{conditions!.length}</span>
              </button>
            }
          />
          <PopoverContent align="end" sideOffset={4} className="w-auto max-w-xs p-2 text-xs">
            <ul className="space-y-1">
              {conditions!.map((condition, i) => {
                const label = condition.name || condition.preview || `condition ${i + 1}`;
                return (
                  <li key={`${condition.name}:${i}`} className="space-y-0.5">
                    <span className="font-medium text-popover-foreground">{label}</span>
                    {condition.preview ? (
                      <pre className="whitespace-pre-wrap font-mono text-2xs text-muted-foreground">
                        {condition.preview}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}

      {hasAnnotations ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={TRIGGER_CLASS}
                aria-label={`Annotations (${annotations!.length})`}
                title={`Annotations (${annotations!.length})`}
              >
                <AtSign className="size-3" aria-hidden="true" />
                <span>{annotations!.length}</span>
              </button>
            }
          />
          <PopoverContent align="end" sideOffset={4} className="w-auto max-w-xs p-2 text-xs">
            <ul className="flex flex-wrap gap-1">
              {annotations!.map((annotation, i) => (
                <li
                  key={`${annotation}:${i}`}
                  className="rounded bg-accent px-1.5 py-0.5 text-2xs text-accent-foreground"
                >
                  {annotation}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
