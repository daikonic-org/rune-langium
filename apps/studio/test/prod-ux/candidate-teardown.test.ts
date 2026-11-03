// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { assertCandidateJourneys } from './candidate-teardown.js';

it('accepts clean first-attempt journey evidence', () => {
  expect(() => assertCandidateJourneys([{ id: 'J8', verdict: 'PASS', retry: 0 }])).not.toThrow();
});

it.each(['DEGRADED', 'FAIL', 'BLOCKED'] as const)(
  'blocks a %s journey even when the browser assertion returned',
  (verdict) => {
    expect(() => assertCandidateJourneys([{ id: 'J13:generate', verdict, retry: 0 }])).toThrow(
      `J13:generate: ${verdict}`
    );
  }
);

it('refuses to accept missing journey coverage', () => {
  expect(() => assertCandidateJourneys([])).toThrow('no journey evidence');
});

it('does not turn a retry into a clean pass', () => {
  expect(() => assertCandidateJourneys([{ id: 'J8', verdict: 'PASS', retry: 1 }])).toThrow('retry 1');
});
