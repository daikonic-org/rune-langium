// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ReactElement } from 'react';
import { applyThemePreference } from '../../../services/theme-preference.js';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { FontScaleButton } from '../../../components/FontScaleButton.js';
import { useTelemetrySettingsStore } from '../../../store/telemetry-settings.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';

export const SettingsPerspective = withInstrumentation(
  function SettingsPerspective(): ReactElement {
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
            <select
              aria-label="Theme"
              className="rounded-md border border-input bg-card px-3 py-2 text-foreground"
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                applyThemePreference(event.target.value, true);
              }}
            >
              <option value="daikonic">Daikonic dark</option>
              <option value="light">Studio light</option>
              <option value="default">Refactory dark</option>
            </select>
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

        {/* ── Project configuration ────────────────────────────────────────── */}
        <section data-testid="settings-project-section" className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Project configuration</h2>

          <p className="text-xs text-muted-foreground">
            The following settings will be configurable per-project via{' '}
            <code className="font-mono">.runestudio/config.json</code> once git-backed shared project config ships.{' '}
            <span className="ml-1 inline-flex items-center rounded-full border border-border px-1.5 py-px text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </p>

          <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside opacity-60" aria-disabled="true">
            <li>
              <span className="font-medium">Project</span> — name, description
            </li>
            <li>
              <span className="font-medium">Curated models</span> — model ID + version list
            </li>
            <li>
              <span className="font-medium">Sync</span> — auto-sync enabled, debounce interval (ms), branch
            </li>
            <li>
              <span className="font-medium">Codegen</span> — target, layout, namespaces, options
            </li>
          </ul>
        </section>
      </section>
    );
  },
  { op: 'SettingsPerspective' }
);
