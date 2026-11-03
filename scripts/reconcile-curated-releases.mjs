// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateReferenceCatalog } from '../packages/curated-schema/dist/index.js';

const repository = 'https://github.com/finos/common-domain-model';

/** Reconcile new stable releases since the curated catalog's first supported release. */
export async function missingCuratedReleases(fetchImpl = fetch) {
  const response = await fetchImpl('https://www.daikonic.dev/releases/cdm', { cache: 'no-store' });
  if (!response.ok) throw new Error(`CDM catalog HTTP ${response.status}`);
  const catalog = validateReferenceCatalog(await response.json());
  const curated = new Set(
    catalog.releases.filter((entry) => entry.repository === repository).map((entry) => entry.tag)
  );
  if (!curated.size) throw new Error('Seed the CDM catalog with an explicit verified release first');
  const releases = [];
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let page = 1; ; page++) {
    const result = await fetchImpl(
      `https://api.github.com/repos/finos/common-domain-model/releases?per_page=100&page=${page}`,
      { headers }
    );
    if (!result.ok) throw new Error(`CDM releases HTTP ${result.status}`);
    const batch = await result.json();
    if (!Array.isArray(batch)) throw new Error('Expected a GitHub release list');
    releases.push(
      ...batch.filter(
        (entry) =>
          !entry.draft &&
          !entry.prerelease &&
          /^\d+\.\d+\.\d+$/.test(entry.tag_name) &&
          Number.isFinite(Date.parse(entry.published_at))
      )
    );
    if (batch.length < 100) break;
  }
  const anchors = releases
    .filter((entry) => curated.has(entry.tag_name))
    .map((entry) => Date.parse(entry.published_at));
  if (!anchors.length) throw new Error('Curated CDM tags are absent from the upstream release list');
  const since = Math.min(...anchors);
  return [
    ...new Set(
      releases
        .filter((entry) => !curated.has(entry.tag_name) && Date.parse(entry.published_at) >= since)
        .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || a.tag_name.localeCompare(b.tag_name))
        .map((entry) => entry.tag_name)
    )
  ];
}

/** Use the same verified builder and receipt-gated publisher as explicit release dispatch. */
export async function reconcileCuratedReleases({ fetchImpl = fetch, run = spawnSync } = {}) {
  const tags = await missingCuratedReleases(fetchImpl);
  const failures = [];
  for (const tag of tags) {
    try {
      console.log(`Reconciling CDM release ${tag}`);
      const directory = resolve('dist/curated-releases', tag);
      for (const [command, args, env] of [
        [
          process.execPath,
          [
            '--max-old-space-size=4096',
            'scripts/build-serialized-artifacts.mjs',
            '--release',
            tag,
            '--out-dir',
            directory,
            '--cache-dir',
            'dist/curated-source-cache'
          ],
          process.env
        ],
        ['bash', ['scripts/upload-serialized-artifacts.sh'], { ...process.env, CURATED_ARTIFACT_DIR: directory }]
      ]) {
        const result = run(command, args, { env, stdio: 'inherit' });
        if (result.error || result.status !== 0)
          throw new Error(`CDM ${tag}: ${command} failed`, { cause: result.error });
      }
    } catch (error) {
      // A broken maintenance release must not hide another independently valid release.
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      'Curated release reconciliation failed: ' + failures.map((error) => error.message).join('; ')
    );
  return tags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--list')) console.log(JSON.stringify(await missingCuratedReleases()));
  else await reconcileCuratedReleases();
}
