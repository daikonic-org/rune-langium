// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** URL-safe 26-character ULID; preserves existing workspace and session ID encoding. */
export const generateUlid = withInstrumentation(
  function generateUlid(): string {
    let time = Date.now();
    let timePart = '';
    for (let i = 0; i < 10; i++) {
      timePart = CROCKFORD[time & 31] + timePart;
      time = Math.floor(time / 32);
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let randomPart = '';
    for (const byte of bytes) randomPart += CROCKFORD[byte & 31];
    return timePart + randomPart;
  },
  { op: 'generateUlid' }
);
