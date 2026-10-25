// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, useEffect } from 'react';
import { projectInitializationStatus } from '@rune-langium/project-runtime/status';
import { ProjectInitializationEvidence } from '../../components/ProjectInitializationEvidence.js';
import { ExportSelect } from '../../components/ExportSelect.js';
import { IMPLEMENTED_TARGETS, TARGET_DESCRIPTORS, type Target } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
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
    onSelectTarget,
    onSaveTarget,
    onBuildTargets,
    onReloadProject,
    projectEnabled
  }: ExportSettingsPanelProps) {
    const [name, setName] = useState(selectedTargetName ?? '');
    const [selectedBuilds, setSelectedBuilds] = useState<string[]>([]);
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => setName(selectedTargetName ?? ''), [selectedTargetName]);
    const targets = projectSnapshot?.project.build.targets ?? {};
    const initialization = projectSnapshot && projectInitializationStatus(projectSnapshot, [], projectDiagnostics);
    const unavailableTargets = new Set(
      initialization?.targets.filter((target) => target.status === 'unavailable').map((target) => target.name)
    );
    const globalErrors = projectDiagnostics.filter((issue) => !issue.target && issue.severity === 'error');
    const blocked = status === 'generating' || saving || globalErrors.length > 0;
    const target = config.target;
    const panel = TARGET_PANELS[target];
    const OptionsForm = TARGET_OPTION_FORMS[target];
    const targetOptions = (config.options[target] as Record<string, unknown> | undefined) ?? {};
    const selectionCount = config.selection.namespaces.length + config.selection.declarations.length;
    return (
      <section data-testid="export-settings-panel" className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div>
          <h2 className="text-sm font-semibold">Export settings</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {projectEnabled
              ? 'Generate selected declarations or build saved project targets.'
              : 'Choose a target and generate the selected declarations.'}
          </p>
        </div>
        {projectEnabled && (
          <div className="flex flex-col gap-2 border-b border-border pb-3">
            {initialization && <ProjectInitializationEvidence status={initialization} />}
            <label className="flex flex-col gap-1 text-xs font-medium">
              Saved target
              <ExportSelect
                aria-label="Saved target"
                value={selectedTargetName ?? ''}
                disabled={saving || status === 'generating'}
                onChange={(event) => onSelectTarget?.(event.target.value || undefined)}
              >
                <option value="">One-off export</option>
                {Object.entries(targets).map(([name, target]) => (
                  <option key={name} value={name}>
                    {name} · {target.generator}
                  </option>
                ))}
              </ExportSelect>
            </label>
            <div className="flex min-w-0 gap-1.5">
              <input
                aria-label="Target name"
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
                    .then(() => setMessage('Target settings saved to build configuration.'))
                    .catch((error) => setMessage(error instanceof Error ? error.message : 'Save failed. Try again.'))
                    .finally(() => setSaving(false));
                }}
              >
                {saving ? 'Saving…' : 'Save target settings'}
              </Button>
            </div>
            {targetDirty && (
              <p className="text-xs text-muted-foreground">Unsaved target settings. Build uses the saved settings.</p>
            )}
            {selectedTargetName && (
              <p className="break-words text-xs text-muted-foreground">Output: {targets[selectedTargetName]?.output}</p>
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
        {projectEnabled && Object.keys(targets).length > 0 && (
          <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
            <legend className="text-xs font-medium">Build saved targets</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.keys(targets).map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    aria-label={name}
                    disabled={unavailableTargets.has(name)}
                    title={initialization?.targets.find((target) => target.name === name)?.reasons.join(' ')}
                    checked={selectedBuilds.includes(name) && !unavailableTargets.has(name)}
                    onChange={(event) =>
                      setSelectedBuilds((names) =>
                        event.target.checked ? [...names, name] : names.filter((item) => item !== name)
                      )
                    }
                  />
                  {name}
                  {unavailableTargets.has(name) && <span className="text-foreground/75">Unavailable</span>}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={
                  blocked ||
                  !selectedBuilds.some(
                    (name) => Object.prototype.hasOwnProperty.call(targets, name) && !unavailableTargets.has(name)
                  )
                }
                onClick={() =>
                  onBuildTargets?.(
                    selectedBuilds.filter(
                      (name) => Object.prototype.hasOwnProperty.call(targets, name) && !unavailableTargets.has(name)
                    )
                  )
                }
              >
                Build selected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={blocked || unavailableTargets.size > 0}
                onClick={() => onBuildTargets?.('all')}
              >
                Build all
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Uses saved namespace scope and writes output to the project.
            </p>
          </fieldset>
        )}
        {status === 'generating' ? (
          <Button type="button" className="mt-auto" variant="secondary" onClick={onCancel}>
            Cancel generation
          </Button>
        ) : (
          <Button type="button" className="mt-auto" disabled={selectionCount === 0 || blocked} onClick={onGenerate}>
            {status === 'failed' ? `Retry ${selectionCount} selected` : `Generate ${selectionCount} selected`}
          </Button>
        )}
      </section>
    );
  },
  { op: 'ExportSettingsPanel' }
);
