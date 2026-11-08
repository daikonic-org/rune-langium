// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeCandidateJourneyId } from '../test/prod-ux/candidate-journey-id.mjs';
import { buildTimingsRollup } from '../test/prod-ux/timings.ts';

function visitSuites(suites, visitSpec) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) visitSpec(spec);
    visitSuites(suite.suites, visitSpec);
  }
}

function flattenTests(report) {
  const tests = [];
  visitSuites(report.suites, (spec) => {
    for (const test of spec.tests ?? []) {
      const project = test.projectName ?? test.projectId;
      if (!project || !spec.id) throw new Error('Candidate report contains a test without project or spec identity.');
      tests.push({
        key: `${project}:${spec.id}`,
        project,
        file: String(spec.file ?? '').replaceAll('\\', '/'),
        line: spec.line,
        title: spec.title,
        annotations: test.annotations ?? [],
        expectedStatus: test.expectedStatus,
        status: test.status,
        results: test.results ?? []
      });
    }
  });
  return tests;
}

function uniqueByKey(values, keyOf, label) {
  const map = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (map.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    map.set(key, value);
  }
  return map;
}

function sortedKeys(values) {
  return [...values].sort();
}

function compareKeys(expected, actual, label) {
  const missing = sortedKeys([...expected].filter((key) => !actual.has(key)));
  const unexpected = sortedKeys([...actual].filter((key) => !expected.has(key)));
  if (missing.length || unexpected.length) {
    throw new Error(
      `${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}`
    );
  }
}

function aggregateJourney(journey, shard) {
  return {
    ...journey,
    checkpoints: (journey.checkpoints ?? []).map((checkpoint) => {
      const screenshot = checkpoint.screenshot.replaceAll('\\', '/');
      if (path.posix.isAbsolute(screenshot) || screenshot.split('/').includes('..'))
        throw new Error(`Invalid shard screenshot path: ${screenshot}`);
      return {
        ...checkpoint,
        screenshot: path.posix.join('..', 'shards', `studio-ux-candidate-shard-${shard}`, 'report', screenshot)
      };
    })
  };
}

