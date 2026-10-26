// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@rune-langium/design-system/ui/tabs';
import { projectInitializationStatus } from '@rune-langium/project-runtime/status';
import { ProjectInitializationEvidence } from '../../components/ProjectInitializationEvidence.js';
import { ExportSelect } from '../../components/ExportSelect.js';
import { IMPLEMENTED_TARGETS, TARGET_DESCRIPTORS, type Target } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import type { ExportConfig } from '../../services/export-request.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { TARGET_OPTION_FORMS, TARGET_PANELS } from '../../components/export-target-settings.js';
import type { ProjectSnapshot, ProjectDiagnostic } from '@rune-langium/project-config';
import type { ExportRunState } from '../../store/export-workbench-store.js';

export interface ExportSettingsPanelProps {
  config: ExportConfig;
  onChange(config: ExportConfig): void;
  onGenerate(): void;
  onCancel(): void;
  status: ExportRunState['status'];
  projectSnapshot?: ProjectSnapshot;
  projectDiagnostics?: readonly ProjectDiagnostic[];
  selectedTargetName?: string;
  targetDirty?: boolean;
  dirtyTargets?: readonly string[];
  onRemoveTarget?(name: string): Promise<unknown>;
  onSelectTarget?(name: string | undefined): void;
  onSaveTarget?(name: string): Promise<void>;
  onBuildTargets?(names: readonly string[] | 'all'): void;
  onReloadProject?(): Promise<void>;
  projectEnabled?: boolean;
}

