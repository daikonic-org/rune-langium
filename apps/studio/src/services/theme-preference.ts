// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

/** Personal appearance preference shared by startup and Settings. */
export const applyThemePreference = withInstrumentation(
  function applyThemePreference(theme: string, persist = false): void {
    if (persist) window.localStorage.setItem('rune-studio:theme', theme);
    document.documentElement.classList.toggle('dark', theme !== 'light');
    if (theme !== 'default') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  },
  { op: 'applyThemePreference' }
);

export const initializeThemePreference = withInstrumentation(
  function initializeThemePreference(): void {
    const queryTheme = new URLSearchParams(window.location.search).get('theme');
    applyThemePreference(queryTheme ?? window.localStorage.getItem('rune-studio:theme') ?? 'daikonic', !!queryTheme);
  },
  { op: 'initializeThemePreference' }
);
