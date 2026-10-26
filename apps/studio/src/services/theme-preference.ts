// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

const themes = new Set(['daikonic', 'light', 'default']);

/** Personal appearance preference shared by startup and Settings. */
export const applyThemePreference = withInstrumentation(
  function applyThemePreference(theme: string, persist = false): void {
    if (!themes.has(theme)) return;
    if (persist) {
      try {
        window.localStorage.setItem('rune-studio:theme', theme);
      } catch {
        // Storage can be disabled by browser privacy settings; theme application remains available.
      }
    }
    document.documentElement.classList.toggle('dark', theme !== 'light');
    if (theme !== 'default') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  },
  { op: 'applyThemePreference' }
);

export const initializeThemePreference = withInstrumentation(
  function initializeThemePreference(): void {
    const queryTheme = new URLSearchParams(window.location.search).get('theme');
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem('rune-studio:theme');
    } catch {
      // Use the default below when browser storage is unavailable.
    }
    const selectedTheme = queryTheme && themes.has(queryTheme) ? queryTheme : storedTheme;
    applyThemePreference(
      selectedTheme && themes.has(selectedTheme) ? selectedTheme : 'daikonic',
      queryTheme !== null && themes.has(queryTheme)
    );
  },
  { op: 'initializeThemePreference' }
);
