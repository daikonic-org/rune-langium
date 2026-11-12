// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import type { GeneratorDiagnostic } from '@rune-langium/codegen/export';
import type { ExportRunState } from '../../store/export-workbench-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { CircleAlert } from 'lucide-react';
import type { ExportArtifact } from '../../services/export-artifact.js';
import { copyTextToClipboard } from '../../services/clipboard.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@rune-langium/design-system/ui/dialog';

function ArtifactDiagnostics({ diagnostics }: { diagnostics: readonly GeneratorDiagnostic[] }): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (diagnostics.length === 0) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        aria-label={`Show generation diagnostics (${diagnostics.length})`}
      >
        <CircleAlert className="size-3.5" aria-hidden="true" />
        Diagnostics ({diagnostics.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Generation diagnostics</DialogTitle>
            <DialogDescription>
              {diagnostics.filter((entry) => entry.severity === 'error').length} errors,{' '}
              {diagnostics.filter((entry) => entry.severity === 'warning').length} warnings
            </DialogDescription>
          </DialogHeader>
          <ul
            data-testid="export-artifact-diagnostics"
            className="studio-scroll min-h-0 overflow-auto wrap-anywhere space-y-2 text-xs text-muted-foreground"
          >
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}`}>
                {diagnostic.severity}: {diagnostic.message}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface ExportPreviewPanelProps {
  run: ExportRunState;
  activeFile?: string;
  onActiveFileChange?(path: string | undefined): void;
  onDownload(): void;
}

type ArtifactRead = {
  artifact: ExportArtifact;
  path: string;
} & ({ status: 'ready'; text: string } | { status: 'failed' });

/** Read-only display of the current captured export artifact. */
export const ExportPreviewPanel = withInstrumentation(
  function ExportPreviewPanel({
    run,
    activeFile,
    onActiveFileChange,
    onDownload
  }: ExportPreviewPanelProps): ReactElement {
    const [read, setRead] = useState<ArtifactRead>();
    const [readAttempt, setReadAttempt] = useState(0);
    const [uncontrolledPath, setUncontrolledPath] = useState<string | undefined>();
    const [copyStatus, setCopyStatus] = useState<string | undefined>();
    const [copyBusy, setCopyBusy] = useState(false);
    const copyRequest = useRef(0);
    const selectedPath = activeFile ?? uncontrolledPath;
    const artifact =
      run.status === 'ready' || run.status === 'stale'
        ? run.artifact
        : run.status === 'generating' || run.status === 'failed'
          ? run.previous?.artifact
          : undefined;
    const textFiles = artifact?.manifest.files.filter((file) => file.kind === 'text') ?? [];
    const textFile =
      textFiles.find((file) => file.path === selectedPath) ??
      textFiles.find((file) =>
        artifact?.manifest.resolvedSelection?.explicit.some((root) => file.namespaces?.includes(root.namespace))
      ) ??
      textFiles[0];
    // A result belongs to an exact captured artifact/file, including the render
    // before the next effect runs. Never offer a previous file's bytes as current.
    const currentRead = read?.artifact === artifact && read?.path === textFile?.path ? read : undefined;
    const text = currentRead?.status === 'ready' ? currentRead.text : undefined;
    const dependencyCount = artifact?.manifest.resolvedSelection
      ? Math.max(
          0,
          artifact.manifest.resolvedSelection.included.length - artifact.manifest.resolvedSelection.explicit.length
        )
      : 0;
    const dependencyNames = artifact?.manifest.resolvedSelection
      ? artifact.manifest.resolvedSelection.included
          .filter(
            (included) =>
              !artifact.manifest.resolvedSelection!.explicit.some(
                (explicit) =>
                  explicit.namespace === included.namespace &&
                  explicit.kind === included.kind &&
                  explicit.name === included.name
              )
          )
          .map((declaration) => `${declaration.namespace}.${declaration.name}`)
      : [];

    useEffect(() => {
      if (!textFiles.some((file) => file.path === selectedPath)) {
        const nextPath = textFile?.path;
        setUncontrolledPath(nextPath);
        onActiveFileChange?.(nextPath);
      }
    }, [onActiveFileChange, selectedPath, textFiles, textFile?.path]);

    useEffect(() => {
      let active = true;
      setRead(undefined);
      setCopyStatus(undefined);
      setCopyBusy(false);
      copyRequest.current++;
      if (!artifact || !textFile) return;
      const path = textFile.path;
      void (async () => {
        try {
          const text = await artifact.readText(path);
          if (active) setRead({ artifact, path, status: 'ready', text });
        } catch {
          if (active) setRead({ artifact, path, status: 'failed' });
        }
      })();
      return () => {
        active = false;
        copyRequest.current++;
      };
    }, [artifact, textFile?.path, readAttempt]);

    async function copyActiveFile(): Promise<void> {
      if (text === undefined || copyBusy) return;
      const request = ++copyRequest.current;
      setCopyBusy(true);
      setCopyStatus(undefined);
      const error = await copyTextToClipboard(text);
      if (copyRequest.current === request) {
        setCopyStatus(error ?? 'Copied');
        setCopyBusy(false);
      }
    }

    const statusNotice =
      run.status === 'generating' ? (
        <p
          role="status"
          id="export-run-status"
          data-testid="export-artifact-status"
          className="shrink-0 p-3 text-sm text-muted-foreground"
        >
          Generating export… {artifact ? 'Previous output is shown below.' : null}
        </p>
      ) : run.status === 'failed' ? (
        <div
          id="export-run-status"
          role="alert"
          data-testid="export-artifact-status"
          className="shrink-0 wrap-anywhere space-y-2 p-3 text-sm text-destructive"
        >
          <p>{run.message}</p>
          <ArtifactDiagnostics diagnostics={run.diagnostics} />
          {artifact ? <p className="text-xs">Previous output is shown below.</p> : null}
        </div>
      ) : null;

    if (!artifact && statusNotice) return statusNotice;
    if (!artifact) {
      return (
        <p id="export-run-status" data-testid="export-artifact-status" className="p-3 text-sm text-muted-foreground">
          No export artifact yet. Select declarations or a saved target, then generate.
        </p>
      );
    }
    if (!textFile) {
      return (
        <div data-testid="export-artifact-binary" className="space-y-3 p-3">
          {statusNotice}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">This export contains binary files only.</p>
            <Button type="button" size="sm" disabled={run.status !== 'ready'} onClick={onDownload}>
              Download export
            </Button>
          </div>
          <ArtifactDiagnostics diagnostics={artifact.manifest.diagnostics} />
        </div>
      );
    }
    return (
      <section data-testid="export-artifact-preview" className="flex h-full min-h-0 flex-col">
        {statusNotice}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={textFile.path}>
            {textFile.path}
          </span>
          {dependencyCount > 0 && (
            <span
              className="text-xs text-muted-foreground"
              title="Declarations added because selected roots reference them"
            >
              Includes {dependencyCount} dependency {dependencyCount === 1 ? 'declaration' : 'declarations'}
            </span>
          )}
          {textFiles.length > 1 && (
            <div className="w-52 min-w-0 max-w-full">
              <NativeSelect
                aria-label="Generated export file"
                size="default"
                className="truncate"
                title={textFile.path}
                value={textFile.path}
                onChange={(event) => {
                  setUncontrolledPath(event.target.value);
                  onActiveFileChange?.(event.target.value);
                }}
              >
                {textFiles.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {currentRead?.status === 'failed'
              ? 'Preview unavailable'
              : text === undefined
                ? 'Loading file…'
                : run.status === 'ready'
                  ? 'Ready'
                  : 'Outdated'}
          </span>
          <ArtifactDiagnostics diagnostics={artifact.manifest.diagnostics} />
          <Button
            type="button"
            size="sm"
            disabled={text === undefined || copyBusy}
            onClick={() => void copyActiveFile()}
          >
            {copyBusy ? 'Copying…' : copyStatus === 'Copied' ? 'Copied' : 'Copy file'}
          </Button>
          <Button type="button" size="sm" disabled={run.status !== 'ready'} onClick={onDownload}>
            Download export
          </Button>
        </div>
        {dependencyNames.length > 0 && (
          <details className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">
            <summary>Included dependencies ({dependencyNames.length})</summary>
            <p className="max-h-32 overflow-auto wrap-anywhere studio-scroll">Included: {dependencyNames.join(', ')}</p>
          </details>
        )}
        {copyStatus && (
          <p role="status" className="shrink-0 wrap-anywhere px-3 py-1 text-xs text-muted-foreground">
            {copyStatus}
          </p>
        )}
        {currentRead?.status === 'failed' ? (
          <div className="studio-scroll min-h-0 flex-1 overflow-auto space-y-2 p-3">
            <p role="alert" className="wrap-anywhere text-sm text-destructive">
              Couldn’t read this generated file. Try loading it again or choose another file.
            </p>
            <Button size="sm" variant="outline" onClick={() => setReadAttempt((attempt) => attempt + 1)}>
              Retry file
            </Button>
          </div>
        ) : (
          <pre
            tabIndex={0}
            aria-busy={text === undefined}
            className="studio-scroll min-h-0 flex-1 overflow-auto p-3 text-xs whitespace-pre focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            aria-label="Generated export code"
          >
            {text ?? 'Loading artifact…'}
          </pre>
        )}
      </section>
    );
  },
  { op: 'ExportPreviewPanel' }
);
