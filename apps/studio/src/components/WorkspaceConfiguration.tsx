// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { canonicalProjectJson, StudioConfigSchema, type ProjectSnapshot } from '@rune-langium/project-config';
import { Button } from '@rune-langium/design-system/ui/button';
import { ArrowUpRight } from 'lucide-react';
import { useProject } from '../shell/providers/project-context.js';
import { usePerspectiveStore } from '../store/perspective-store.js';
import { saveWorkspaceConfiguration } from '../workspace/workspace-configuration-repository.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface WorkspaceDirectoriesFormProps {
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
}

function Directories({
  snapshot,
  Form
}: {
  snapshot: ProjectSnapshot;
  Form: ComponentType<WorkspaceDirectoriesFormProps>;
}) {
  const project = useProject();
  const [baseline, setBaseline] = useState(snapshot);
  const [value, setValue] = useState<Record<string, unknown>>(snapshot.project.studio);
  const [reset, setReset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const seenRevision = useRef(snapshot.revision);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const checked = StudioConfigSchema.safeParse({ ...value, schemaVersion: 1 });
  const dirty = canonicalProjectJson(value) !== canonicalProjectJson(baseline.project.studio);
  const reload = (next: ProjectSnapshot) => {
    setBaseline(next);
    setValue(next.project.studio);
    setReset((n) => n + 1);
    setError('');
    setSaved(false);
  };
  useEffect(() => {
    if (snapshot.revision === seenRevision.current) return;
    seenRevision.current = snapshot.revision;
    if (!dirty && !saving) {
      if (canonicalProjectJson(value) === canonicalProjectJson(snapshot.project.studio)) setBaseline(snapshot);
      else reload(snapshot);
    }
  }, [snapshot, dirty, saving, value]);
  const save = async () => {
    if (!checked.success || !project.controller) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await saveWorkspaceConfiguration(project.controller, baseline, checked.data);
      if (active.current) {
        reload(next);
        setSaved(true);
      }
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : 'Settings could not be saved. Your edits are retained.');
    } finally {
      if (active.current) setSaving(false);
    }
  };
  return (
    <div className="max-w-lg space-y-3">
      <h3 className="text-sm font-medium">Workspace directories</h3>
      <p className="text-xs text-muted-foreground">
        Saved in Studio configuration YAML. Changing a directory does not move existing files.
      </p>
      <fieldset disabled={saving || project.status !== 'ready'} className="space-y-3">
        <Form
          key={reset}
          value={value}
          onChange={(next) => {
            const complete = { ...next, schemaVersion: 1 };
            if (canonicalProjectJson(value) === canonicalProjectJson(complete)) return;
            setValue(complete);
            setSaved(false);
          }}
        />
        {!checked.success && (
          <p role="alert" className="text-xs text-destructive">
            {checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ')}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button size="xs" disabled={!dirty || !checked.success || !project.controller} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save workspace settings'}
          </Button>
          <Button size="xs" variant="ghost" disabled={saving} onClick={() => reload(snapshot)}>
            Reload settings
          </Button>
          {saved && (
            <span role="status" className="text-xs text-muted-foreground">
              Workspace settings saved.
            </span>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error} Reload settings to review the current files.
        </p>
      )}
    </div>
  );
}

export const WorkspaceConfiguration = withInstrumentation(
  function WorkspaceConfiguration({ Form }: { Form?: ComponentType<WorkspaceDirectoriesFormProps> }) {
    const project = useProject();
    const navigate = usePerspectiveStore((state) => state.setActivePerspective);
    const openWorkspaces = usePerspectiveStore((state) => state.openWorkspaces);
    const snapshot = project.snapshot;
    const references = Object.entries(snapshot?.project.build.references ?? {});
    const targets = Object.entries(snapshot?.project.build.targets ?? {});
    const model = snapshot?.project.rune.model;
    const modelName = model && typeof model === 'object' && 'name' in model ? String(model.name) : undefined;
    return (
      <section data-testid="settings-project-section" className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Workspace configuration</h2>
        {snapshot ? (
          <>
            {modelName && <p className="text-sm">{modelName}</p>}
            <div className="divide-y divide-border max-w-3xl">
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <h3 className="text-sm font-medium">Reference models</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {references.length
                      ? references.map(([name, ref]) => `${name} · ${ref.release}`).join(', ')
                      : 'No reference models configured.'}
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => openWorkspaces('references')}>
                  Manage references <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <h3 className="text-sm font-medium">Export targets</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {targets.length
                      ? targets.map(([name, target]) => `${name} · ${target.generator}`).join(', ')
                      : 'No saved targets configured.'}
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => navigate('export')}>
                  Configure exports <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <h3 className="text-sm font-medium">Repository</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Review the connected repository and commit workspace files.
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => navigate('git')}>
                  Git / Sync <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {Form ? (
              <Directories key={project.workspaceId} snapshot={snapshot} Form={Form} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {project.status === 'loading'
                  ? 'Loading workspace configuration…'
                  : 'Resolve workspace configuration errors before editing settings.'}
              </p>
            )}
            {project.diagnostics.map((issue, index) => (
              <p key={index} role="alert" className="text-xs text-destructive">
                {issue.message}
              </p>
            ))}
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Open a workspace to view and edit its shared configuration.</p>
            <Button variant="ghost" size="xs" onClick={() => openWorkspaces('workspaces')}>
              Open Workspaces <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </section>
    );
  },
  { op: 'WorkspaceConfiguration', capture: 0 }
);
