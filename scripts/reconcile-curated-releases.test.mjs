// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingCuratedReleases, reconcileCuratedReleases } from './reconcile-curated-releases.mjs';

const cohort = `cohort-${'a'.repeat(64)}`;
const catalog = {
  schemaVersion: 1,
  releases: [
    {
      modelId: 'cdm',
      repository: 'https://github.com/finos/common-domain-model',
      tag: '7.8.0',
      commit: 'b'.repeat(40),
      cohort,
      checksum: 'c'.repeat(64),
      toolchain: 'test',
      dependencies: {},
      manifest: `https://www.daikonic.dev/curated/cdm/artifacts/${cohort}/manifest.json`
    }
  ]
};
const release = (tag, date, extra = {}) => ({
  tag_name: tag,
  published_at: date,
  draft: false,
  prerelease: false,
  ...extra
});
const upstream = [
  release('7.8.0', '2026-10-01'),
  release('7.9.0', '2026-10-30'),
  release('7.8.1', '2026-11-01'),
  release('7.7.0', '2026-09-01'),
  release('8.0.0', '2026-11-02', { prerelease: true }),
  release('9.0.0', '2026-11-02', { draft: true })
];
function fetcher(releases = upstream, stored = catalog) {
  return async (url) => Response.json(String(url).includes('/releases/cdm') ? stored : releases);
}

test('discovers separate stable releases, including later maintenance releases, without relabeling Nightly', async () => {
  assert.deepEqual(await missingCuratedReleases(fetcher()), ['7.9.0', '7.8.1']);
  assert.deepEqual(await missingCuratedReleases(fetcher([upstream[0]])), []);
});
test('paginates upstream inventory and fails closed for unavailable or malformed catalogs', async () => {
  const seen = [];
  assert.deepEqual(
    await missingCuratedReleases(async (url) => {
      seen.push(String(url));
      return Response.json(
        String(url).includes('/releases/cdm')
          ? catalog
          : new URL(url).searchParams.get('page') === '1'
            ? Array.from({ length: 100 }, () => upstream[0])
            : [upstream[1]]
      );
    }),
    ['7.9.0']
  );
  assert.equal(seen.length, 3);
  await assert.rejects(
    missingCuratedReleases(async () => new Response('', { status: 503 })),
    /catalog HTTP 503/
  );
  await assert.rejects(missingCuratedReleases(fetcher([], { schemaVersion: 1, releases: [] })), /Seed/);
});
test('reuses the verified release builder and isolated receipt-gated uploader; failed builds cannot publish', async () => {
  const calls = [];
  await reconcileCuratedReleases({
    fetchImpl: fetcher(),
    run(command, args, options) {
      calls.push({ command, args, directory: options.env.CURATED_ARTIFACT_DIR });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 4);
  assert.ok(calls[0].args.includes('--release') && calls[0].args.includes('7.9.0'));
  assert.equal(calls[1].command, 'bash');
  assert.match(calls[1].directory, /curated-releases\/7\.9\.0$/);
  const failed = [];
  await assert.rejects(
    reconcileCuratedReleases({
      fetchImpl: fetcher(),
      run(command) {
        failed.push(command);
        return { status: 1 };
      }
    }),
    /failed/
  );
  assert.equal(failed.length, 2);
  assert.ok(failed.every((command) => command !== 'bash'));
  const partial = [];
  await assert.rejects(
    reconcileCuratedReleases({
      fetchImpl: fetcher(),
      run(command, args) {
        partial.push({ command, args });
        return { status: partial.length === 1 ? 1 : 0 };
      }
    }),
    /failed/
  );
  assert.equal(partial.length, 3);
  assert.ok(partial[1].args.includes('7.8.1'));
  assert.equal(partial[2].command, 'bash');
});

for (const failure of ['exit', 'throw']) {
  test(`continues to build and publish the next release after an upload ${failure}`, async () => {
    const calls = [];
    await assert.rejects(
      reconcileCuratedReleases({
        fetchImpl: fetcher(),
        run(command, args, options) {
          const tag =
            command === 'bash'
              ? options.env.CURATED_ARTIFACT_DIR.split('/').at(-1)
              : args[args.indexOf('--release') + 1];
          calls.push({ command, tag });
          if (command === 'bash' && tag === '7.9.0') {
            if (failure === 'throw') throw new Error('Uploader unavailable');
            return { status: 1 };
          }
          return { status: 0 };
        }
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.match(error.message, /7\.9\.0|Uploader unavailable/);
        return true;
      }
    );
    assert.deepEqual(
      calls.map(({ command, tag }) => [command === 'bash' ? 'upload' : 'build', tag]),
      [
        ['build', '7.9.0'],
        ['upload', '7.9.0'],
        ['build', '7.8.1'],
        ['upload', '7.8.1']
      ]
    );
  });
}
