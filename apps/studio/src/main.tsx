// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { initializeThemePreference } from './services/theme-preference.js';
import { Buffer } from 'buffer';
// isomorphic-git requires global Buffer in the browser
(globalThis as any).Buffer = Buffer;

import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { InstrumentationErrorBoundary } from './components/InstrumentationErrorBoundary.js';
import { installOpLogWindowBridge } from './services/op-log-window-bridge.js';
import { installPerfLogWindowBridge } from './services/perf-log-window-bridge.js';
import { installTypeGraphWindowBridge } from './services/type-graph-window-bridge.js';
import { installInstrumentationBrowserSink } from './services/instrumentation/browser-sink.js';
import { installInstrumentationActivitySink } from './services/instrumentation/activity-sink.js';
// Dockview chrome (tab strips, sash handles, abyss theme palette).
// dockview's upstream theme CSS — UNLAYERED, sits above all @layer rules.
import 'dockview-react/dist/styles/dockview.css';
import './app.css';
// Rune structural overrides for DockviewReact (.rune-dock-theme). Imported
// AFTER app.css on purpose: app.css's `@import 'tailwindcss'` must
// establish the canonical @layer order (theme, base, components, utilities)
// FIRST. If dock-theme.css declared `@layer components` before that, it would
// register `components` ahead of `base` and globally invert base↔components
// priority. Order vs dockview's unlayered dist CSS is unaffected — dockview.css
// is imported first, so dock-theme's unlayered overrides still win source-order.
import '@rune-langium/design-system/dock-theme.css';

installOpLogWindowBridge();
installPerfLogWindowBridge();
installTypeGraphWindowBridge();
installInstrumentationBrowserSink();
installInstrumentationActivitySink();

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const DesignPreferencesPreview =
  import.meta.env.DEV && new URLSearchParams(location.search).has('design-preview')
    ? lazy(() => import('./components/DesignPreferencesPreview.js'))
    : null;

initializeThemePreference();

createRoot(root).render(
  <StrictMode>
    <InstrumentationErrorBoundary>
      <App />
      {DesignPreferencesPreview && (
        <Suspense fallback={null}>
          <DesignPreferencesPreview />
        </Suspense>
      )}
    </InstrumentationErrorBoundary>
  </StrictMode>
);
