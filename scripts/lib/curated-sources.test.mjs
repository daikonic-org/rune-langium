// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCuratedSources } from './curated-sources.mjs';

function fixture({ cdmRune = '10.10.0', fpmlRune = cdmRune, failedTag = false } = {}) {
  const calls = [];
  const cdm = 'a'.repeat(40),
    fpml = 'b'.repeat(40),
    rune = 'c'.repeat(40);
  const poms = new Map([
    [
      `finos/common-domain-model/contents/pom.xml?ref=${cdm}`,
      `<project><rosetta.dsl.version>${cdmRune}</rosetta.dsl.version><rune-fpml.version>3.5.0</rune-fpml.version></project>`
    ],
    [
      `rosetta-models/rune-fpml/contents/pom.xml?ref=${fpml}`,
      `<project><rosetta.dsl.version>${fpmlRune}</rosetta.dsl.version></project>`
    ]
  ]);
  const commits = new Map([
    ['finos/common-domain-model/commits/master', cdm],
    ['rosetta-models/rune-fpml/commits/3.5.0', fpml],
    [`finos/rune-dsl/commits/${cdmRune}`, rune]
  ]);
  return {
    calls,
    fetch: async (url) => {
      const path = url.replace('https://api.github.com/repos/', '');
      calls.push(path);
      if (failedTag && path === `finos/rune-dsl/commits/${cdmRune}`) return new Response('', { status: 404 });
      if (poms.has(path))
        return Response.json({ encoding: 'base64', content: Buffer.from(poms.get(path)).toString('base64') });
      assert.ok(commits.has(path), `Unexpected request: ${url}`);
      return Response.json({ sha: commits.get(path) });
    }
  };
}

test('resolves dependency tags from the exact CDM commit and records immutable inputs', async () => {
  const mock = fixture();
  const sources = await resolveCuratedSources(mock.fetch);
  assert.deepEqual(
    sources.map(({ id, ref, commit }) => ({ id, ref, commit })),
    [
      { id: 'cdm', ref: 'master', commit: 'a'.repeat(40) },
      { id: 'fpml', ref: '3.5.0', commit: 'b'.repeat(40) },
      { id: 'rune-dsl', ref: '10.10.0', commit: 'c'.repeat(40) }
    ]
  );
  assert.equal(mock.calls.length, 5);
});

test('rejects conflicting runtime requirements instead of combining development heads', async () => {
  await assert.rejects(resolveCuratedSources(fixture({ fpmlRune: '9.92.1' }).fetch), /Incompatible Rune dependencies/);
  await assert.rejects(resolveCuratedSources(fixture({ fpmlRune: '10.11.0' }).fetch), /Incompatible Rune dependencies/);
  await assert.rejects(resolveCuratedSources(fixture({ fpmlRune: '10.10.1' }).fetch), /Incompatible Rune dependencies/);
});

test('uses the CDM runtime when it upgrades an older FpML transitive dependency', async () => {
  const sources = await resolveCuratedSources(fixture({ fpmlRune: '10.7.0' }).fetch);
  assert.equal(sources.find(({ id }) => id === 'rune-dsl').ref, '10.10.0');
});

test('rejects unresolved POM properties and missing release tags', async () => {
  await assert.rejects(
    resolveCuratedSources(fixture({ cdmRune: '${rune.version}' }).fetch),
    /explicit release version/
  );
  await assert.rejects(resolveCuratedSources(fixture({ failedTag: true }).fetch), /GitHub HTTP 404/);
});

for (const annotated of [false, true])
  test('verifies release tags without resolving a same-named branch; annotated=' + annotated, async () => {
    const tags = {
      'finos/common-domain-model': ['6.0.0', 'a'.repeat(40)],
      'rosetta-models/rune-fpml': ['3.5.0', 'b'.repeat(40)],
      'finos/rune-dsl': ['10.10.0', 'c'.repeat(40)]
    };
    const seen = [];
    const fetch = async (url) => {
      const path = String(url).replace('https://api.github.com/repos/', '');
      seen.push(path);
      for (const [repo, [tag, sha]] of Object.entries(tags)) {
        if (path === `${repo}/releases/tags/${tag}`) return Response.json({ tag_name: tag });
        if (annotated && repo === 'finos/common-domain-model' && path === `${repo}/git/ref/tags/${tag}`)
          return Response.json({ object: { type: 'tag', sha: 'e'.repeat(40) } });
        if (annotated && path === `${repo}/git/tags/${'e'.repeat(40)}`)
          return Response.json({ object: { type: 'commit', sha } });
        if (path === `${repo}/git/ref/tags/${tag}`) return Response.json({ object: { type: 'commit', sha } });
        if (path === `${repo}/contents/pom.xml?ref=${sha}`)
          return Response.json({
            encoding: 'base64',
            content: Buffer.from(
              repo.includes('common-domain-model')
                ? '<project><rosetta.dsl.version>10.10.0</rosetta.dsl.version><rune-fpml.version>3.5.0</rune-fpml.version></project>'
                : '<project><rosetta.dsl.version>10.10.0</rosetta.dsl.version></project>'
            ).toString('base64')
          });
      }
      throw new Error('Unexpected release request: ' + path);
    };
    const sources = await resolveCuratedSources(fetch, { cdmRelease: '6.0.0' });
    assert.deepEqual(
      sources.map((source) => source.release),
      Object.values(tags).map(([tag, commit]) => ({ tag, commit }))
    );
    assert.ok(seen.every((path) => !path.includes('/commits/')));
    await assert.rejects(
      resolveCuratedSources(async () => new Response('', { status: 404 }), { cdmRelease: 'missing' }),
      /GitHub HTTP 404/
    );
  });
