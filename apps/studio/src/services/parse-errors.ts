// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

/** Collect syntax failures consistently across worker and main-thread parsing. */
export const parseErrorMessages = withInstrumentation(
  function parseErrorMessages(result: {
    lexerErrors?: readonly { message: string }[];
    parserErrors?: readonly { message: string }[];
  }): string[] {
    return [...(result.lexerErrors ?? []), ...(result.parserErrors ?? [])].map((error) => error.message);
  },
  { op: 'parseErrorMessages' }
);
