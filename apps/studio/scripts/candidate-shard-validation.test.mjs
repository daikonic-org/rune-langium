// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateCandidateShards, loadCandidateShardArtifacts } from './candidate-shard-validation.mjs';

const candidatePlan = {
  suites: [
    {
      specs: [
        {
          id: 'journey-spec-id',
          file: 'prod-ux/journeys/j01-first-run.spec.ts',
          line: 10,
          title: 'J01 first run works',
          tests: [{ projectName: 'candidate-journeys', expectedStatus: 'passed', annotations: [] }]
        }
      ],
      suites: [
        {
          specs: [
            {
              id: 'polish-spec-id',
              file: 'e2e/project-overrides.spec.ts',
              line: 20,
              title: 'reference override remains visible',
              tests: [{ projectName: 'candidate-polish', expectedStatus: 'skipped', annotations: [] }]
            }
          ]
        }
      ]
    }
  ]
};

function resultFor(spec, status, expectedStatus) {
  return {
    id: spec.id,
    file: spec.file,
    line: spec.line,
    title: spec.title,
    tests: [
      {
        projectName: spec.tests[0].projectName,
        expectedStatus,
        status: status === 'passed' ? 'expected' : status === 'skipped' ? 'expected' : 'unexpected',
        annotations: [],
        results: [{ retry: 0, status }]
      }
    ]
  };
}

function shard(
  shardNumber,
  { journeyStatus = 'passed', polishStatus = 'skipped', journeyEvidence = true, ...overrides } = {}
) {
  const journeySpec = candidatePlan.suites[0].specs[0];
  const polishSpec = candidatePlan.suites[0].suites[0].specs[0];
  return {
    meta: {
      shard: shardNumber,
      total: 2,
      headSha: 'abc123',
      runId: '77',
      runAttempt: '1',
      testOutcome: 'success',
      redactionOutcome: 'success',
      ...overrides
    },
    plan: structuredClone(candidatePlan),
    result: {
      suites: [
        {
          specs: [
            ...(shardNumber === 1 ? [resultFor(journeySpec, journeyStatus, 'passed')] : []),
            ...(shardNumber === 2 ? [resultFor(polishSpec, polishStatus, 'skipped')] : [])
          ]
        }
      ]
    },
    manifest: {
      journeys: journeyEvidence && shardNumber === 1 ? [{ id: 'J01', verdict: 'PASS', retry: 0 }] : [],
      timings: []
    }
  };
}

function validate(shards, candidateJobResult = 'success') {
  return validateCandidateShards({
    shards,
    expectedShardCount: 2,
    expectedHeadSha: 'abc123',
    expectedRunId: '77',
    expectedRunAttempt: '1',
    candidateJobResult
  });
}

test('accepts complete first-attempt evidence across shards and preserves an intentional static skip', () => {
  const result = validate([shard(1), shard(2)]);
  assert.deepEqual(
    { shards: result.shards, tests: result.tests, journeys: result.journeys },
    { shards: 2, tests: 2, journeys: 1 }
  );
  assert.deepEqual(
    result.manifest.journeys.map(({ id }) => id),
    ['J01']
  );
  assert.deepEqual(result.manifest.timings, []);
});

test('rejects a missing shard artifact and missing planned test', () => {
  assert.throws(
    () => validate([shard(1)]),
    /expected 2 shard artifacts, found 1|missing shard artifact 2|aggregate Playwright test coverage mismatch/
  );
});

test('rejects duplicate test coverage across shards', () => {
  const first = shard(1);
  const second = shard(2);
  second.result.suites[0].specs.push(resultFor(candidatePlan.suites[0].specs[0], 'passed', 'passed'));
  assert.throws(() => validate([first, second]), /test appeared in multiple shards/);
});