/** Validates full planned test coverage and candidate journey evidence across isolated CI shards. */
export function validateCandidateShards({
  shards,
  expectedShardCount,
  expectedHeadSha,
  expectedRunId,
  expectedRunAttempt,
  candidateJobResult
}) {
  if (!Number.isInteger(expectedShardCount) || expectedShardCount < 1)
    throw new Error('Candidate shard count must be a positive integer.');
  if (![expectedHeadSha, expectedRunId, expectedRunAttempt].every((value) => String(value ?? '').length > 0))
    throw new Error('Candidate validation requires expected head, run and attempt identities.');
  const errors = [];
  if (candidateJobResult !== 'success')
    errors.push(`candidate shard matrix concluded ${candidateJobResult ?? 'with no result'}`);
  if (shards.length !== expectedShardCount)
    errors.push(`expected ${expectedShardCount} shard artifacts, found ${shards.length}`);

  const orderedShards = [...shards].sort((left, right) => left.meta.shard - right.meta.shard);
  const shardNumbers = new Set();
  let expectedTests;
  let expectedJourneys;
  const actualTests = new Map();
  const journeyRecords = new Map();

  for (const shard of orderedShards) {
    const { meta, plan, result, manifest } = shard;
    if (!Number.isInteger(meta.shard) || meta.shard < 1 || meta.shard > expectedShardCount)
      errors.push(`invalid shard number ${meta.shard}`);
    if (shardNumbers.has(meta.shard)) errors.push(`duplicate shard artifact ${meta.shard}`);
    shardNumbers.add(meta.shard);
    if (meta.total !== expectedShardCount) errors.push(`shard ${meta.shard} reports total ${meta.total}`);
    if (meta.headSha !== expectedHeadSha)
      errors.push(`shard ${meta.shard} head ${meta.headSha} does not match ${expectedHeadSha}`);
    if (String(meta.runId) !== String(expectedRunId))
      errors.push(`shard ${meta.shard} belongs to run ${meta.runId}, expected ${expectedRunId}`);
    if (String(meta.runAttempt) !== String(expectedRunAttempt))
      errors.push(`shard ${meta.shard} belongs to attempt ${meta.runAttempt}, expected ${expectedRunAttempt}`);
    if (meta.testOutcome !== 'success')
      errors.push(`shard ${meta.shard} test step concluded ${meta.testOutcome ?? 'without a result'}`);
    if (meta.redactionOutcome !== 'success')
      errors.push(`shard ${meta.shard} redaction concluded ${meta.redactionOutcome ?? 'without a result'}`);
    if (result.errors?.length) errors.push(`shard ${meta.shard} reported global Playwright errors`);

    const planned = uniqueByKey(flattenTests(plan), (test) => test.key, `planned test in shard ${meta.shard}`);
    if (expectedTests === undefined) {
      expectedTests = new Set(planned.keys());
      expectedJourneys = new Map();
      for (const test of planned.values()) {
        if (!test.file.startsWith('prod-ux/journeys/')) continue;
        const id = computeCandidateJourneyId(test.title, test.annotations);
        if (!/^J\d+[a-z]?(?::.+)?$/.test(id))
          errors.push(`candidate journey test has no J-number title: ${test.title}`);
        if (expectedJourneys.has(id))
          errors.push(`candidate plan maps multiple required tests to journey evidence ${id}`);
        expectedJourneys.set(id, test.key);
      }
      if (!expectedJourneys.size) errors.push('candidate plan contains no required journey tests');
    } else {
      compareKeys(expectedTests, new Set(planned.keys()), `shard ${meta.shard} candidate plan`);
    }

    const reported = flattenTests(result);
    for (const test of reported) {
      if (!expectedTests.has(test.key)) {
        errors.push(`shard ${meta.shard} reported unplanned test ${test.key}`);
        continue;
      }
      const plannedTest = planned.get(test.key);
      if (test.expectedStatus !== plannedTest.expectedStatus)
        errors.push(
          `test ${test.key} changed expected status from ${plannedTest.expectedStatus} to ${test.expectedStatus}`
        );
      if (actualTests.has(test.key)) errors.push(`test appeared in multiple shards: ${test.key}`);
      else actualTests.set(test.key, { ...test, shard: meta.shard });

      if (test.results.length !== 1 || test.results[0].retry !== 0) {
        errors.push(`test did not produce exactly one first-attempt result: ${test.key}`);
        continue;
      }
      const status = test.results[0].status;
      const intentionalSkip =
        plannedTest.expectedStatus === 'skipped' && test.expectedStatus === 'skipped' && status === 'skipped';
      if (status !== 'passed' && !intentionalSkip) errors.push(`test ${test.key} finished ${status}`);
      if (test.file.startsWith('prod-ux/journeys/') && status !== 'passed')
        errors.push(`required journey test ${test.key} did not pass`);
    }

    for (const journey of manifest.journeys ?? []) {
      if (journeyRecords.has(journey.id)) errors.push(`journey evidence appeared in multiple shards: ${journey.id}`);
      else journeyRecords.set(journey.id, { ...journey, shard: meta.shard });
      if (journey.verdict !== 'PASS' || journey.retry !== 0)
        errors.push(`journey ${journey.id} is ${journey.verdict}, retry ${journey.retry}`);
      for (const timing of buildTimingsRollup([{ opLog: journey.opLog ?? [] }])) {
        if (timing.ms > timing.budgetMs)
          errors.push(
            `journey timing exceeded budget in shard ${meta.shard}: ${timing.op}${timing.subject ? ` (${timing.subject})` : ''} ${timing.ms}ms > ${timing.budgetMs}ms`
          );
      }
    }
  }

  for (let shard = 1; shard <= expectedShardCount; shard++)
    if (!shardNumbers.has(shard)) errors.push(`missing shard artifact ${shard}`);

  compareKeys(expectedTests ?? new Set(), new Set(actualTests.keys()), 'aggregate Playwright test coverage');
  compareKeys(
    new Set(expectedJourneys?.keys() ?? []),
    new Set(journeyRecords.keys()),
    'aggregate required journey evidence'
  );

  if (errors.length) throw new Error(`Candidate shard validation failed:\n- ${errors.join('\n- ')}`);
  const journeys = [...journeyRecords.values()].map(({ shard, ...journey }) => aggregateJourney(journey, shard));
  return {
    shards: shardNumbers.size,
    tests: actualTests.size,
    journeys: journeys.length,
    manifest: {
      runId: `candidate-${expectedRunId}-${expectedRunAttempt}`,
      journeys,
      timings: buildTimingsRollup(journeys.map((journey) => ({ opLog: journey.opLog ?? [] })))
    }
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadCandidateShardArtifacts(root) {
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const shards = [];
  for (const name of dirs) {
    const dir = path.join(root, name);
    const meta = await readJson(path.join(dir, 'shard-meta.json'));
    const [plan, result] = await Promise.all([
      readJson(path.join(dir, 'candidate-plan.json')),
      readJson(path.join(dir, 'playwright.json'))
    ]);
    let manifest;
    try {
      manifest = await readJson(path.join(dir, 'report', 'run-manifest.json'));
    } catch (error) {
      if (error.code !== 'ENOENT' || flattenTests(result).some((test) => test.file.startsWith('prod-ux/journeys/')))
        throw error;
      manifest = { journeys: [] };
    }
    shards.push({ artifact: name, meta, plan, result, manifest });
  }
  return shards;
}

async function collectBlobReports(root, destination, expectedCount) {
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.zip') && file.includes(`${path.sep}blob${path.sep}`))
        found.push(file);
    }
  }
  await walk(root);
  if (found.length !== expectedCount)
    throw new Error(`Expected ${expectedCount} sanitized Playwright blob reports, found ${found.length}`);
  await mkdir(destination, { recursive: true });
  for (const file of found) {
    const artifact = file.split(path.sep).find((part) => part.startsWith('studio-ux-candidate-shard-'));
    await copyFile(file, path.join(destination, `${artifact}-${path.basename(file)}`));
  }
  return found.length;
}

