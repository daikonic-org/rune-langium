// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ReactElement, type ComponentType } from 'react';
import { applyThemePreference } from '../../../services/theme-preference.js';
import {
  WorkspaceConfiguration,
  type WorkspaceDirectoriesFormProps
} from '../../../components/WorkspaceConfiguration.js';
import { ExportSelect } from '../../../components/ExportSelect.js';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { FontScaleButton } from '../../../components/FontScaleButton.js';
import { useTelemetrySettingsStore } from '../../../store/telemetry-settings.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';

export const SettingsPerspective = withInstrumentation(
  function SettingsPerspective({
    workspaceForm
  }: { workspaceForm?: ComponentType<WorkspaceDirectoriesFormProps> } = {}): ReactElement {
    const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') ?? 'default');
    const telemetryEnabled = useTelemetrySettingsStore((s) => s.enabled);
    const setTelemetryEnabled = useTelemetrySettingsStore((s) => s.setEnabled);

    return (
      <section data-testid="settings-perspective" className="studio-scroll h-full overflow-auto p-6 space-y-8">
        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Appearance</h2>

          <div className="flex items-center gap-3">
            <span className="text-sm">Pane font size</span>
            <FontScaleButton />
          </div>

          <label className="flex items-center gap-3 text-sm">
            Theme
            <ExportSelect
              aria-label="Theme"
              className="w-52"
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                applyThemePreference(event.target.value, true);
              }}
            >
              <option value="daikonic">Daikonic dark</option>
              <option value="light">Studio light</option>
              <option value="default">Refactory dark</option>
            </ExportSelect>
          </label>
        </section>

        {/* ── Privacy ─────────────────────────────────────────────────────── */}
        <section data-testid="settings-privacy-section" className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Privacy</h2>

          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              data-testid="settings-telemetry-toggle"
              checked={telemetryEnabled}
              onCheckedChange={setTelemetryEnabled}
            />
            Send anonymous diagnostics
          </label>

          <p className="text-xs text-muted-foreground">
            Shares anonymised error/warning signatures and operation timings to help us find and fix issues. Never
            includes your model's source content — only curated type names, never scratch workspace text. Off by
            default; disabled entirely on localhost regardless of this setting.
          </p>
        </section>

        <WorkspaceConfiguration Form={workspaceForm} />
      </section>
    );
  },
  { op: 'SettingsPerspective' }
);