test('rejects duplicate journey evidence and skips not declared by the plan', () => {
  const first = shard(1);
  const second = shard(2);
  second.manifest.journeys.push({ id: 'J01', verdict: 'PASS', retry: 0 });
  assert.throws(() => validate([first, second]), /journey evidence appeared in multiple shards/);

  const changedPlan = shard(2);
  changedPlan.result.suites[0].specs[0].tests[0].expectedStatus = 'passed';
  assert.throws(() => validate([shard(1), changedPlan]), /changed expected status|finished skipped/);
});

test('rejects a failed shard, mixed head, run identity, or failed artifact redaction', () => {
  assert.throws(() => validate([shard(1), shard(2)], 'failure'), /matrix concluded failure/);
  assert.throws(() => validate([shard(1), shard(2, { headSha: 'stale' })]), /does not match abc123/);
  assert.throws(() => validate([shard(1), shard(2, { runAttempt: '2' })]), /expected 1/);
  assert.throws(() => validate([shard(1), shard(2, { redactionOutcome: 'failure' })]), /redaction concluded failure/);
});

test('rejects required journeys with missing evidence, failed status, retries, or timing overruns', () => {
  assert.throws(
    () => validate([shard(1, { journeyEvidence: false }), shard(2)]),
    /journey evidence mismatch.*missing: J01/
  );
  assert.throws(
    () => validate([shard(1, { journeyStatus: 'skipped' }), shard(2)]),
    /required journey test.*did not pass/
  );
  const retried = shard(1);
  retried.result.suites[0].specs[0].tests[0].results.push({ retry: 1, status: 'passed' });
  assert.throws(() => validate([retried, shard(2)]), /exactly one first-attempt result/);
  const overBudget = shard(1);
  overBudget.manifest.journeys[0].opLog = [
    { op: 'workspaceOpen', subject: 'workspace', durationMs: 6000, panel: 'output', sourceId: 1, opId: 1 }
  ];
  assert.throws(() => validate([overBudget, shard(2)]), /exceeded budget/);
});

test('rebases aggregate screenshot links while retaining the original shard records', () => {
  const first = shard(1);
  first.manifest.journeys[0].checkpoints = [{ name: 'ready', screenshot: 'screenshots/J01/ready.png', tMs: 1 }];
  const result = validate([first, shard(2)]);
  assert.equal(
    result.manifest.journeys[0].checkpoints[0].screenshot,
    '../shards/studio-ux-candidate-shard-1/report/screenshots/J01/ready.png'
  );
  assert.equal(first.manifest.journeys[0].checkpoints[0].screenshot, 'screenshots/J01/ready.png');
});

test('loads a polish-only shard without a manifest but requires one for journey tests', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'candidate-shard-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const data of [shard(1), shard(2)]) {
    const dir = path.join(root, `studio-ux-candidate-shard-${data.meta.shard}`);
    await mkdir(path.join(dir, 'report'), { recursive: true });
    for (const [name, value] of [
      ['shard-meta.json', data.meta],
      ['candidate-plan.json', data.plan],
      ['playwright.json', data.result]
    ])
      await writeFile(path.join(dir, name), JSON.stringify(value));
    if (data.manifest.journeys.length)
      await writeFile(path.join(dir, 'report', 'run-manifest.json'), JSON.stringify(data.manifest));
  }
  const loaded = await loadCandidateShardArtifacts(root);
  assert.equal(validate(loaded).tests, 2);
  await rm(path.join(root, 'studio-ux-candidate-shard-1', 'report', 'run-manifest.json'));
  await assert.rejects(loadCandidateShardArtifacts(root), { code: 'ENOENT' });
});

test('fails closed without an expected cohort or with global runner errors', () => {
  assert.throws(() => validateCandidateShards({ shards: [], expectedShardCount: 0 }), /positive integer/);
  assert.throws(() => validateCandidateShards({ shards: [], expectedShardCount: 2 }), /requires expected head/);
  const broken = shard(1);
  broken.result.errors = [{ message: 'Global setup failed' }];
  assert.throws(() => validate([broken, shard(2)]), /global Playwright errors/);
});