async function writeAggregateManifest(manifest, artifactRoot) {
  const root = path.resolve(artifactRoot, '..');
  const reportDir = path.join(root, 'report');
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'run-manifest.json'), JSON.stringify(manifest, null, 2));
  const firstShard = (await readdir(artifactRoot, { withFileTypes: true })).find((entry) => entry.isDirectory());
  if (!firstShard) throw new Error('No shard artifact available for known-issues evidence.');
  await copyFile(
    path.join(artifactRoot, firstShard.name, 'report', 'known-issues.json'),
    path.join(reportDir, 'known-issues.json')
  );
}

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: node validate-candidate-shards.mjs <downloaded-artifacts-directory>');
  const shards = await loadCandidateShardArtifacts(root);
  const result = validateCandidateShards({
    shards,
    expectedShardCount: Number(process.env.CANDIDATE_SHARD_COUNT ?? 4),
    expectedHeadSha: process.env.GITHUB_SHA,
    expectedRunId: process.env.GITHUB_RUN_ID,
    expectedRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    candidateJobResult: process.env.CANDIDATE_JOB_RESULT
  });
  await writeAggregateManifest(result.manifest, root);
  const blobReportDir = path.resolve(root, '..', 'merge-input');
  const blobReports = await collectBlobReports(root, blobReportDir, result.shards);
  console.log(`Collected ${blobReports} sanitized Playwright blob reports for the merged HTML report.`);
  console.log(
    `Validated ${result.tests} candidate tests and ${result.journeys} journey records across ${result.shards} shards.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
