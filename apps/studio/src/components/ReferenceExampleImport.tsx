// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useMemo, useRef, useState } from 'react';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { TypeChip } from '@rune-langium/visual-editor';
import { Input } from '@rune-langium/design-system/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import {
  openReferenceExamples,
  prepareReferenceExample,
  referenceExampleKey,
  type PreparedReferenceExample,
  type ReferenceExampleOrigin
} from '@rune-langium/project-runtime/examples';
import { projectReferenceKey } from '../services/project-references.js';
import { usePreviewSession } from '../shell/providers/preview-session-context.js';
import { useProject } from '../shell/providers/project-context.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { workspaceDeclarationIdentities } from '../workspace/example-identity.js';
import { useInstanceStore } from '../store/instance-store.js';
import { WorkspaceTypePicker } from './WorkspaceTypePicker.js';

type Catalog = Awaited<ReturnType<typeof openReferenceExamples>>;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Imports into the repository-backed library. Workflow binding remains an explicit grid action. */
export const ReferenceExampleImport = withInstrumentation(
  function ReferenceExampleImport() {
    const session = usePreviewSession();
    const project = useProject(),
      workspace = useWorkspaceOptional();
    const referenceKey = project.snapshot ? projectReferenceKey(project.snapshot) : undefined;
    const lastSources = useRef<{ key: string; sources: ReferenceExampleOrigin[] } | undefined>(undefined);
    // Example Save refreshes capture even though the selected reference closure is unchanged.
    // Retain that closure's verified source only while its workspace/configuration key still matches.
    if (
      referenceKey &&
      project.runtime?.status === 'captured' &&
      project.runtime.input &&
      projectReferenceKey(project.runtime.input.snapshot) === referenceKey
    ) {
      const found = new Map<string, ReferenceExampleOrigin>();
      for (const doc of project.runtime.input.referenceDocuments)
        if (doc.source) found.set(doc.source.model, doc.source);
      lastSources.current = { key: referenceKey, sources: [...found.values()] };
    }
    const origins = lastSources.current && lastSources.current.key === referenceKey ? lastSources.current.sources : [];
    const contextKey = JSON.stringify([
      workspace?.workspaceId,
      referenceKey,
      origins,
      project.snapshot?.project.build.overrides
    ]);
    const liveController = useRef(project.controller);
    liveController.current = project.controller;
    const liveKey = useRef(contextKey);
    liveKey.current = contextKey;
    const [open, setOpen] = useState(false),
      [model, setModel] = useState(''),
      [query, setQuery] = useState('');
    const [catalog, setCatalog] = useState<Catalog>(),
      [selected, setSelected] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<PreparedReferenceExample>(),
      [active, setActive] = useState('');
    const [chosenType, setChosenType] = useState<string | null>(null),
      [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState(''),
      [report, setReport] = useState<string[]>([]),
      [busy, setBusy] = useState(false),
      [attempt, setAttempt] = useState(0);
    const operation = useRef<AbortController | undefined>(undefined);
    const origin = origins.find((source) => source.model === model);
    const symbols = useMemo(() => (workspace ? workspaceDeclarationIdentities(workspace) : []), [workspace]);
    const candidates = chosenType
      ? symbols.filter(
          (symbol) =>
            ['Data', 'Choice'].includes(symbol.kind) &&
            symbol.namespace + '.' + symbol.name === chosenType.split('#')[0] &&
            symbol.model === model &&
            (!chosenType.includes('#') || symbol.kind === chosenType.split('#')[1])
        )
      : [];
    const manualType = candidates.length === 1 ? candidates[0] : undefined;
    const visible = catalog?.entries.filter((entry) => entry.path.toLowerCase().includes(query.toLowerCase())) ?? [];
    const activeVisible = visible.some((entry) => entry.path === active);
    const displayedPreview = activeVisible ? preview : undefined;
    const previewText = useMemo(
      () => (displayedPreview ? JSON.stringify(displayedPreview.data, null, 2) : ''),
      [displayedPreview]
    );
    const typedPreview =
      displayedPreview?.data &&
      typeof displayedPreview.data === 'object' &&
      Object.prototype.hasOwnProperty.call(displayedPreview.data, '@type');
    const versionWarnings = Boolean(
      displayedPreview?.warnings.length ||
      selected.size > 1 ||
      report.some((line) => line.includes('Review and acknowledge'))
    );
    useEffect(() => {
      operation.current?.abort();
      setCatalog(undefined);
      setPreview(undefined);
      setSelected(new Set());
      setError('');
      setReport([]);
      setAcknowledged(false);
      if (!open || !origin) {
        setBusy(false);
        return;
      }
      const abort = new AbortController();
      operation.current = abort;
      setBusy(true);
      void openReferenceExamples(origin, abort.signal)
        .then(
          (value) => {
            if (!abort.signal.aborted) setCatalog(value);
          },
          (failure: unknown) => {
            if (!abort.signal.aborted) setError(message(failure));
          }
        )
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
      return () => abort.abort();
    }, [open, contextKey, model, attempt]);
    useEffect(() => {
      setPreview(undefined);
      setAcknowledged(false);
      if (!catalog || !active) return;
      const file = catalog.entries.find((entry) => entry.path === active);
      if (!file) return;
      let cancelled = false;
      void catalog
        .read(file)
        .then((text) => {
          if (!cancelled) {
            setPreview(prepareReferenceExample(catalog.origin, file.path, text, symbols, manualType));
            setError('');
          }
        })
        .catch((failure: unknown) => {
          if (!cancelled) setError(message(failure));
        });
      return () => {
        cancelled = true;
      };
    }, [catalog, active, chosenType, symbols]);
    const importSelected = async () => {
      if (
        !catalog ||
        busy ||
        !project.controller ||
        project.status !== 'ready' ||
        project.runtime?.status !== 'captured'
      )
        return;
      const controller = project.controller;
      const captured = contextKey,
        epoch = useInstanceStore.getState().workspaceEpoch;
      const assertCurrent = () => {
        if (
          liveKey.current !== captured ||
          liveController.current !== controller ||
          useInstanceStore.getState().workspaceEpoch !== epoch
        )
          throw new Error('Workspace or reference changed. Reopen examples from the current model.');
      };
      setBusy(true);
      setReport([]);
      setError('');
      const outcomes: string[] = [];
      try {
        for (const path of selected) {
          try {
            assertCurrent();
            const file = catalog.entries.find((entry) => entry.path === path)!;
            const prepared = prepareReferenceExample(
              catalog.origin,
              path,
              await catalog.read(file),
              symbols,
              manualType
            );
            assertCurrent();
            if (prepared.warnings.length && !acknowledged)
              throw new Error(prepared.warnings.join(' ') + ' Review and acknowledge version warnings first.');
            const key = referenceExampleKey(prepared.source, prepared.type);
            const existing = Object.values(useInstanceStore.getState().instances).find(
              (record) =>
                record.provenance?.reference &&
                referenceExampleKey(record.provenance.reference, record.typeIdentity) === key
            );
            if (existing) {
              outcomes.push(`${path}: already in the library; retained existing example.`);
              continue;
            }
            if (!session?.decode)
              throw new Error('The example decoder is unavailable. Wait for the preview worker and retry.');
            const data = await session.decode(
              prepared.type.namespace + '.' + prepared.type.name + '#' + prepared.type.kind,
              prepared.data,
              operation.current!.signal
            );
            assertCurrent();
            const id = useInstanceStore
              .getState()
              .createInstance(prepared.type.namespace + '.' + prepared.type.name, prepared.name, {
                data,
                typeIdentity: prepared.type,
                provenance: {
                  codec: prepared.source.format,
                  source: `${prepared.source.repository}/blob/${prepared.source.commit}/${prepared.source.path}`,
                  reference: prepared.source,
                  importedAt: Date.now()
                }
              });
            await useInstanceStore.getState().flushInstance(id);
            assertCurrent();
            outcomes.push(`${path}: imported.`);
          } catch (failure) {
            outcomes.push(`${path}: ${message(failure)}`);
            if (
              liveKey.current !== captured ||
              liveController.current !== controller ||
              useInstanceStore.getState().workspaceEpoch !== epoch
            )
              break;
          }
        }
      } finally {
        if (liveKey.current === captured) {
          setReport(outcomes);
          setBusy(false);
        }
      }
    };
    return (
      <>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setModel(origins[0]?.model ?? '');
            setOpen(true);
          }}
        >
          Reference examples…
        </Button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!busy || !catalog) setOpen(next);
          }}
        >
          <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Import reference examples</DialogTitle>
              <DialogDescription>
                Copy examples into this workspace’s library. Select a grid row later to bind an input; the current
                workflow stays unchanged.
              </DialogDescription>
            </DialogHeader>
            {!origins.length ? (
              <p className="text-sm text-muted-foreground">
                Add and load a reference model in this workspace before browsing its examples.
              </p>
            ) : (
              <>
                <Select
                  value={model}
                  onValueChange={(value) => {
                    if (!busy && value) {
                      setModel(value);
                      setActive('');
                      setChosenType(null);
                    }
                  }}
                  disabled={busy}
                >
                  <SelectTrigger size="sm" aria-label="Example reference model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {origins.map((source) => (
                      <SelectItem key={source.model} value={source.model}>
                        {source.model} · {source.release}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {origin ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {origin.repository} · {origin.release} · {origin.commit.slice(0, 12)}
                  </p>
                ) : null}
                <Input
                  aria-label="Search reference examples"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search example paths"
                />
                <div className="grid min-h-0 gap-3 overflow-auto md:grid-cols-2">
                  <div
                    className="max-h-80 space-y-1 overflow-auto rounded border border-border p-1"
                    aria-label="Reference example files"
                  >
                    {busy && !catalog ? (
                      <p role="status" className="p-2 text-xs">
                        Loading examples…
                      </p>
                    ) : null}
                    {catalog && !visible.length ? (
                      <p className="p-2 text-xs text-muted-foreground">
                        No matching example payloads.{' '}
                        <Button size="xs" variant="ghost" onClick={() => setQuery('')}>
                          Clear search
                        </Button>
                      </p>
                    ) : null}
                    {visible.map((file) => (
                      <div key={file.path} className="flex items-start gap-1 rounded p-1 hover:bg-accent">
                        <input
                          type="checkbox"
                          className="size-6 shrink-0 accent-primary"
                          aria-label={`Select ${file.path}`}
                          checked={selected.has(file.path)}
                          disabled={busy}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(file.path);
                              else next.delete(file.path);
                              return next;
                            })
                          }
                        />
                        <button
                          type="button"
                          className="min-h-6 min-w-0 flex-1 break-all text-left text-xs focus-visible:outline-2 focus-visible:outline-ring"
                          aria-pressed={active === file.path}
                          onClick={() => {
                            setActive(file.path);
                            setAcknowledged(false);
                          }}
                        >
                          {file.path}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0 space-y-2 text-xs">
                    {activeVisible && !typedPreview ? (
                      <>
                        <WorkspaceTypePicker
                          label="Example object type"
                          filterKinds={['data', 'choice']}
                          value={chosenType}
                          onSelect={setChosenType}
                          allowClear
                        />
                        <p className="text-muted-foreground">
                          Choose the exact object type for a payload without a type header.
                        </p>
                      </>
                    ) : null}
                    {displayedPreview ? (
                      <>
                        <TypeChip
                          as="span"
                          typeName={
                            displayedPreview.type.namespace +
                            '.' +
                            displayedPreview.type.name +
                            ' · ' +
                            displayedPreview.type.kind
                          }
                          typeKind={displayedPreview.type.kind === 'Choice' ? 'Choice' : 'Data'}
                          className="max-w-full"
                          title={displayedPreview.type.namespace + '.' + displayedPreview.type.name}
                        />
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2">
                          {previewText.slice(0, 12_000)}
                        </pre>
                        {previewText.length > 12_000 ? (
                          <p className="text-muted-foreground">Preview shortened. The full payload will be imported.</p>
                        ) : null}
                        {displayedPreview.warnings.map((warning) => (
                          <p key={warning} className="text-muted-foreground">
                            {warning}
                          </p>
                        ))}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Select a filename to inspect its type and payload.</p>
                    )}
                    {versionWarnings ? (
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(event) => setAcknowledged(event.target.checked)}
                          disabled={busy}
                        />
                        Import selected payloads with version warnings; validate against the selected reference.
                      </label>
                    ) : null}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                    Close
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !selected.size ||
                      busy ||
                      !session?.decode ||
                      !project.controller ||
                      project.status !== 'ready' ||
                      project.runtime?.status !== 'captured'
                    }
                    onClick={() => void importSelected()}
                  >
                    Import {selected.size || ''} into library
                  </Button>
                </div>
              </>
            )}
            {error ? (
              <div role="alert" className="text-sm text-destructive">
                {error}{' '}
                <Button size="xs" variant="ghost" onClick={() => setAttempt((value) => value + 1)} disabled={busy}>
                  Retry
                </Button>
              </div>
            ) : null}
            {report.length ? (
              <ul role="status" className="max-h-28 overflow-auto text-xs">
                {report.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </DialogContent>
        </Dialog>
      </>
    );
  },
  {
    op: 'ReferenceExampleImport',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
