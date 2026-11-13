// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { withInstrumentation } from './instrumentation/core.js';

/** Return recovery copy instead of rejecting when browser clipboard access fails. */
export const copyTextToClipboard = withInstrumentation(
  async function copyTextToClipboard(text: string): Promise<string | undefined> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return 'Clipboard access is unavailable in this browser. Select and copy the text instead.';
    }
    try {
      await navigator.clipboard.writeText(text);
      return undefined;
    } catch {
      return 'Copy failed. Check clipboard permissions and try again, or select and copy the text.';
    }
  },
  { op: 'copyTextToClipboard', capture: 0 }
);
