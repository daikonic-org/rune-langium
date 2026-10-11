// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { version as studioVersion } from '../../package.json';
import { config } from '../config.js';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import { useOutputStore } from '../store/output-store.js';
import { useActivityStore } from '../store/activity-store.js';
import { useDiagnosticsStore } from '../store/diagnostics-store.js';
import { useTelemetrySettingsStore } from '../store/telemetry-settings.js';
import { getPerfLogSnapshot } from './perf-log.js';
import { getInstrumentationThreshold, withInstrumentation } from './instrumentation/core.js';
import { downloadBlob } from './browser-download.js';

/** Local, user-requested evidence. Never sent through the remote telemetry client. */
export const buildStudioDebugReport = withInstrumentation(
  function buildStudioDebugReport(workspace: WorkspaceState | null, options: { includeSource?: boolean } = {}) {
    const includeSource = options.includeSource === true;
    return {
      formatVersion: 1,
      capturedAt: new Date().toISOString(),
      environment: {
        studioVersion,
        mode: import.meta.env.MODE,
        origin: window.location.origin,
        userAgent: navigator.userAgent,
        language: navigator.language,
        online: navigator.onLine,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      settings: {
        lspEnabled: config.lspEnabled,
        curatedMirrorEnabled: config.curatedMirrorEnabled,
        githubAuthEnabled: config.githubAuthEnabled,
        devMode: config.devMode,
        telemetryAvailable: config.telemetryEnabled,
        telemetryOptIn: useTelemetrySettingsStore.getState().enabled,
        instrumentationLevel: getInstrumentationThreshold()
      },
      workspace: workspace
        ? {
            id: workspace.workspaceId,
            name: workspace.workspaceName,
            kind: workspace.workspaceKind,
            files: workspace.files.map((file) => ({
              path: file.path,
              name: file.name,
              characters: file.content.length,
              dirty: file.dirty,
              readOnly: file.readOnly === true,
              bundleId: file.bundleId,
              bundleVersion: file.bundleVersion,
              sourceIncluded: includeSource,
              ...(includeSource ? { content: file.content } : {})
            }))
          }
        : null,
      diagnostics: {
        parse: Array.from(workspace?.parseErrors ?? [], ([path, messages]) => ({ path, messages: [...messages] })),
        lsp: Array.from(useDiagnosticsStore.getState().fileDiagnostics, ([uri, diagnostics]) => ({ uri, diagnostics }))
      },
      logs: {
        output: [...useOutputStore.getState().lines],
        activity: [...useActivityStore.getState().entries],
        timings: [...getPerfLogSnapshot()]
      }
    };
  },
  { op: 'buildStudioDebugReport' }
);

export const downloadStudioDebugReport = withInstrumentation(
  function downloadStudioDebugReport(
    workspace: WorkspaceState | null,
    options: { includeSource?: boolean } = {}
  ): void {
    const report = buildStudioDebugReport(workspace, options);
    const timestamp = report.capturedAt.replace(/[:.]/g, '-');
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `rune-debug-${timestamp}.json`
    );
  },
  { op: 'downloadStudioDebugReport' }
);
