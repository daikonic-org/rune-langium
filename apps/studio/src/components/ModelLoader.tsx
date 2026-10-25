// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * ModelLoader — Load reference models from curated git repositories.
 * Shows a dropdown of curated models, custom URL input, progress bar, and error display.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { getModelRegistry, createCustomModelSource } from '../services/model-registry.js';
import { useModelStore } from '../store/model-store.js';
import type { ModelSource, LoadProgress } from '../types/model-types.js';
import { CuratedLoadErrorPanel } from './CuratedLoadErrorPanel.js';
import { ErrorCategorySchema, type ErrorCategory } from '@rune-langium/curated-schema';
import { config } from '../config.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

/**
 * Map either a legacy `ModelLoadErrorCode` (git-clone path) or an already-
 * narrow `ErrorCategory` (curated path) to the panel's category enum.
 */
function mapToCategory(code: string | undefined): ErrorCategory {
  switch (code) {
    case 'NETWORK':
      return 'network';
    case 'NOT_FOUND':
      return 'archive_not_found';
    case 'NO_FILES':
      return 'archive_decode';
    case 'CANCELLED':
      return 'cancelled';
    default: {
      // CuratedLoadError already exposes `.category` directly; the store
      // stuffs it into `code`. Validate against the schema rather than a
      // hand-maintained lookup so adding a category in one place is enough.
      const r = ErrorCategorySchema.safeParse(code);
      return r.success ? r.data : 'unknown';
    }
  }
}

