// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { buildTimingsRollup, exceedsBudget } from './timings.js';
import type { JourneyRecord } from './evidence.js';

function makeRecord(overrides: Partial<JourneyRecord> & Pick<JourneyRecord, 'id' | 'title'>): JourneyRecord {
  return {
    verdict: 'PASS',
    durationMs: 1000,
    checkpoints: [],
    consoleErrors: [],
    failedRequests: [],
    softFindings: [],
    retry: 0,
    opLog: [],
    ...overrides
  };
}

describe('buildTimingsRollup', () => {
  it('counts mirrored completions once, without losing identical operations or reload generations', () => {
    const completion = {
      op: 'functionExecute',
      subject: 'EchoDate',
      level: 'success' as const,
      message: 'executed',
      durationMs: 15,
      ts: 10,
      panel: 'output' as const,
      sourceId: 1,
      opId: 2,
      navigationGeneration: 0
    };
    const record = makeRecord({
      id: 'J21',
      title: 'primitives',
      opLog: [
        completion,
        { ...completion, panel: 'activity', sourceId: 5, ts: 10.1 },
        { ...completion, opId: 3, sourceId: 2 },
        { ...completion, panel: 'activity', opId: 3, sourceId: 6 },
        { ...completion, navigationGeneration: 1 },
        { ...completion, panel: 'activity', navigationGeneration: 1, sourceId: 5 },
        { ...completion, opId: undefined, sourceId: 7 },
        { ...completion, opId: undefined, sourceId: 8 }
      ]
    });
    expect(buildTimingsRollup([record])).toHaveLength(5);
    expect(record.opLog).toHaveLength(8);
  });

  it('retains six logical attempts, including a failed validation, from twelve mirrored records', () => {
    const opLog = Array.from({ length: 6 }, (_, index) =>
      ['output', 'activity'].map((panel) => ({
        op: 'functionExecute',
        subject: 'temporal input',
        level: index === 5 ? ('error' as const) : ('success' as const),
        message: index === 5 ? 'invalid input' : 'executed',
        durationMs: 20,
        ts: index,
        sourceId: index,
        opId: index,
        navigationGeneration: 0,
        panel: panel as 'output' | 'activity'
      }))
    ).flat();
    expect(buildTimingsRollup([makeRecord({ id: 'J21', title: 'temporal inputs', opLog })])).toHaveLength(6);
    expect(opLog).toHaveLength(12);
    expect(opLog.filter((entry) => entry.level === 'error')).toHaveLength(2);
  });

  it('prefers journey completion over an internal registration span', () => {
    const record = makeRecord({
      id: 'J03',
      title: 'CDM',
      opLog: [
        {
          op: 'modelLoad',
          subject: 'cdm',
          level: 'success',
          message: 'registered',
          durationMs: 1,
          ts: 0,
          panel: 'output',
          sourceId: 1
        },
        {
          op: 'modelLoad',
          subject: 'cdm ready',
          level: 'info',
          message: 'Journey wall-clock measurement',
          durationMs: 1200,
          ts: 1200,
          panel: 'perf',
          sourceId: -1
        }
      ]
    });
    expect(buildTimingsRollup([record])).toEqual([
      { op: 'modelLoad', subject: 'cdm ready', ms: 1200, budgetMs: 45000 }
    ]);
  });

  it('extracts one timing entry per budgeted op with a recorded duration', () => {
    const journeys: JourneyRecord[] = [
      makeRecord({
        id: 'J03',
        title: 'J03 — Curated CDM load',
        opLog: [
          {
            op: 'modelLoad',
            subject: 'cdm',
            level: 'success',
            message: 'loaded',
            durationMs: 12000,
            ts: 0,
            panel: 'output'
          }
        ]
      })
    ];
    expect(buildTimingsRollup(journeys)).toEqual([{ op: 'modelLoad', subject: 'cdm', ms: 12000, budgetMs: 45000 }]);
  });

  it('omits opLog entries whose op has no known budget', () => {
    const journeys: JourneyRecord[] = [
      makeRecord({
        id: 'J07',
        title: 'J07 — Source view',
        opLog: [{ op: 'lspConnect', level: 'success', message: 'connected', durationMs: 300, ts: 0, panel: 'output' }]
      })
    ];
    expect(buildTimingsRollup(journeys)).toEqual([]);
  });

  it('omits entries with no recorded durationMs', () => {
    const journeys: JourneyRecord[] = [
      makeRecord({
        id: 'J03',
        title: 'J03',
        opLog: [{ op: 'modelLoad', subject: 'cdm', level: 'info', message: 'starting', ts: 0, panel: 'output' }]
      })
    ];
    expect(buildTimingsRollup(journeys)).toEqual([]);
  });

  it('collects one entry per subject for repeatable ops across journeys', () => {
    const journeys: JourneyRecord[] = [
      makeRecord({
        id: 'J09',
        title: 'J09',
        opLog: [
          {
            op: 'formRender',
            subject: 'curated:Party',
            level: 'success',
            message: 'rendered',
            durationMs: 800,
            ts: 0,
            panel: 'output'
          },
          {
            op: 'formRender',
            subject: 'scratch:Widget',
            level: 'success',
            message: 'rendered',
            durationMs: 600,
            ts: 0,
            panel: 'output'
          }
        ]
      })
    ];
    expect(buildTimingsRollup(journeys)).toEqual([
      { op: 'formRender', subject: 'curated:Party', ms: 800, budgetMs: 5000 },
      { op: 'formRender', subject: 'scratch:Widget', ms: 600, budgetMs: 5000 }
    ]);
  });
});

describe('exceedsBudget', () => {
  it('returns false when every op is within budget', () => {
    expect(exceedsBudget([{ op: 'modelLoad', durationMs: 12000 }])).toBe(false);
  });

  it('returns true when any op exceeds its budget', () => {
    expect(exceedsBudget([{ op: 'modelLoad', durationMs: 50000 }])).toBe(true);
  });

  it('ignores unbudgeted ops and entries with no durationMs', () => {
    expect(exceedsBudget([{ op: 'lspConnect', durationMs: 999999 }, { op: 'modelLoad' }])).toBe(false);
  });
});
