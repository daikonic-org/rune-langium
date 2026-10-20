// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { IMPLEMENTED_TARGETS, TARGET_DESCRIPTORS, type Target } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
import type { ExportConfig } from '../../services/export-request.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { TARGET_OPTION_FORMS, TARGET_PANELS } from '../../components/export-target-settings.js';
import type { ExportRunState } from '../../store/export-workbench-store.js';

/** Native selection keeps platform keyboard behavior; one inset glyph owns its geometry. */
function ExportSelect({ children, ...props }: ComponentProps<'select'>) {
  return (
    <span data-slot="export-select" className="relative block min-w-0">
      <select
        {...props}
        className="h-8 w-full min-w-0 appearance-none rounded border border-input bg-background pl-3 pr-8 text-sm font-normal forced-colors:appearance-auto"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground forced-colors:hidden"
      />
    </span>
  );
}

export interface ExportSettingsPanelProps {
  config: ExportConfig;
  onChange(config: ExportConfig): void;
  onGenerate(): void;
  onCancel(): void;
  status: ExportRunState['status'];
}

/** Target and layout controls for a declaration-scoped export. */
export const ExportSettingsPanel = withInstrumentation(
  function ExportSettingsPanel({ config, onChange, onGenerate, onCancel, status }: ExportSettingsPanelProps) {
    const target = config.target;
    const panel = TARGET_PANELS[target];
    const OptionsForm = TARGET_OPTION_FORMS[target];
    const targetOptions = (config.options[target] as Record<string, unknown> | undefined) ?? {};
    const selectionCount = config.selection.namespaces.length + config.selection.declarations.length;
    return (
      <section data-testid="export-settings-panel" className="flex h-full flex-col gap-4 p-3">
        <div>
          <h2 className="text-sm font-semibold">Export settings</h2>
          <p className="mt-1 text-xs text-muted-foreground">Choose a target and generate the selected declarations.</p>
        </div>
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
              value={targetOptions}
              onChange={(options) => onChange({ ...config, options: { ...config.options, [target]: options } })}
            />
          </div>
        )}
        {status === 'generating' ? (
          <Button type="button" className="mt-auto" variant="secondary" onClick={onCancel}>
            Cancel generation
          </Button>
        ) : (
          <Button type="button" className="mt-auto" disabled={selectionCount === 0} onClick={onGenerate}>
            {status === 'failed' ? `Retry ${selectionCount} selected` : `Generate ${selectionCount} selected`}
          </Button>
        )}
      </section>
    );
  },
  { op: 'ExportSettingsPanel' }
);
