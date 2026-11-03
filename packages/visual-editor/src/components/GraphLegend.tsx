// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * GraphLegend — collapsible key for the type graph.
 *
 * Decodes the two visual encodings a new user can't otherwise read: node
 * accent colour → type kind, and edge style → relationship. Mirrors the
 * Daikonic reference's `rs-canvas-legend`, but maps to the implementation's
 * real token palette (`--color-{kind}` via `bg-{kind}` utilities) and its
 * actual edge semantics (solid = extends/contains, dashed = reference) rather
 * than the prototype's hard-coded hex and reference/external labels.
 */

import type { TypeKind } from '../types.js';
import { KIND_LABEL } from './KindBadge.js';

// Kinds shown in the legend, in the reference's order. `bg-{kind}` resolves to
// the `--color-{kind}` token (theme.css), so the swatch tracks the theme.
const LEGEND_KINDS: ReadonlyArray<{ kind: TypeKind; dotClass: string }> = [
  { kind: 'data', dotClass: 'bg-data' },
  { kind: 'choice', dotClass: 'bg-choice' },
  { kind: 'enum', dotClass: 'bg-enum' },
  { kind: 'func', dotClass: 'bg-func' }
];

export function GraphLegend(): React.ReactElement {
  return (
    <details
      data-slot="graph-legend"
      className="rune-graph-legend flex flex-col gap-1 rounded-md border bg-card/90 px-2.5 py-2 text-2xs text-muted-foreground shadow-sm"
      aria-label="Graph legend"
    >
      <summary className="cursor-pointer font-medium">Graph legend</summary>
      <div className="mt-2 flex flex-col gap-1">
        {LEGEND_KINDS.map(({ kind, dotClass }) => (
          <div key={kind} className="flex items-center gap-2">
            <span className={`inline-block size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
            <span>{KIND_LABEL[kind]}</span>
          </div>
        ))}
        <div className="my-0.5 h-px bg-border" aria-hidden="true" />
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 shrink-0 border-t border-muted-foreground" aria-hidden="true" />
          <span>Extends / contains</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-4 shrink-0 border-t border-dashed border-muted-foreground"
            aria-hidden="true"
          />
          <span>Reference</span>
        </div>
      </div>
    </details>
  );
}