/** Target and layout controls for a declaration-scoped export. */
export const ExportSettingsPanel = withInstrumentation(
  function ExportSettingsPanel({
    config,
    onChange,
    onGenerate,
    onCancel,
    status,
    projectSnapshot,
    projectDiagnostics = projectSnapshot?.project.diagnostics ?? [],
    selectedTargetName,
    targetDirty,
    dirtyTargets = [],
    onRemoveTarget,
    onSelectTarget,
    onSaveTarget,
    onBuildTargets,
    onReloadProject,
    projectEnabled
  }: ExportSettingsPanelProps) {
    const [name, setName] = useState(selectedTargetName ?? '');
    const [adding, setAdding] = useState(false);
    const nameInput = useRef<HTMLInputElement>(null);
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => setName(selectedTargetName ?? ''), [selectedTargetName]);
    const targets = projectSnapshot?.project.build.targets ?? {};
    const hasDirtyTargets = Object.keys(targets).some((name) => dirtyTargets.includes(name));
    const initialization = projectSnapshot && projectInitializationStatus(projectSnapshot, [], projectDiagnostics);
    const unavailableTargets = new Set(
      initialization?.targets.filter((target) => target.status === 'unavailable').map((target) => target.name)
    );
    const globalErrors = projectDiagnostics.filter((issue) => !issue.target && issue.severity === 'error');
    const blocked = status === 'generating' || saving || globalErrors.length > 0;
    const activeTab = adding ? 'draft:new' : selectedTargetName ? `target:${selectedTargetName}` : 'draft:oneoff';
    const target = config.target;
    const panel = TARGET_PANELS[target];
    const OptionsForm = TARGET_OPTION_FORMS[target];
    const targetOptions = (config.options[target] as Record<string, unknown> | undefined) ?? {};
    const selectionCount = config.selection.namespaces.length + config.selection.declarations.length;
    return (
      <Tabs
        data-testid="export-settings-panel"
        value={activeTab}
        onValueChange={(value) => {
          setAdding(value === 'draft:new');
          if (value !== 'draft:new')
            onSelectTarget?.(typeof value === 'string' && value.startsWith('target:') ? value.slice(7) : undefined);
          setMessage('');
        }}
        className="flex h-full flex-col gap-3 overflow-y-auto p-2"
      >
        <div>
          <h2 className="text-sm font-semibold">Export settings</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {projectEnabled
              ? 'Generate selected declarations or build saved project targets.'
              : 'Choose a target and generate the selected declarations.'}
          </p>
        </div>
        {projectEnabled && (
          <div className="flex items-center gap-1 border-b border-border">
            <TabsList size="sm" aria-label="Export targets" className="min-w-0 flex-1 overflow-x-auto">
              <TabsTrigger value="draft:oneoff" disabled={blocked}>
                One-off
              </TabsTrigger>
              {Object.keys(targets).map((name) => (
                <TabsTrigger key={name} value={`target:${name}`} aria-label={name} disabled={blocked}>
                  {name}
                  {dirtyTargets.includes(name) ? ' *' : ''}
                </TabsTrigger>
              ))}
              {adding && <TabsTrigger value="draft:new">New target</TabsTrigger>}
            </TabsList>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add target"
              title="Add target"
              disabled={blocked}
              onClick={() => {
                onSelectTarget?.(undefined);
                setAdding(true);
                setName('');
                setMessage('');
                requestAnimationFrame(() => nameInput.current?.focus());
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
        <TabsContent value={activeTab} className="mt-0 flex min-h-0 flex-1 flex-col gap-3">
          {projectEnabled && (
            <div className="flex flex-col gap-2 border-b border-border pb-3">
              {initialization && <ProjectInitializationEvidence status={initialization} />}
              <div className="flex min-w-0 gap-1.5">
                <Input
                  ref={nameInput}
                  aria-label="Target name"
                  readOnly={Boolean(selectedTargetName) && !adding}
                  placeholder="Target name"
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  disabled={blocked || !name.trim() || !projectSnapshot}
                  onClick={() => {
                    setSaving(true);
                    setMessage('');
                    void onSaveTarget?.(name.trim())
                      .then(() => {
                        setAdding(false);
                        setMessage('Target settings saved to build configuration.');
                      })
                      .catch((error) => setMessage(error instanceof Error ? error.message : 'Save failed. Try again.'))
                      .finally(() => setSaving(false));
                  }}
                >
                  {saving ? 'Saving…' : 'Save target settings'}
                </Button>
                {selectedTargetName && onRemoveTarget && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${selectedTargetName} target`}
                    title="Remove target settings"
                    disabled={blocked}
                    onClick={() => {
                      setSaving(true);
                      setMessage('');
                      void onRemoveTarget(selectedTargetName)
                        .then(() => setMessage('Target removed. Generated files are retained.'))
                        .catch((error) => setMessage(String(error)))
                        .finally(() => setSaving(false));
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
              {targetDirty && (
                <p className="text-xs text-muted-foreground">Unsaved target settings. Build uses the saved settings.</p>
              )}
              {selectedTargetName && (
                <p className="break-words text-xs text-muted-foreground">
                  Output: {targets[selectedTargetName]?.output}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 self-start px-0 text-xs"
                disabled={blocked}
                onClick={() => {
                  setMessage('');
                  void onReloadProject?.().catch((error) => setMessage(String(error)));
                }}
              >
                Reload project files
              </Button>
              {message && (
                <p role="status" className="text-xs">
                  {message}
                </p>
              )}
              {projectDiagnostics.map((issue, index) => (
                <p
                  key={index}
                  role={issue.severity === 'error' ? 'alert' : undefined}
                  className="text-xs text-destructive"
                >
                  {issue.target ? issue.target + ': ' : ''}
                  {issue.message}
                </p>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Target
            <ExportSelect
              aria-label="Export target"
              value={target}
              onChange={(event) => onChange({ ...config, target: event.target.value as Target })}
            >
              {!IMPLEMENTED_TARGETS.includes(target) && (
                <option value={target} disabled>
                  {target} — provider unavailable
                </option>
              )}
              {IMPLEMENTED_TARGETS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {TARGET_DESCRIPTORS[candidate].label}
                </option>
              ))}
            </ExportSelect>
          </label>
          {panel && (
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Layout
              <ExportSelect
                aria-label="Export layout"
                value={(targetOptions.layout as string | undefined) ?? panel.defaultLayout ?? ''}
                onChange={(event) =>
                  onChange({
                    ...config,
                    options: { ...config.options, [target]: { ...targetOptions, layout: event.target.value } }
                  })
                }
              >
                {panel.layouts.map((layout) => (
                  <option key={layout.value} value={layout.value}>
                    {layout.label}
                    {layout.hint ? ` — ${layout.hint}` : ''}
                  </option>
                ))}
              </ExportSelect>
            </label>
          )}
          {OptionsForm && (
            <div className="flex flex-col gap-1.5" data-testid="export-target-options">
              <span className="text-xs font-medium">Options</span>
              <OptionsForm
                key={`${selectedTargetName ?? target}:${projectSnapshot?.revision ?? 'draft'}`}
                value={targetOptions}
                onChange={(options) => onChange({ ...config, options: { ...config.options, [target]: options } })}
              />
            </div>
          )}
          {status === 'generating' ? (
            <Button type="button" className="mt-auto" variant="secondary" onClick={onCancel}>
              Cancel generation
            </Button>
          ) : selectedTargetName && !adding ? (
            <div className="mt-auto space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={blocked || targetDirty || unavailableTargets.has(selectedTargetName)}
                  onClick={() => onBuildTargets?.([selectedTargetName])}
                >
                  Generate target
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked || hasDirtyTargets || unavailableTargets.size > 0}
                  onClick={() => onBuildTargets?.('all')}
                >
                  Generate all
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Uses saved namespace scope and writes output to the workspace.
              </p>
            </div>
          ) : (
            <div className="mt-auto flex flex-wrap gap-2">
              <Button type="button" disabled={selectionCount === 0 || blocked || adding} onClick={onGenerate}>
                {status === 'failed' ? `Retry ${selectionCount} selected` : `Generate ${selectionCount} selected`}
              </Button>
              {projectEnabled && Object.keys(targets).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked || hasDirtyTargets || unavailableTargets.size > 0 || adding}
                  onClick={() => onBuildTargets?.('all')}
                >
                  Generate all
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    );
  },
  { op: 'ExportSettingsPanel' }
);
