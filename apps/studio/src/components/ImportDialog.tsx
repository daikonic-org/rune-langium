// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * ImportDialog — brings an external schema (JSON Schema / OpenAPI / SQL DDL /
 * XSD) into the workspace as a new `.rune` file, or merges it into an
 * already-open file whose namespace matches (spec 021 Phase 4 consumer —
 * see docs/superpowers/specs/2026-07-06-explorer-import-dialog-design.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Input } from '@rune-langium/design-system/ui/input';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import { CodeBlock } from '@rune-langium/design-system/ui/code-block';
import { Alert, AlertDescription, AlertTitle } from '@rune-langium/design-system/ui/alert';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { InteractiveDialog } from '@rune-langium/design-system/ui/interactive-dialog';
import { parse } from '@rune-langium/core';
import type { ImportResult, ImportSourceKind } from '@rune-langium/codegen/import';
import type { WorkspaceFile } from '../services/workspace.js';
import { createWorkspaceFile, updateFileContent, uniqueFilePath } from '../services/workspace.js';
import { mergeImportedText, type MergeResult } from '../shell/import-merge.js';
import { MergeOptionsSchema, type MergeOptions } from '../shell/import-merge-options.js';
import { getSqlWasmBytes } from '../shell/sql-wasm-asset.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface ImportOptionsFormProps {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}

/**
 * The z2f-generated options forms produce reader-native field names
 * (`skipConditions`, SQL's `dialect`) since those are the actual Zod schema
 * field names — but `importModel()`'s `ImportOptions` still uses the legacy
 * CLI-flag names (`conditions`, `sqlDialect`) that predate this schema work.
 * Translate before spreading into the `importModel` call; the newer
 * `includeUnreferencedDefs`/`includeOperations`/`importTopLevelElements`
 * fields already share the same name in both places and pass through
 * untouched.
 */
function toImportModelOptions(formatOptions: Record<string, unknown>): Record<string, unknown> {
  const { skipConditions, dialect, ...rest } = formatOptions;
  return {
    ...rest,
    ...(typeof skipConditions === 'boolean' && { conditions: !skipConditions }),
    ...(dialect !== undefined && { sqlDialect: dialect })
  };
}

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  files: readonly WorkspaceFile[];
  onFilesChange: (files: WorkspaceFile[]) => void;
  onFileFocused: (path: string) => void;
  /** namespace -> path, for every workspace file with a resolved model (ExplorePerspective's `namespaceToFile`, built from `resolvedModelFiles` — not limited to open tabs). */
  namespaceToFile: ReadonlyMap<string, string>;
  /** format → z2f-generated options-form component. Supplied by the mount site (ExplorePerspective) so ImportDialog itself never imports a `?z2f` module — see the plan's Global Constraints. */
  optionsFormsByFormat: Record<ImportFormat, React.ComponentType<ImportOptionsFormProps>>;
}

type ImportFormat = Extract<ImportSourceKind, 'json-schema' | 'openapi' | 'sql' | 'xsd'>;

const FORMAT_OPTIONS: Array<{ value: ImportFormat; label: string }> = [
  { value: 'json-schema', label: 'JSON Schema' },
  { value: 'openapi', label: 'OpenAPI' },
  { value: 'sql', label: 'SQL DDL' },
  { value: 'xsd', label: 'XSD' }
];

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'previewed'; result: ImportResult; matchedPath: string | null; merge: MergeResult | null }
  | { kind: 'error'; message: string }
  | { kind: 'internal-error'; message: string };

