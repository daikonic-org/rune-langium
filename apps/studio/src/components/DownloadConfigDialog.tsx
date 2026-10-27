// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * DownloadConfigDialog — config dialog opened by the targets-table Download
 * button (spec 2026-05-14 §5.1). Collects, before the /api/codegen request
 * fires:
 *   - layout (for layout-aware targets: per-namespace / barrel / single-file)
 *   - target-specific options (Phase 2: SQL dialect, Markdown TOC style, …)
 *   - a namespace subset to emit, with cross-namespace dependency auto-select
 *     cascade (§5.2): selecting a namespace force-includes every namespace it
 *     references transitively, so the emitted graph never has dangling refs.
 *
 * The dep graph (transitive closure per namespace) is computed server-side in
 * /api/parse and passed in via `dependencyGraph`. The cascade math here is a
 * pure set-union over that closure — see `computeNamespaceSelection`.
 *
 * This component is presentational + self-contained: it owns its draft
 * selection state while open and emits the final config via `onGenerate`.
 * Wiring into the real Download handler is the caller's job (§5.3).
 */

import React, { useMemo, useState } from 'react';
import { TARGET_DESCRIPTORS, type ExportSelection, type Target } from '@rune-langium/codegen/export';
import { useLatestRef } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@rune-langium/design-system/ui/radio-group';
import { InteractiveDialog } from '@rune-langium/design-system/ui/interactive-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@rune-langium/design-system/ui/tooltip';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';
import { TARGET_PANELS } from './export-target-settings.js';

/** Final config emitted on [Generate]. */
export interface DownloadConfig {
  target: Target;
  layout?: string;
  /** The full emitted set: user-selected ∪ transitively-pulled dependencies. */
  namespaces: string[];
  /** Explicit declaration roots for the Export workbench. */
  selection?: ExportSelection;
  /**
   * Target-specific options collected from the per-target options form
   * (Phase 2, spec §5.1). Keyed by target name, e.g. `{ excel: { sheets: { ... } } }`.
   * Absent when no options form is provided (undefined = no overrides).
   */
  options?: Record<string, unknown>;
}

export interface DownloadConfigDialogProps {
  open: boolean;
  target: Target;
  /** All loaded namespaces, in display order. */
  namespaces: readonly string[];
  /**
   * Transitive dep closure per namespace (from /api/parse §5.2). Each value
   * includes the key namespace itself. Namespaces absent from the map are
   * treated as having no dependencies (closure = {self}).
   */
  dependencyGraph: Record<string, readonly string[]>;
  /** Managed projects resolve effective declaration dependencies during generation. */
  resolveDependenciesOnGenerate?: boolean;
  /** When supplied, replaces the legacy namespace allowlist for generation. */
  selection?: ExportSelection;
  onClose: () => void;
  onGenerate: (config: DownloadConfig) => void;
  /**
   * Optional per-target options form (Phase 2, spec §5.1 task #275).
   * When provided, rendered in an "Options" section between Layout and
   * Namespaces. The form must call `onChange` on every field change
   * (i.e. it wraps a ?z2f auto-save generated form).
   *
   * Dependency-injected at the wiring site (CodePreviewPanel) so this
   * modal never imports ?z2f directly and its unit tests stay clean.
   */
  optionsForm?: React.ComponentType<{
    value: Record<string, unknown>;
    onChange: (v: Record<string, unknown>) => void;
  }>;
}

export interface NamespaceSelection {
  /** Full set that will be emitted: selected ∪ pulled. */
  emitted: Set<string>;
  /** Auto-included (transitively pulled, not explicitly selected). */
  pulled: Set<string>;
  /** For each pulled namespace, which selected namespaces pulled it in. */
  pulledBy: Map<string, string[]>;
}

export const computeNamespaceSelection = withInstrumentation(
  function computeNamespaceSelection(
    selected: ReadonlySet<string>,
    dependencyGraph: Record<string, readonly string[]>
  ): NamespaceSelection {
    const emitted = new Set<string>();
    const pulledBy = new Map<string, string[]>();

    for (const ns of selected) {
      const closure = dependencyGraph[ns] ?? [ns];
      for (const dep of closure) {
        emitted.add(dep);
        if (dep !== ns && !selected.has(dep)) {
          const sources = pulledBy.get(dep);
          if (sources) sources.push(ns);
          else pulledBy.set(dep, [ns]);
        }
      }
      // A selected namespace always emits itself even if its closure entry
      // was missing from the map.
      emitted.add(ns);
    }

    const pulled = new Set<string>();
    for (const ns of emitted) {
      if (!selected.has(ns)) pulled.add(ns);
    }

    // Sort provenance lists for stable tooltip text.
    for (const sources of pulledBy.values()) sources.sort();

    return { emitted, pulled, pulledBy };
    // `selected`/`dependencyGraph`/output all carry user model namespace
    // strings (possibly non-curated) — never captured; only counts.
  },
  {
    op: 'computeNamespaceSelection',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as { emitted: Set<string>; pulled: Set<string> };
      return { emittedCount: result.emitted.size, pulledCount: result.pulled.size };
    }
  }
);

