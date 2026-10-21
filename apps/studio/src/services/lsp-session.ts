// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation, Capture } from './instrumentation/core.js';
import { generateUlid } from './ulid.js';

const LSP_SESSION_ID_KEY = 'rune-studio:lsp-session-id';
export const getLspSessionId = withInstrumentation(
  function getLspSessionId(): string {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      return generateUlid();
    }
    try {
      const existing = window.sessionStorage.getItem(LSP_SESSION_ID_KEY);
      if (existing && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(existing)) return existing;
      const fresh = generateUlid();
      window.sessionStorage.setItem(LSP_SESSION_ID_KEY, fresh);
      return fresh;
    } catch {
      // sessionStorage may throw under privacy / access-restricted modes — even
      // on read (getItem), not just setItem. Non-fatal: the caller still gets a
      // unique-for-this-call id, it just won't persist across reloads (the DO is
      // isolated per-mount instead of per-tab).
      return generateUlid();
    }
    // Output is a random per-tab session correlator (crypto.getRandomValues),
    // never derived from user/model content — safe to capture verbatim.
  },
  {
    op: 'getLspSessionId',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);