export const ImportDialog = withInstrumentation(
  function ImportDialog({
    open,
    onClose,
    files,
    onFilesChange,
    onFileFocused,
    namespaceToFile,
    optionsFormsByFormat
  }: ImportDialogProps) {
    const [format, setFormat] = useState<ImportFormat>('json-schema');
    const [sourceText, setSourceText] = useState('');
    const [namespaceField, setNamespaceField] = useState('');
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const errorRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (phase.kind !== 'error' && phase.kind !== 'internal-error') return;
      const frame = requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }));
      return () => cancelAnimationFrame(frame);
    }, [phase.kind]);
    const [formatOptions, setFormatOptions] = useState<Record<string, unknown>>({});
    const [onCollision, setOnCollision] = useState<MergeOptions['onCollision']>(
      () => MergeOptionsSchema.parse({}).onCollision
    );

    // Adjusted during render (React's blessed pattern) rather than in
    // effects, so the reset lands in the same update instead of flashing the
    // prior session's stale draft for one frame first. Tracked via useState,
    // NOT a plain ref: a ref mutation made during render is not rolled back
    // if React discards/retries this render under concurrent rendering, while
    // the accompanying setFormat/setSourceText/etc. calls above ARE rolled
    // back (they never committed) — so a bare `prevOpenRef.current = open`
    // could leave the retry believing the transition already happened and
    // skip the reset it never actually performed. useState's setter is
    // itself part of the same discarded/retried unit of work, so it stays in
    // sync (Codex review).
    const [prevOpen, setPrevOpen] = useState(open);
    if (open !== prevOpen) {
      setPrevOpen(open);
      if (open) {
        setFormat('json-schema');
        setSourceText('');
        setNamespaceField('');
        setPhase({ kind: 'idle' });
      }
    }

    // Format switch invalidates any prior preview — it was run against a
    // different reader and no longer reflects the selected format. Same
    // useState-not-ref reasoning as prevOpen above.
    const [prevFormat, setPrevFormat] = useState(format);
    if (format !== prevFormat) {
      setPrevFormat(format);
      setPhase({ kind: 'idle' });
      setFormatOptions({});
    }

    const handlePreview = useCallback(async () => {
      setPhase({ kind: 'previewing' });
      // Cheap local check before any async work: importModel() throws
      // synchronously for `from: 'sql'` with no namespace (SQL DDL has no
      // namespace concept of its own to derive one from) — failing fast here
      // avoids fetching the ~MB-scale SQL grammar WASM for a preview that's
      // already guaranteed to fail.
      if (format === 'sql' && !namespaceField.trim()) {
        setPhase({
          kind: 'error',
          message: 'SQL import requires a namespace — SQL DDL has no namespace concept of its own to derive one from.'
        });
        return;
      }
      try {
        const { importModel } = await import('@rune-langium/codegen/import');
        // The SQL reader's default WASM loading uses node:fs, which doesn't
        // exist in the browser (issue #385) — fetch the grammar bytes
        // ourselves and supply them via wasmSource. Every other format has no
        // WASM step (fast-xml-parser / plain JSON parsing).
        const wasmSource = format === 'sql' ? await getSqlWasmBytes() : undefined;
        const result = await importModel(sourceText, {
          from: format,
          namespace: namespaceField.trim() || undefined,
          ...(wasmSource !== undefined && { wasmSource }),
          ...toImportModelOptions(formatOptions)
        });
        if (!namespaceField.trim()) setNamespaceField(result.model.namespace);

        const matchedPath = namespaceToFile.get(result.model.namespace) ?? null;
        if (matchedPath) {
          const existing = files.find((f) => f.path === matchedPath);
          if (existing) {
            try {
              const merge = await mergeImportedText(existing.content, result.text, { onCollision });
              setPhase({ kind: 'previewed', result, matchedPath, merge });
            } catch (mergeErr) {
              setPhase({
                kind: 'internal-error',
                message: mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
              });
            }
            return;
          }
        }
        // New-file path: importModel() already guarantees result.text parses
        // cleanly, but we re-verify explicitly rather than trusting that blindly.
        const check = await parse(result.text, 'inmemory:///import-check.rosetta');
        if (check.hasErrors) {
          setPhase({ kind: 'internal-error', message: 'Imported text failed re-parse — please file a bug.' });
          return;
        }
        setPhase({ kind: 'previewed', result, matchedPath: null, merge: null });
      } catch (err) {
        setPhase({
          kind: 'error',
          message: (err instanceof Error ? err.message : String(err)).replace(/^rune-codegen import:\s*/, '')
        });
      }
    }, [sourceText, format, namespaceField, namespaceToFile, files, formatOptions, onCollision]);

    const handleConfirm = useCallback(() => {
      if (phase.kind !== 'previewed') return;
      const { result, matchedPath, merge } = phase;
      if (matchedPath && merge) {
        onFilesChange(updateFileContent(files, matchedPath, merge.mergedText));
        onFileFocused(matchedPath);
      } else {
        const path = uniqueFilePath(`${result.model.namespace}.rosetta`, files);
        const file = createWorkspaceFile(path, result.text);
        onFilesChange([...files, file]);
        onFileFocused(file.path);
      }
      onClose();
    }, [phase, files, onFilesChange, onFileFocused, onClose]);

    const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      void file.text().then(setSourceText);
    }, []);

    const nothingToImport =
      phase.kind === 'previewed' &&
      phase.result.model.types.length === 0 &&
      phase.result.model.enums.length === 0 &&
      phase.result.model.funcs.length === 0;

    const confirmDisabled = phase.kind !== 'previewed' || nothingToImport;
    const confirmLabel =
      phase.kind === 'previewed' && phase.matchedPath ? `Merge into ${phase.matchedPath}` : 'Add to workspace';

    return (
      <InteractiveDialog
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title="Import Model"
        description="Pick a source format, provide the source, preview the generated model, and add it to the workspace."
        width="w-[640px]"
        testId="import-dialog"
        bodyClassName="studio-scroll p-4 gap-4 overflow-auto"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose} data-testid="import-dialog__cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={confirmDisabled} data-testid="import-dialog__confirm">
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="import-dialog-format">
            Format:
          </label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as ImportFormat)}
            disabled={phase.kind === 'previewing'}
          >
            <SelectTrigger id="import-dialog-format" size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className="border border-dashed border-border rounded p-3 text-xs text-muted-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          data-testid="import-dialog__dropzone"
        >
          Drop a file here, or paste the source below.
        </div>

        <details className="text-xs">
          <summary>How to import a model</summary>
          <p className="mt-2 text-muted-foreground">
            Paste a schema in the selected format, or drop its file above. Enter a namespace such as example.quote
            (required for SQL), then select Preview. Review the Rune model before adding it; Cancel leaves your
            workspace unchanged.
          </p>
          {format === 'json-schema' ? (
            <pre
              className="studio-scroll mt-2 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono"
              aria-label="JSON Schema import example"
            >
              {'{ "$defs": { "Quote": { "type": "object", "properties": { "amount": { "type": "number" } } } } }'}
            </pre>
          ) : null}
        </details>
        <Textarea
          aria-label="Import source"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Paste source text…"
          className="min-h-32 bg-background font-mono text-xs"
          data-testid="import-dialog__source"
        />

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="import-dialog-namespace">
            Namespace:
          </label>
          <Input
            id="import-dialog-namespace"
            value={namespaceField}
            onChange={(e) => setNamespaceField(e.target.value)}
            placeholder="(derived from source)"
            className="flex-1"
            data-testid="import-dialog__namespace"
          />
          <Button size="sm" onClick={() => void handlePreview()} disabled={!sourceText || phase.kind === 'previewing'}>
            Preview
          </Button>
        </div>

        {(() => {
          const OptionsForm = optionsFormsByFormat[format];
          return <OptionsForm value={formatOptions} onChange={setFormatOptions} />;
        })()}

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium" htmlFor="import-dialog-on-collision">
            On collision:
          </label>
          <Select value={onCollision} onValueChange={(v) => setOnCollision(v as MergeOptions['onCollision'])}>
            <SelectTrigger
              id="import-dialog-on-collision"
              size="sm"
              className="w-40"
              data-testid="import-dialog__on-collision"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip</SelectItem>
              <SelectItem value="overwrite">Overwrite</SelectItem>
              <SelectItem value="rename">Rename</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Previewing state */}
        {phase.kind === 'previewing' && (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="import-dialog__previewing"
          >
            <Spinner className="size-4" />
            Importing…
          </div>
        )}

        {phase.kind === 'error' && (
          <Alert ref={errorRef} className="shrink-0" variant="destructive" data-testid="import-dialog__error">
            <AlertTitle>Could not preview model</AlertTitle>
            <AlertDescription>
              <p>{phase.message}</p>
              <p className="mt-2 text-xs">
                Correct the source and select Preview again. Your workspace has not changed.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {phase.kind === 'internal-error' && (
          <Alert ref={errorRef} variant="destructive" data-testid="import-dialog__internal-error">
            <AlertTitle>Internal error</AlertTitle>
            <AlertDescription>{phase.message}</AlertDescription>
          </Alert>
        )}

        {phase.kind === 'previewed' && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="import-dialog__summary">
              {phase.result.model.types.length} type(s), {phase.result.model.enums.length} enum(s),{' '}
              {phase.result.model.funcs.length} func(s) · {phase.result.diagnostics.length} diagnostic(s)
            </p>
            {nothingToImport && (
              <Alert data-testid="import-dialog__empty">
                <AlertDescription>
                  Nothing to import — the source produced no types, enums, or functions.
                </AlertDescription>
              </Alert>
            )}
            {phase.matchedPath && phase.merge && (
              <Alert data-testid="import-dialog__merge-banner">
                <AlertDescription>
                  Will merge into <span className="font-mono">{phase.matchedPath}</span>
                  {phase.merge.skipped.length > 0 &&
                    ` — ${phase.merge.skipped.length} declaration(s) skipped, already exist: ${phase.merge.skipped.join(', ')}`}
                  {phase.merge.overwritten.length > 0 &&
                    ` — ${phase.merge.overwritten.length} declaration(s) will be overwritten: ${phase.merge.overwritten.join(', ')}`}
                  {phase.merge.renamed.length > 0 &&
                    ` — ${phase.merge.renamed.length} declaration(s) renamed to avoid collision: ${phase.merge.renamed
                      .map((r) => `${r.from} → ${r.to}`)
                      .join(', ')}`}
                </AlertDescription>
              </Alert>
            )}
            <CodeBlock
              className="studio-scroll flex-1 min-h-0 bg-background text-xs whitespace-pre overflow-auto"
              data-testid="import-dialog__preview"
            >
              {phase.matchedPath && phase.merge ? phase.merge.mergedText : phase.result.text}
            </CodeBlock>
          </>
        )}
      </InteractiveDialog>
    );
  },
  { op: 'ImportDialog' }
);
