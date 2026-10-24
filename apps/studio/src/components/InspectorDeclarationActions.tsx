// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';
import { useEffect, useRef, useState } from 'react';
import { CopyPlus, GitBranchPlus } from 'lucide-react';
import { splitNodeId } from '@rune-langium/visual-editor';
import { kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import {
  canExtendDeclaration,
  localDeclarationError,
  prepareLocalDeclaration,
  modifyProjectDeclaration,
  type LocalDeclarationMode,
  type LocalDeclarationRequest
} from '../services/local-declaration.js';
import type { WorkspaceFile } from '../services/workspace.js';
import type { ProjectSnapshot } from '@rune-langium/project-config';
import { useProject } from '../shell/providers/project-context.js';
import { useProjectPreviewReadiness } from '../shell/providers/preview-session-context.js';

export interface InspectorDeclarationActionsProps {
  nodeId: string;
  refOnly: boolean;
  ready: boolean;
  getSnapshot(): Pick<LocalDeclarationRequest, 'files' | 'models'>;
  onCreate(files: WorkspaceFile[]): void;
  onSaved?(saved: ProjectSnapshot, request: LocalDeclarationRequest, previous: ProjectSnapshot): void;
  flush(): Promise<void>;
}

/** Workspace creation stays with the host; declaration forms only expose a title slot. */
export const InspectorDeclarationActions = withInstrumentation(
  function InspectorDeclarationActions({
    nodeId,
    refOnly,
    ready,
    getSnapshot,
    onCreate,
    onSaved,
    flush
  }: InspectorDeclarationActionsProps) {
    const project = useProject();
    const projectReadiness = useProjectPreviewReadiness();
    const managed = Boolean(project.runtime && project.runtime.status !== 'legacy');
    const abortRef = useRef<AbortController | null>(null);
    const origin = splitNodeId(nodeId);
    const [mode, setMode] = useState<LocalDeclarationMode>();
    const [namespace, setNamespace] = useState(`local.${origin.namespace}`);
    const [name, setName] = useState(origin.name);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const attempt = useRef(0);
    useEffect(
      () => () => {
        attempt.current++;
        abortRef.current?.abort();
      },
      []
    );
    const extendable = canExtendDeclaration(kindFromNodeId(nodeId) ?? '');
    if (!extendable && !refOnly) return null;
    const open = (next: LocalDeclarationMode) => {
      setMode(next);
      setName(next === 'extend' ? `${origin.name}Extension` : origin.name);
      setNamespace(`local.${origin.namespace}`);
      setError(undefined);
    };
    const finishClose = () => {
      attempt.current++;
      abortRef.current?.abort();
      setMode(undefined);
      setBusy(false);
    };
    const close = () => {
      if (!busy || !managed) finishClose();
    };
    const create = async () => {
      if (!mode || busy) return;
      const token = ++attempt.current;
      const abort = new AbortController();
      abortRef.current = abort;
      setBusy(true);
      setError(undefined);
      try {
        await flush();
        if (attempt.current !== token) return;
        const request = { mode, nodeId, namespace: namespace.trim(), name: name.trim(), ...getSnapshot() };
        if (managed) {
          if (!project.controller || !projectReadiness || !onSaved)
            throw new Error('Managed project Save is unavailable. Reload the workspace and retry.');
          const previous = await project.controller.load();
          const applied = await projectReadiness.ensureSaved(previous.revision, abort.signal);
          if (attempt.current !== token) return;
          const captured = {
            ...request,
            projectReceipt: applied.receipt,
            projectReferenceDocuments: applied.referenceDocuments,
            signal: abort.signal
          };
          const saved = await modifyProjectDeclaration(captured, project.controller);
          if (attempt.current !== token) return;
          onSaved(saved, captured, previous);
          finishClose();
          return;
        }
        const files = await prepareLocalDeclaration(request);
        if (attempt.current !== token) return;
        // Validate against current files again: another action may have created the same identity.
        const conflict = localDeclarationError({ ...request, ...getSnapshot() });
        if (conflict) throw new Error(conflict);
        onCreate(files);
        finishClose();
      } catch (failure) {
        if (attempt.current === token)
          setError(failure instanceof Error ? failure.message : 'Could not create the declaration. Try again.');
      } finally {
        if (attempt.current === token) setBusy(false);
      }
    };
    return (
      <>
        <span className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Declaration actions">
          {extendable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!ready}
              onClick={() => open('extend')}
              aria-label="Extend declaration"
              title="Extend"
            >
              <GitBranchPlus className="size-3.5" />
            </Button>
          )}
          {refOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!ready}
              onClick={() => open('modify')}
              aria-label="Modify local copy"
              title="Modify — create an editable local copy"
            >
              <CopyPlus className="size-3.5" />
            </Button>
          )}
        </span>
        <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && close()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{mode === 'extend' ? `Extend ${origin.name}` : `Modify ${origin.name}`}</DialogTitle>
              <DialogDescription>
                {mode === 'extend'
                  ? 'Create a local declaration that inherits from this one.'
                  : managed
                    ? 'Save an editable copy and an explicit replacement mapping in your workspace. References to the original will use your implementation.'
                    : 'Create an editable copy in your workspace. The curated original stays unchanged; select the local copy to use your implementation.'}
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="grid gap-1 text-sm">
                Local namespace
                <Input
                  value={namespace}
                  onChange={(event) => {
                    setNamespace(event.target.value);
                    setError(undefined);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Name
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(undefined);
                  }}
                  readOnly={mode === 'modify'}
                  disabled={busy}
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={close} disabled={busy && managed}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={busy || !namespace.trim() || !name.trim()}>
                  {busy ? 'Creating…' : mode === 'extend' ? 'Create extension' : 'Create local copy'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </>
    );
  },
  { op: 'InspectorDeclarationActions', capture: 0 }
);
