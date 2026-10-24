// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalProjectJson, readWorkflows, type WorkflowDescriptor } from '@rune-langium/project-config';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { Save } from 'lucide-react';
import { useProject } from '../shell/providers/project-context.js';
import { generateUlid } from '../services/ulid.js';
import { saveWorkflow } from '../workspace/workflow-repository.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
export const WorkflowLibrary = withInstrumentation(
  function WorkflowLibrary({
    capture,
    open,
    onBeforeSave,
    disabled = false
  }: {
    capture(id: string, name: string): WorkflowDescriptor;
    open(workflow: WorkflowDescriptor): Promise<void>;
    onBeforeSave?(): void;
    disabled?: boolean;
  }) {
    const project = useProject();
    const read = useMemo(() => (project.snapshot ? readWorkflows(project.snapshot) : undefined), [project.snapshot]);
    const [active, setActive] = useState<string>();
    const [dialog, setDialog] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const generation = useRef(0);
    const drafts = useRef(new Map<string, WorkflowDescriptor>());
    const [saved, setSaved] = useState<WorkflowDescriptor>();
    useEffect(() => {
      ++generation.current;
      setActive(undefined);
      setSaved(undefined);
      drafts.current.clear();
      setDialog(false);
      setName('');
      setBusy(false);
      setError(undefined);
      return () => {
        ++generation.current;
      };
    }, [project.workspaceId]);

    const current = saved?.id === active ? saved : read?.workflows.find((entry) => entry.id === active);
    // Compare the same canonical recipe that Save writes; results and view state are intentionally absent.
    let dirty = false;
    if (current && !disabled && !busy) {
      try {
        dirty = canonicalProjectJson(capture(current.id, current.name)) !== canonicalProjectJson(current);
      } catch {
        // An incomplete draft must never look saved merely because it cannot yet be captured.
        dirty = true;
      }
    }
    const rememberDraft = () => {
      if (!disabled)
        drafts.current.set(active ?? ':draft', capture(active ?? ':draft', current?.name ?? 'Unsaved workflow'));
    };
    const save = async () => {
      if (!project.controller || !name.trim()) return;
      const version = ++generation.current;
      setBusy(true);
      setError(undefined);
      try {
        const id = active ?? generateUlid();
        const recipe = capture(id, name.trim());
        onBeforeSave?.();
        await saveWorkflow(project.controller, recipe);
        if (version === generation.current) {
          setActive(id);
          setSaved(recipe);
          drafts.current.delete(id);
          setDialog(false);
        }
      } catch (error) {
        if (version === generation.current)
          setError(error instanceof Error ? error.message : 'Workflow Save failed. Its draft is retained.');
      } finally {
        if (version === generation.current) setBusy(false);
      }
    };
    return (
      <>
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5"
          aria-label="Named workflows"
        >
          <Select
            value={active ?? ':draft'}
            onValueChange={(id) => {
              if (!id || id === active) return;
              try {
                rememberDraft();
              } catch (error) {
                setError(error instanceof Error ? error.message : 'This draft could not be retained.');
                return;
              }
              const stored = read?.workflows.find((entry) => entry.id === id);
              const workflow = drafts.current.get(id) ?? stored;
              if (id === ':draft' && !workflow) {
                setActive(undefined);
                setSaved(undefined);
                return;
              }
              if (!workflow) return;
              const version = ++generation.current;
              setBusy(true);
              setError(undefined);
              void open(workflow)
                .then(
                  () => {
                    if (version === generation.current) {
                      setActive(id === ':draft' ? undefined : id);
                      setSaved(stored);
                    }
                  },
                  (error: unknown) => {
                    if (version === generation.current && !(error instanceof Error && error.name === 'AbortError'))
                      setError(
                        error instanceof Error
                          ? error.message
                          : 'The workflow could not be opened. Its recipe is retained.'
                      );
                  }
                )
                .finally(() => {
                  if (version === generation.current) setBusy(false);
                });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-52 max-w-full"
              aria-label="Saved workflow"
              disabled={!project.controller || dialog || busy}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=":draft">Unsaved workflow</SelectItem>
              {read?.workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || !project.controller || busy}
            onClick={() => {
              setName(current?.name ?? '');
              setError(undefined);
              setDialog(true);
            }}
          >
            <Save className="size-3.5" aria-hidden="true" />
            Save workflow…
          </Button>
          {dirty ? (
            <span
              role="status"
              className="rounded border border-border bg-accent/50 px-1.5 py-0.5 text-xs text-muted-foreground"
              title="Draft retained while switching workflows in this session. Save workflow to update repository files."
            >
              Unsaved changes
            </span>
          ) : null}
          {busy ? (
            <span role="status" className="text-xs text-muted-foreground">
              Preparing workflow…
            </span>
          ) : null}
          {!dialog && error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {read?.diagnostics.length ? (
            <span
              className="text-xs text-muted-foreground"
              title={read.diagnostics.map((issue) => issue.message).join('\n')}
            >
              {read.diagnostics.length} recipe diagnostics
            </span>
          ) : null}
        </div>
        <Dialog
          open={dialog}
          onOpenChange={(next) => {
            if (!busy) setDialog(next);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Save workflow</DialogTitle>
              <DialogDescription>
                Save input bindings and output names. Execution results and personal view settings stay local.
              </DialogDescription>
            </DialogHeader>
            <Input aria-label="Workflow name" value={name} onChange={(event) => setName(event.target.value)} />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button size="xs" disabled={!name.trim() || busy} onClick={() => void save()}>
                Save workflow
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  },
  { op: 'WorkflowLibrary', capture: 0, sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' }) }
);