export const DownloadConfigDialog = withInstrumentation(
  function DownloadConfigDialog({
    open,
    target,
    namespaces,
    dependencyGraph,
    resolveDependenciesOnGenerate,
    selection: exportSelection,
    onClose,
    onGenerate,
    optionsForm: OptionsForm
  }: DownloadConfigDialogProps) {
    const descriptor = TARGET_DESCRIPTORS[target];
    const panel = TARGET_PANELS[target];

    // Draft state lives here while the modal is open. Default: all namespaces
    // selected (§5.1 "Default is all loaded namespaces"); default layout is the
    // target's opinionated download default.
    const [selected, setSelected] = useState<Set<string>>(() => new Set(namespaces));
    const [layout, setLayout] = useState<string | undefined>(panel?.defaultLayout);
    // Target-specific options collected from the injected OptionsForm (§5.1 task
    // #275). Stored as an opaque record; the caller decides what keys mean.
    const [targetOptions, setTargetOptions] = useState<Record<string, unknown>>({});
    // Use a ref so handleGenerate always reads the latest options without
    // re-creating the callback on every options change.
    const targetOptionsRef = useLatestRef(targetOptions);

    // Reset draft state whenever the modal (re)opens or the target changes —
    // a fresh open should not inherit a stale narrowing from a prior session.
    // Adjusted during render (React's blessed pattern for resetting state in
    // response to a prop change) rather than in an effect, so the reset is
    // visible in the same render instead of flashing the prior session's
    // stale draft for one frame before an effect corrects it.
    //
    // `resetKey` deliberately does NOT include `open` — folding it into the
    // compared string previously meant prevResetKeyRef only got updated while
    // `open` was true (see the `if` below), so closing left it frozen at the
    // last "open" key; reopening with the SAME target/namespaces then computed
    // that identical key again and silently skipped the reset, leaking the
    // prior session's draft into the reopened dialog (Codex review). The
    // actual open transition is tracked separately via prevOpen instead.
    //
    // Both markers are useState, NOT plain refs: a ref mutation made during
    // render is not rolled back if React discards/retries this render under
    // concurrent rendering, while the accompanying setSelected/setLayout/
    // setTargetOptions calls ARE rolled back (they never committed) — so a
    // bare `.current = ...` assignment could leave the retry believing this
    // reset key was already handled and skip it, generating with the prior
    // namespace selection/layout/target options (Codex review, round 2).
    const resetKey = `${target}|${[...namespaces].sort().join(',')}|${panel?.defaultLayout ?? ''}`;
    const [prevResetKey, setPrevResetKey] = useState(resetKey);
    const [prevOpen, setPrevOpen] = useState(open);
    const justOpened = open && !prevOpen;
    if (open && (justOpened || prevResetKey !== resetKey)) {
      setPrevResetKey(resetKey);
      setSelected(new Set(namespaces));
      setLayout(panel?.defaultLayout);
      setTargetOptions({});
    }
    if (open !== prevOpen) setPrevOpen(open);

    const namespaceSelection = useMemo(
      () => computeNamespaceSelection(selected, dependencyGraph),
      [selected, dependencyGraph]
    );

    function toggleNamespace(ns: string): void {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(ns)) next.delete(ns);
        else next.add(ns);
        return next;
      });
    }

    function handleGenerate(): void {
      const opts = targetOptionsRef.current;
      const hasOptions = OptionsForm !== undefined && Object.keys(opts).length > 0;
      onGenerate({
        target,
        layout,
        // When there are no namespaces to choose from (dep graph not yet
        // populated / fail-soft empty), emit an empty list = "no filter" so
        // the server emits everything. Otherwise send the closed emit set.
        namespaces: exportSelection ? [] : namespaces.length === 0 ? [] : Array.from(namespaceSelection.emitted).sort(),
        ...(exportSelection ? { selection: exportSelection } : {}),
        // Only include options when an OptionsForm was provided and it
        // actually collected values (avoids sending `options: {}` for
        // targets with no options form). Keyed by target so it matches the
        // documented `DownloadConfig.options` shape ({ excel: {...} }) that
        // CodePreviewPanel reads via `config.options?.[target]` (Codex P1 #228).
        ...(hasOptions ? { options: { [target]: opts } } : {})
      });
    }

    const hasLayouts = (panel?.layouts.length ?? 0) > 0;
    const hasNamespaces = namespaces.length > 0;
    // Disable Generate only when there ARE namespaces but the user deselected
    // them all. An empty namespace list is a valid "emit everything" state.
    const generateDisabled = exportSelection
      ? exportSelection.namespaces.length === 0 && exportSelection.declarations.length === 0
      : hasNamespaces && namespaceSelection.emitted.size === 0;

    return (
      <InteractiveDialog
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={`Generate ${descriptor.label}`}
        description={`Choose layout and namespace subset, then generate ${descriptor.label} output.`}
        width="w-[480px]"
        testId="download-config-dialog"
        bodyClassName="studio-scroll overflow-auto p-4 gap-5"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose} data-testid="download-config-dialog__cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generateDisabled}
              data-testid="download-config-dialog__generate"
            >
              Generate
            </Button>
          </>
        }
      >
        {/* Layout — only for layout-aware targets */}
        {hasLayouts && (
          <div className="flex flex-col gap-2" data-testid="download-config-dialog__layout">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Layout</span>
            <RadioGroup value={layout} onValueChange={setLayout}>
              {panel!.layouts.map((choice) => {
                const id = `download-layout-${choice.value}`;
                return (
                  <div key={choice.value} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem
                      id={id}
                      value={choice.value}
                      data-testid={`download-config-dialog__layout-${choice.value}`}
                    />
                    <label htmlFor={id} className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{choice.label}</span>
                      {choice.hint && <span className="text-muted-foreground">({choice.hint})</span>}
                    </label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
        )}

        {/* Per-target options — rendered only when an OptionsForm is
      injected by the wiring site (e.g. ExcelOptionsForm for excel).
      The form calls onChange on every field change (auto-save mode)
      and we store the result as opaque options for the Generate
      payload. */}
        {OptionsForm !== undefined && (
          <div className="flex flex-col gap-2" data-testid="download-config-dialog__options">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Options</span>
            <OptionsForm value={targetOptions} onChange={setTargetOptions} />
          </div>
        )}

        {/* Namespaces with auto-select cascade. Hidden when there's
      nothing to narrow (dep graph not populated) — Generate then
      emits everything. */}
        {hasNamespaces && (
          <div className="flex flex-col gap-2" data-testid="download-config-dialog__namespaces">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Namespaces ({namespaceSelection.emitted.size} selected, {namespaces.length} total)
            </span>
            {resolveDependenciesOnGenerate && (
              <p className="text-xs text-muted-foreground">
                Referenced declarations are included automatically when generated.
              </p>
            )}
            {/* Explicit 0: the namespace list's dependency-source tooltips want to
          stay instant (dense, frequently-hovered rows) — preserve that
          pre-existing behavior against the shared TooltipProvider's now-
          nonzero default (tooltip.tsx). */}
            <TooltipProvider delayDuration={0}>
              <div className="flex flex-col gap-1.5">
                {namespaces.map((ns) => {
                  const isSelected = selected.has(ns);
                  const isPulled = namespaceSelection.pulled.has(ns);
                  const sources = namespaceSelection.pulledBy.get(ns);
                  const id = `download-ns-${ns}`;
                  const row = (
                    <div
                      className={
                        'flex items-center gap-2 text-sm ' + (isPulled ? 'text-muted-foreground' : 'text-foreground')
                      }
                      data-testid={`download-config-dialog__ns-row-${ns}`}
                      data-state={isSelected ? 'selected' : isPulled ? 'pulled' : 'unselected'}
                    >
                      <Checkbox
                        id={id}
                        // A pulled dependency is read-only: the user can only
                        // remove it by deselecting whatever pulled it in
                        // (§5.2 prevents partial-graph emit).
                        checked={isSelected || isPulled}
                        disabled={isPulled}
                        onCheckedChange={() => toggleNamespace(ns)}
                        data-testid={`download-config-dialog__ns-${ns}`}
                      />
                      <label htmlFor={id} className="font-mono">
                        {ns}
                      </label>
                      {isPulled && (
                        <Badge variant="secondary" className="ml-auto text-3xs">
                          auto
                        </Badge>
                      )}
                    </div>
                  );
                  // Wrap pulled rows in a tooltip explaining provenance.
                  if (isPulled && sources && sources.length > 0) {
                    return (
                      <Tooltip key={ns}>
                        <TooltipTrigger render={row} />
                        <TooltipContent>pulled by {sources.join(', ')}</TooltipContent>
                      </Tooltip>
                    );
                  }
                  return <div key={ns}>{row}</div>;
                })}
              </div>
            </TooltipProvider>
          </div>
        )}
      </InteractiveDialog>
    );
  },
  { op: 'DownloadConfigDialog' }
);
