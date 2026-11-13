// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useId, useState, type ReactElement, type ComponentType } from 'react';
import { applyThemePreference } from '../../../services/theme-preference.js';
import {
  WorkspaceConfiguration,
  type WorkspaceDirectoriesFormProps
} from '../../../components/WorkspaceConfiguration.js';
import { NativeSelect } from '@rune-langium/design-system/ui/select';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@rune-langium/design-system/ui/field';
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
    const telemetryId = useId();
    const telemetryHelpId = useId();

    return (
      <section data-testid="settings-perspective" className="studio-settings studio-scroll h-full overflow-auto">
        {/* ── Appearance ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Appearance</h2>

          <div className="grid grid-cols-[8rem_minmax(0,13rem)] items-center gap-3">
            <span className="text-sm">Pane font size</span>
            <div className="justify-self-start">
              <FontScaleButton />
            </div>
          </div>

          <label className="grid grid-cols-[8rem_minmax(0,13rem)] items-center gap-3 text-sm">
            Theme
            <NativeSelect
              aria-label="Theme"
              className="w-full"
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                applyThemePreference(event.target.value, true);
              }}
            >
              <option value="daikonic">Daikonic dark</option>
              <option value="light">Studio light</option>
              <option value="default">Refactory dark</option>
            </NativeSelect>
          </label>
        </section>

        {/* ── Privacy ─────────────────────────────────────────────────────── */}
        <section data-testid="settings-privacy-section" className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Privacy</h2>

          <Field orientation="horizontal">
            <Checkbox
              id={telemetryId}
              aria-describedby={telemetryHelpId}
              data-testid="settings-telemetry-toggle"
              checked={telemetryEnabled}
              onCheckedChange={setTelemetryEnabled}
            />
            <FieldContent>
              <FieldLabel htmlFor={telemetryId}>Send anonymous diagnostics</FieldLabel>
              <FieldDescription id={telemetryHelpId} className="max-w-prose">
                Shares anonymised error/warning signatures and operation timings to help us find and fix issues. Never
                includes your model's source content — only curated type names, never scratch workspace text. Off by
                default; disabled entirely on localhost regardless of this setting.
              </FieldDescription>
            </FieldContent>
          </Field>
        </section>

        <WorkspaceConfiguration Form={workspaceForm} />
      </section>
    );
  },
  { op: 'SettingsPerspective' }
);
