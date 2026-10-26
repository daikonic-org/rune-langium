// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import type { ProjectSnapshot } from '@rune-langium/project-config';
import type { ReferenceCatalog } from '@rune-langium/curated-schema';
import type { ReferenceCache, ReferenceTransport } from '@rune-langium/project-runtime/references';
import type { ProjectController } from '../workspace/project-controller.js';
import { getModelRegistry } from '../services/model-registry.js';
import {
  createProjectReferenceTransport,
  prepareProjectReferenceChange,
  projectReferenceCache,
  type PreparedReferenceChange
} from '../services/project-references.js';
import { useWorkspaceActionsOptional } from '../shell/perspectives/workspace-actions-context.js';
import { ReferenceReleaseReview } from './ReferenceReleaseReview.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const ReferenceModelPicker = withInstrumentation(
  function ReferenceModelPicker({
    controller,
    snapshot,
    onAccepted,
    transport: injectedTransport,
    cache = projectReferenceCache
  }: {
    controller?: ProjectController;
    snapshot?: ProjectSnapshot;
    onAccepted?: () => void;
    transport?: ReferenceTransport;
    cache?: ReferenceCache;
  }) {
    const actions = useWorkspaceActionsOptional();
    const transport = useMemo(() => injectedTransport ?? createProjectReferenceTransport(), [injectedTransport]);
    const [selected, setSelected] = useState<string>(),
      [query, setQuery] = useState(''),
      [detail, setDetail] = useState(false),
      [catalog, setCatalog] = useState<ReferenceCatalog>(),
      [release, setRelease] = useState(''),
      [error, setError] = useState<string>(),
      [catalogError, setCatalogError] = useState<string>(),
      [phase, setPhase] = useState<'idle' | 'catalog' | 'resolving' | 'saving'>('idle'),
      [review, setReview] = useState<PreparedReferenceChange>(),
      [attempt, setAttempt] = useState(0);
    const operation = useRef<AbortController | undefined>(undefined),
      selection = useRef<HTMLButtonElement | null>(null);
    const cancel = () => {
      operation.current?.abort();
      operation.current = undefined;
      setPhase('idle');
      setReview(undefined);
    };
    useEffect(() => () => operation.current?.abort(), []);
    useEffect(() => {
      cancel();
      setError(undefined);
    }, [controller]);
    useEffect(() => {
      // Preparing a review refreshes the controller itself; only an already reviewed revision can become stale.
      if (review && controller?.current()?.revision !== review.projectRevision) {
        cancel();
        setError(undefined);
      }
    }, [controller, review, snapshot?.revision]);
    useEffect(() => {
      if (!selected) return;
      const abort = new AbortController();
      operation.current = abort;
      setCatalog(undefined);
      setCatalogError(undefined);
      setRelease('');
      setError(undefined);
      setPhase('catalog');
      void transport
        .catalog(selected, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setCatalog(result);
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setCatalogError(error instanceof Error ? error.message : 'Release catalog unavailable.');
        })
        .finally(() => {
          if (!abort.signal.aborted) setPhase('idle');
        });
      return () => abort.abort();
    }, [selected, transport, attempt]);
    const entries = getModelRegistry().filter((entry) =>
      `${entry.name} ${entry.id}`.toLowerCase().includes(query.trim().toLowerCase())
    );
    const active = entries.find((entry) => entry.id === selected);
    const versions = [
      ...new Set(catalog?.releases.filter((entry) => entry.modelId === selected).map((entry) => entry.tag) ?? [])
    ];
    const prepare = async (configured = false) => {
      if (!controller || !snapshot || (!configured && (!selected || !release))) return;
      cancel();
      setError(undefined);
      const abort = new AbortController();
      operation.current = abort;
      setPhase('resolving');
      try {
        await actions?.flushWorkspaceSave?.();
        const proposal = await prepareProjectReferenceChange(controller, transport, cache, abort.signal, (current) => {
          const config = structuredClone(current.project.build);
          if (!configured && release === 'nightly') {
            const source = getModelRegistry().find((entry) => entry.id === selected);
            if (!source) throw new Error('Unknown Nightly model.');
            config.references[selected!] = { repository: source.repoUrl.replace(/\.git$/, ''), release: 'nightly' };
          } else if (!configured) {
            const repositories = new Set(
              catalog!.releases
                .filter((entry) => entry.modelId === selected && entry.tag === release)
                .map((entry) => entry.repository)
            );
            if (repositories.size !== 1)
              throw new Error('Ambiguous release repository. Choose a verified catalog entry.');
            config.references[selected!] = { repository: [...repositories][0]!, release };
          }

          return config;
        });
        if (!abort.signal.aborted) setReview(proposal);
      } catch (error) {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Reference verification failed.');
      } finally {
        if (operation.current === abort) setPhase('idle');
      }
    };
    const accept = async () => {
      if (!review) return;
      const abort = operation.current ?? new AbortController();
      operation.current = abort;
      setPhase('saving');
      setError(undefined);
      try {
        await review.accept(abort.signal);
        if (!abort.signal.aborted) {
          onAccepted?.();
          setReview(undefined);
        }
      } catch (error) {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : 'Save failed. The previous reference remains active.');
      } finally {
        if (operation.current === abort) setPhase('idle');
      }
    };
    const reloadConfiguration = async () => {
      if (!controller) return;
      cancel();
      setError(undefined);
      const abort = new AbortController();
      operation.current = abort;
      setPhase('saving');
      try {
        await controller.recover();
      } catch (error) {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Configuration reload failed.');
      } finally {
        if (operation.current === abort) setPhase('idle');
      }
    };
    return (
      <section aria-label="Workspace reference models" className="space-y-3" data-testid="reference-model-picker">
        {!controller || !snapshot ? (
          <p className="text-sm text-muted-foreground">
            {controller
              ? 'Repair the project configuration and reload before selecting releases.'
              : 'Open or create a workspace to save pinned reference releases.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>
                {snapshot.lock
                  ? `${Object.keys(snapshot.lock.references).length} locked releases`
                  : Object.values(snapshot.project.build.references).some((request) => request.release === 'nightly')
                    ? 'Nightly follows the current mirror · no lock'
                    : 'No reference models selected'}
              </span>
              {Object.keys(snapshot.project.build.references).length > 0 && (
                <Button size="xs" variant="outline" disabled={phase !== 'idle'} onClick={() => void prepare(true)}>
                  Review configured references
                </Button>
              )}
            </div>
          </>
        )}
        {controller && !snapshot && (
          <Button size="xs" variant="outline" disabled={phase !== 'idle'} onClick={() => void reloadConfiguration()}>
            Reload project configuration
          </Button>
        )}
        <div className={`starter-picker ${detail && active ? 'starter-picker--detail' : ''}`}>
          <div className="starter-picker__list">
            <Input
              aria-label="Search reference models"
              placeholder="Search reference models…"
              value={query}
              disabled={phase === 'saving'}
              onChange={(event) => {
                cancel();
                setQuery(event.target.value);
                setError(undefined);
              }}
            />
            {query && (
              <Button size="xs" variant="ghost" onClick={() => setQuery('')}>
                Clear search
              </Button>
            )}
            <ul aria-label="Reference models">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={phase === 'saving'}
                    ref={entry.id === selected ? selection : undefined}
                    aria-pressed={entry.id === selected}
                    onClick={() => {
                      cancel();
                      setSelected(entry.id);
                      setDetail(true);
                    }}
                  >
                    <strong>{entry.name}</strong>
                    <span>
                      {snapshot?.project.build.references[entry.id]?.release === 'nightly'
                        ? 'Nightly'
                        : (snapshot?.lock?.references[entry.id]?.release ?? 'Choose a release')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!entries.length && <p className="starter-picker__empty">No matching reference models.</p>}
          </div>
          <div className="starter-picker__detail">
            {active ? (
              <>
                <Button
                  className="starter-picker__back"
                  size="xs"
                  variant="ghost"
                  disabled={phase === 'saving'}
                  onClick={() => {
                    setDetail(false);
                    requestAnimationFrame(() => selection.current?.focus());
                  }}
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  Back to reference models
                </Button>
                <h3>{active.name}</h3>
                {phase === 'catalog' ? (
                  <p role="status">Loading published releases…</p>
                ) : (
                  <>
                    <Select
                      value={release}
                      onValueChange={(value) => {
                        cancel();
                        setRelease(value);
                        setError(undefined);
                      }}
                      disabled={phase === 'saving' || phase === 'resolving'}
                    >
                      <SelectTrigger size="sm" aria-label="Release" className="w-full">
                        <SelectValue placeholder="Choose Nightly or a release…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nightly">Nightly</SelectItem>
                        {versions.map((tag) => (
                          <SelectItem key={tag} value={tag}>
                            {tag}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!versions.length && (
                      <p>No tagged releases are available. Nightly follows the current mirror without a saved pin.</p>
                    )}
                    {release === 'nightly' && (
                      <p className="text-xs text-muted-foreground">
                        Follows the current curated mirror on open or refresh. No lock or stability guarantees.
                      </p>
                    )}
                    {catalogError && (
                      <div role="alert" className="text-xs text-muted-foreground">
                        Could not load releases for {active.name}. Your workspace references are unchanged. Nightly
                        remains available.{' '}
                        <Button size="xs" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                          Retry releases
                        </Button>
                        <details>
                          <summary>Technical details</summary>
                          {catalogError}
                        </details>
                      </div>
                    )}
                    {!review && (
                      <Button
                        size="sm"
                        disabled={!release || !controller || !snapshot || phase !== 'idle'}
                        onClick={() => void prepare()}
                      >
                        Review change
                      </Button>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="starter-picker__empty">
                {query ? 'No selection matches this search.' : 'Choose a reference model to inspect its releases.'}
              </p>
            )}
          </div>
        </div>
        {phase === 'resolving' && (
          <div role="status">
            Verifying release and dependencies…{' '}
            <Button size="xs" variant="ghost" onClick={cancel}>
              Cancel verification
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm break-words">
            {error}
          </p>
        )}
        {review && (
          <ReferenceReleaseReview
            {...review}
            previous={snapshot?.lock}
            busy={phase === 'saving'}
            onAccept={() => void accept()}
            onCancel={cancel}
          />
        )}
      </section>
    );
  },
  {
    op: 'ReferenceModelPicker',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
