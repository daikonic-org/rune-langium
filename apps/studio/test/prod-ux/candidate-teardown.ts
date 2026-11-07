// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_DIR, type JourneyRecord } from './evidence.js';
import { buildTimingsRollup } from './timings.js';

/** Soft findings and incomplete coverage must not silently pass the pre-merge gate. */
export function assertCandidateJourneys(
  journeys: readonly (Pick<JourneyRecord, 'id' | 'verdict' | 'retry'> & Partial<Pick<JourneyRecord, 'opLog'>>)[]
) {
  if (!journeys.length) throw new Error('Candidate UX gate produced no journey evidence.');
  const incomplete = journeys.filter((journey) => journey.verdict !== 'PASS' || journey.retry !== 0);
  if (incomplete.length)
    throw new Error(
      `Candidate UX gate requires clean first-attempt passes: ${incomplete
        .map((journey) => {
          const overruns = buildTimingsRollup([{ opLog: journey.opLog ?? [] }])
            .filter((entry) => entry.ms > entry.budgetMs)
            .map(
              (entry) => `${entry.op}${entry.subject ? ` (${entry.subject})` : ''}: ${entry.ms}ms > ${entry.budgetMs}ms`
            );
          return `${journey.id}: ${journey.verdict}, retry ${journey.retry}${overruns.length ? ` [${overruns.join(', ')}]` : ''}`;
        })
        .join('; ')}`
    );
}

export default async function candidateTeardown() {
  const manifest: { journeys: JourneyRecord[] } = JSON.parse(
    await readFile(path.join(REPORT_DIR, 'run-manifest.json'), 'utf8')
  );
  assertCandidateJourneys(manifest.journeys);
}
