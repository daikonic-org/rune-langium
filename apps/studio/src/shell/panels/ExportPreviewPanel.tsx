// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import type { GeneratorDiagnostic } from '@rune-langium/codegen/export';
import type { ExportRunState } from '../../store/export-workbench-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { CircleAlert } from 'lucide-react';
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
            className="studio-scroll min-h-0 overflow-auto space-y-2 text-xs text-muted-foreground"
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

/** Read-only display of the current captured export artifact. */
export const ExportPreviewPanel = withInstrumentation(
  function ExportPreviewPanel({
    run,
    activeFile,
    onActiveFileChange,
    onDownload
  }: ExportPreviewPanelProps): ReactElement {
    const [text, setText] = useState<string | undefined>();
    const [uncontrolledPath, setUncontrolledPath] = useState<string | undefined>();
    const [copyStatus, setCopyStatus] = useState<string | undefined>();
    const selectedPath = activeFile ?? uncontrolledPath;
    const artifact =
      run.status === 'ready' || run.status === 'stale'
        ? run.artifact
        : run.status === 'generating' || run.status === 'failed'
          ? run.previous?.artifact
          : undefined;
    const textFiles = artifact?.manifest.files.filter((file) => file.kind === 'text') ?? [];
    const textFile = textFiles.find((file) => file.path === selectedPath) ?? textFiles[0];
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
        const nextPath = textFiles[0]?.path;
        setUncontrolledPath(nextPath);
        onActiveFileChange?.(nextPath);
      }
    }, [onActiveFileChange, selectedPath, textFiles]);

    useEffect(() => {
      let active = true;
      setText(undefined);
      setCopyStatus(undefined);
      if (!artifact || !textFile) return;
      void artifact.readText(textFile.path).then((content) => {
        if (active) setText(content);
      });
      return () => {
        active = false;
      };
    }, [artifact, textFile?.path]);

    async function copyActiveFile(): Promise<void> {
      if (text === undefined) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus('Copied');
      } catch {
        setCopyStatus('Copy failed');
      }
    }

    const statusNotice =
      run.status === 'generating' ? (
        <p id="export-run-status" data-testid="export-artifact-status" className="p-4 text-sm text-muted-foreground">
          Generating export… {artifact ? 'Previous output is shown below.' : null}
        </p>
      ) : run.status === 'failed' ? (
        <div
          id="export-run-status"
          data-testid="export-artifact-status"
          className="space-y-2 p-4 text-sm text-destructive"
        >
          <p>{run.message}</p>
          <ArtifactDiagnostics diagnostics={run.diagnostics} />
          {artifact ? <p className="text-xs">Previous output is shown below.</p> : null}
        </div>
      ) : null;

    if (!artifact && statusNotice) return statusNotice;
    if (!artifact) {
      return (
        <p id="export-run-status" data-testid="export-artifact-status" className="p-4 text-sm text-muted-foreground">
          No export artifact yet.
        </p>
      );
    }
    if (!textFile) {
      return (
        <div data-testid="export-artifact-binary" className="space-y-3 p-4">
          {statusNotice}
          <div className="flex items-center justify-between gap-3">
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{textFile.path}</span>
          {dependencyCount > 0 && (
            <span
              className="text-xs text-muted-foreground"
              title="Declarations added because selected roots reference them"
            >
              Includes {dependencyCount} dependency {dependencyCount === 1 ? 'declaration' : 'declarations'}
            </span>
          )}
          {textFiles.length > 1 && (
            <select
              aria-label="Generated export file"
              className="h-7 max-w-52 rounded border border-input bg-background px-2 text-xs"
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
            </select>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{run.status === 'ready' ? 'Ready' : 'Outdated'}</span>
          <ArtifactDiagnostics diagnostics={artifact.manifest.diagnostics} />
          <Button type="button" size="sm" disabled={text === undefined} onClick={() => void copyActiveFile()}>
            {copyStatus ?? 'Copy file'}
          </Button>
          <Button type="button" size="sm" disabled={run.status !== 'ready'} onClick={onDownload}>
            Download export
          </Button>
        </div>
        {dependencyNames.length > 0 && (
          <details className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">
            <summary>Included dependencies ({dependencyNames.length})</summary>
            <p className="max-h-32 overflow-auto studio-scroll">Included: {dependencyNames.join(', ')}</p>
          </details>
        )}
        <pre
          className="studio-scroll min-h-0 flex-1 overflow-auto p-3 text-xs whitespace-pre"
          aria-label="Generated export code"
        >
          {text ?? 'Loading artifact…'}
        </pre>
      </section>
    );
  },
  { op: 'ExportPreviewPanel' }
);
