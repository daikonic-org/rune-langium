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
import { Save, Plus } from 'lucide-react';
import { useProject } from '../shell/providers/project-context.js';
import { generateUlid } from '../services/ulid.js';
import { saveWorkflow } from '../workspace/workflow-repository.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { useComposeNavigationStore } from '../store/compose-navigation-store.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import { resolveExampleType } from '../workspace/example-identity.js';
export const WorkflowLibrary = withInstrumentation(
  function WorkflowLibrary({
    capture,
    open,
    onBeforeSave,
    onNew,
    disabled = false
  }: {
    capture(id: string, name: string): WorkflowDescriptor;
    open(workflow: WorkflowDescriptor): Promise<void>;
    onBeforeSave?(): void;
    onNew?(): void;
    disabled?: boolean;
  }) {
    const project = useProject();
    const requestedRecipe = useComposeNavigationStore((state) => state.recipe);
    const workspace = useWorkspaceOptional();
    const [created, setCreated] = useState<WorkflowDescriptor>();
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
      setCreated(undefined);
      setName('');
      setBusy(false);
      setError(undefined);
      return () => {
        ++generation.current;
      };
    }, [project.workspaceId]);

    // Reset workspace state before consuming navigation, including Prototype's lazy first mount.
    useEffect(() => {
      if (requestedRecipe) {
        if (requestedRecipe.workspaceId === project.workspaceId) setCreated(requestedRecipe.descriptor);
        useComposeNavigationStore.setState({ recipe: undefined });
      }
    }, [requestedRecipe, project.workspaceId]);

    useEffect(() => {
      if (!created?.function || !workspace) return;
      if (
        !resolveExampleType(
          workspace,
          { typeFqn: `${created.function.namespace}.${created.function.name}`, typeIdentity: created.function },
          'RosettaFunction'
        )
      )
        return;
      const version = ++generation.current;
      setCreated(undefined);
      setBusy(true);
      void open(created)
        .then(
          () => {
            if (version === generation.current) {
              setActive(created.id);
              setSaved(created);
            }
          },
          (failure: unknown) => {
            if (version === generation.current)
              setError(
                failure instanceof Error
                  ? failure.message
                  : 'The function was saved. Choose its recipe to retry opening it.'
              );
          }
        )
        .finally(() => {
          if (version === generation.current) setBusy(false);
        });
    }, [created, workspace, open]);

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
          className="workflow-library flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5"
          aria-label="Named workflows"
        >
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!project.controller || busy || dialog || Boolean(created)}
            onClick={() => {
              try {
                rememberDraft();
              } catch {
                /* Keep incomplete input editing local. */
              }
              useComposeNavigationStore.getState().setCreating(true);
              usePerspectiveStore.getState().setActivePerspective('compose');
            }}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Compose function
          </Button>
          {onNew ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy || dialog}
              onClick={() => {
                try {
                  rememberDraft();
                } catch {
                  /* A new draft can recover from an incomplete recipe. */
                }
                ++generation.current;
                setCreated(undefined);
                onNew();
                setActive(undefined);
                setSaved(undefined);
                setError(undefined);
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New workflow
            </Button>
          ) : null}
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
                onNew?.();
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
              className="workflow-library__picker"
              aria-label="Saved workflow"
              disabled={!project.controller || dialog || busy || Boolean(created)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="workflow-library__options" position="popper" align="start">
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
            disabled={disabled || !project.controller || busy || Boolean(created)}
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
          {busy || created ? (
            <span role="status" className="text-xs text-muted-foreground">
              {created ? 'Loading created function…' : 'Preparing workflow…'}
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