function ProgressBar({ progress, sourceId }: { progress: LoadProgress; sourceId: string }) {
  const cancel = useModelStore((s) => s.cancel);
  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  const phaseLabel =
    progress.phase === 'fetching'
      ? 'Cloning repository...'
      : progress.phase === 'discovering'
        ? 'Discovering .rosetta files...'
        : `Reading files (${progress.current}/${progress.total})...`;

  return (
    <div className="w-full" data-testid="model-load-progress">
      <div className="w-full bg-muted rounded-full h-2 mb-2 overflow-hidden">
        <div
          className="w-full h-2 rounded-full bg-primary origin-left transition-transform"
          style={{ transform: `scaleX(${pct / 100})` }}
          role="progressbar"
          aria-valuenow={progress.current}
          aria-valuemin={0}
          aria-valuemax={progress.total}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{phaseLabel}</p>
        <Button variant="ghost" size="sm" onClick={() => cancel(sourceId)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * After 30s, a curated-bundle chip stuck at `files.length === 0` is no
 * longer "still loading" — likely the /api/parse round-trip failed
 * silently (network drop, parse error swallowed upstream, broken
 * publish with 0 files). Switch the chip from "loading…" to a stuck
 * state so the user has feedback + can unload to retry. Sonnet RF
 * review (P1).
 */
const HYDRATION_TIMEOUT_MS = 30_000;

function LoadedModelBadge({ model }: { model: { source: ModelSource; files: { path: string }[] } }) {
  const unload = useModelStore((s) => s.unload);
  // The file count for curated bundles is hydrated asynchronously: the archive
  // load completes (chip renders) BEFORE /api/parse round-trips back with the
  // file list. Without this guard the chip flashes "(0 files)" then jumps to
  // the real count once setCuratedFiles fires from App.applyParseResult. For
  // curated bundles (`archiveUrl` set on the source), show a loading hint
  // while files.length === 0 instead of the misleading zero. User-uploaded
  // models populate files synchronously at archive-load time, so the zero
  // branch only fires for curated.
  const isCurated = model.source.archiveUrl !== undefined;
  const hasFiles = model.files.length > 0;
  const isHydrating = isCurated && !hasFiles;

  // Timeout escape: if the chip is still hydrating after HYDRATION_TIMEOUT_MS,
  // treat it as a silent failure (parse error swallowed upstream, broken
  // publish, etc.) and show actionable feedback. Without this the chip
  // could stay "loading…" indefinitely with no way for the user to learn
  // something went wrong. Reset when hydration completes successfully.
  //
  // Sonnet RF nit: hasTimedOut is intentionally NOT in the deps array.
  // Including it caused a redundant timer re-arm whenever the timeout
  // fired (effect re-runs → arms a new 30s timer → immediately replaced
  // by the next effect's cleanup). The reset path is keyed on hasFiles
  // turning true, which IS in deps; no need for hasTimedOut to drive a
  // re-run on its own.
  const [hasTimedOut, setHasTimedOut] = useState(false);
  useEffect(() => {
    if (hasFiles) {
      setHasTimedOut(false);
      return;
    }
    if (!isCurated) return;
    const timer = setTimeout(() => setHasTimedOut(true), HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFiles, isCurated]);

  const count = hasFiles
    ? `${model.files.length} file${model.files.length === 1 ? '' : 's'}`
    : isHydrating && hasTimedOut
      ? 'load failed — unload to retry'
      : isHydrating
        ? 'loading…'
        : '0 files';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm">
      <span className="font-medium">{model.source.name}</span>
      <span
        // Keyed on the rendered text so the count fades in when hydration
        // completes instead of popping from "loading…" to "N files".
        key={count}
        className={`studio-fade-in text-muted-foreground${isHydrating && hasTimedOut ? ' text-destructive' : ''}`}
        aria-live={isHydrating ? 'polite' : undefined}
      >
        ({count})
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="size-5 p-0 text-muted-foreground hover:text-destructive"
        onClick={() => unload(model.source.id)}
        aria-label={`Unload ${model.source.name}`}
      >
        ×
      </Button>
    </div>
  );
}

export const ModelLoader = withInstrumentation(
  function ModelLoader() {
    const models = useModelStore((s) => s.models);
    const loading = useModelStore((s) => s.loading);
    const errors = useModelStore((s) => s.errors);
    const load = useModelStore((s) => s.load);
    const dismissError = useModelStore((s) => s.dismissError);

    const [customUrl, setCustomUrl] = useState('');
    const [customRef, setCustomRef] = useState('main');
    const [showCustom, setShowCustom] = useState(false);

    const registry = getModelRegistry();

    const handleLoadCurated = useCallback(
      (source: ModelSource) => {
        load(source);
      },
      [load]
    );

    const handleLoadCustom = useCallback(() => {
      if (!customUrl.trim()) return;
      const source = createCustomModelSource(customUrl.trim(), customRef.trim() || 'main');
      load(source);
      setCustomUrl('');
      setCustomRef('main');
      setShowCustom(false);
    }, [customUrl, customRef, load]);

    return (
      <div className="space-y-4" data-testid="model-loader">
        {/* Loaded models */}
        {models.size > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Loaded Models</p>
            <div className="flex flex-wrap gap-2">
              {Array.from(models.values()).map((m) => (
                <LoadedModelBadge key={m.source.id} model={m} />
              ))}
            </div>
          </div>
        )}

        {/* Loading progress */}
        {Array.from(loading.entries()).map(([id, state]) =>
          state.progress ? (
            <ProgressBar key={id} progress={state.progress} sourceId={id} />
          ) : (
            <p key={id} className="text-sm text-muted-foreground">
              Connecting to {state.source.name}...
            </p>
          )
        )}

        {/* Errors — FR-002 distinct, actionable copy per failure category. */}
        {Array.from(errors.entries()).map(([id, err]) => {
          // Prefer the source captured at error time so Retry works for both
          // curated (in-registry) and custom-URL loads. Fall back to the
          // registry as a defensive lookup if we ever lose the entry.source.
          const source = err.source ?? registry.find((s) => s.id === id);
          const modelName = source?.name ?? id;
          return (
            <div key={id} className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              <CuratedLoadErrorPanel
                category={mapToCategory(err.code)}
                modelName={modelName}
                onRetry={() => {
                  dismissError(id);
                  if (source) handleLoadCurated(source);
                }}
              />
            </div>
          );
        })}

        {config.curatedMirrorEnabled && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nightly mirrors</p>
            <p className="text-xs text-muted-foreground">
              CDM follows upstream master with its required dependency versions. Nightly models are a moving target,
              with no stability or reproducibility guarantees.
            </p>
            <div className="flex flex-wrap gap-2">
              {registry.map((source) => {
                const isLoaded = models.has(source.id);
                const isLoading = loading.has(source.id);
                return (
                  <Button
                    key={source.id}
                    variant={isLoaded ? 'secondary' : 'outline'}
                    size="sm"
                    disabled={isLoaded || isLoading}
                    onClick={() => handleLoadCurated(source)}
                  >
                    {isLoaded ? `✓ ${source.name}` : source.name}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Custom URL input */}
        <div className="space-y-2">
          {showCustom ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleLoadCustom();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowCustom(false);
                }
              }}
            >
              <Input
                placeholder="https://github.com/owner/repo.git"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                data-testid="custom-url-input"
                autoFocus
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Branch/tag (default: main)"
                  value={customRef}
                  onChange={(e) => setCustomRef(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" size="sm" disabled={!customUrl.trim()}>
                  Load
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCustom(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Press Esc to cancel, Enter to load.</p>
            </form>
          ) : (
            <Button variant="link" size="sm" onClick={() => setShowCustom(true)} className="p-0">
              + Load from custom URL
            </Button>
          )}
        </div>
      </div>
    );
  },
  { op: 'ModelLoader' }
);
