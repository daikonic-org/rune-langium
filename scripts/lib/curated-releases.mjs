// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CuratedManifestSchema, validateReferenceCatalog } from '../../packages/curated-schema/dist/index.js';

/** A dry-run plan. Publication consumes successful upload receipts, never latest pointers. */
export function prepareCuratedReleasePublication({ sources, manifests, catalogs = new Map(), baseUrl, toolchain }) {
  const releases = sources.filter((source) => source.release);
  const prepared = new Map();
  const required = new Set();
  const dependencies = new Map();
  const byId = new Map(sources.map((source) => [source.id, source]));
  if (byId.size !== sources.length) throw new Error('Duplicate source model identity');
  const base = new URL(baseUrl);
  const keyFor = (url) => {
    const parsed = new URL(url);
    if (
      parsed.origin !== base.origin ||
      !/^\/curated\/[^/]+\/artifacts\//.test(parsed.pathname) ||
      parsed.pathname.includes('/latest') ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Artifact is not immutable: ' + url);
    return parsed.pathname.slice(1);
  };
  for (const source of releases) {
    const text = manifests.get(source.id);
    if (!text) throw new Error('Missing manifest for ' + source.id);
    const manifest = CuratedManifestSchema.parse(JSON.parse(text));
    if (
      !manifest.cohort ||
      !manifest.artifacts?.serializedWorkspace ||
      manifest.modelId !== source.id ||
      manifest.upstreamCommit !== source.commit ||
      source.release.commit !== source.commit ||
      source.release.tag !== source.ref ||
      manifest.upstreamRef !== source.ref
    )
      throw new Error('Release provenance mismatch for ' + source.id);
    const deps = {};
    for (const [id, pin] of Object.entries(manifest.dependencies ?? {})) {
      const dependency = byId.get(id);
      if (!dependency?.release) throw new Error('Dependency has no verified release: ' + id);
      const dependencyText = manifests.get(id);
      if (!dependencyText) throw new Error('Missing dependency manifest: ' + id);
      const dependencyManifest = CuratedManifestSchema.parse(JSON.parse(dependencyText));
      if (dependencyManifest.cohort !== pin) throw new Error('Dependency cohort mismatch: ' + id);
      deps[id] = { modelId: id, release: dependency.release.tag };
    }
    const manifestUrl = new URL(`/curated/${source.id}/artifacts/${manifest.cohort}/manifest.json`, base).href;
    required.add(keyFor(manifestUrl));
    required.add(keyFor(manifest.artifacts.serializedWorkspace.url));
    for (const entry of Object.values(manifest.namespaces ?? {})) required.add(keyFor(entry.artifact));
    const release = {
      modelId: source.id,
      repository: `https://github.com/${source.owner}/${source.repo}`,
      tag: source.release.tag,
      commit: source.commit,
      manifest: manifestUrl,
      cohort: manifest.cohort,
      checksum: createHash('sha256').update(text).digest('hex'),
      dependencies: deps,
      toolchain
    };
    const prior = validateReferenceCatalog(catalogs.get(source.id) ?? { schemaVersion: 1, releases: [] });
    if (prior.releases.some((entry) => entry.modelId !== source.id)) throw new Error('Catalog model identity mismatch');
    const variants = prior.releases.filter(
      (entry) => entry.repository === release.repository && entry.tag === release.tag
    );
    if (variants.some((entry) => entry.commit !== release.commit))
      throw new Error('Moved release tag: ' + source.id + '@' + release.tag);
    const previous = variants.find((entry) => entry.cohort === release.cohort);
    if (previous && previous.checksum !== release.checksum)
      throw new Error('Immutable release cohort changed: ' + source.id + '@' + release.tag);
    prepared.set(
      source.id,
      validateReferenceCatalog({
        schemaVersion: 1,
        releases: [...prior.releases.filter((entry) => entry !== previous), release]
      })
    );
    dependencies.set(source.id, Object.keys(deps));
  }
  const order = [];
  const visited = new Set();
  const active = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (active.has(id)) throw new Error('Cyclic release publication dependencies: ' + id);
    active.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    active.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of prepared.keys()) visit(id);
  return { catalogs: new Map(order.map((id) => [id, prepared.get(id)])), requiredObjects: [...required] };
}

export function assertCuratedReleasePublicationReady(plan, published) {
  for (const key of plan.requiredObjects)
    if (!published.has(key)) throw new Error('Required immutable object not published: ' + key);
}
export async function publishCuratedReleaseCatalogs(plan, { published, put }) {
  assertCuratedReleasePublicationReady(plan, published);
  for (const [id, catalog] of plan.catalogs)
    await put(`releases/${id}.json`, JSON.stringify(validateReferenceCatalog(catalog)) + '\n');
}

/** Prepare local catalog files, then verify successful shell upload receipts before promotion. */
export async function main(args = process.argv.slice(2), fetchImpl = fetch) {
  const { values } = parseArgs({
    args,
    options: {
      phase: { type: 'string' },
      sources: { type: 'string' },
      manifests: { type: 'string' },
      out: { type: 'string' },
      base: { type: 'string' },
      receipts: { type: 'string' }
    }
  });
  if (values.phase === 'ready') {
    const stored = JSON.parse(await readFile(join(values.out, 'plan.json'), 'utf8'));
    assertCuratedReleasePublicationReady(stored, new Set((await readFile(values.receipts, 'utf8')).trim().split('\n')));
    return;
  }
  if (values.phase !== 'prepare') throw new Error('Choose prepare or ready');
  const sources = JSON.parse(await readFile(values.sources, 'utf8'));
  const manifests = new Map(
    await Promise.all(
      sources.map(async (source) => [source.id, await readFile(join(values.manifests, source.id + '.json'), 'utf8')])
    )
  );
  for (const source of sources.filter((source) => source.release)) {
    const manifest = CuratedManifestSchema.parse(JSON.parse(manifests.get(source.id)));
    const artifact = manifest.artifacts?.serializedWorkspace;
    if (!artifact) throw new Error('Missing serialized release artifact: ' + source.id);
    const bytes = await readFile(join(dirname(values.sources), source.id, 'latest.serialized.json.gz'));
    if (bytes.byteLength !== artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
      throw new Error('Release artifact checksum mismatch: ' + source.id);
  }
  const catalogs = new Map();
  for (const source of sources.filter((source) => source.release)) {
    const response = await fetchImpl(new URL('/releases/' + encodeURIComponent(source.id), values.base));
    if (response.status === 404) continue;
    if (!response.ok) throw new Error('Release catalog HTTP ' + response.status + ' for ' + source.id);
    catalogs.set(source.id, validateReferenceCatalog(await response.json()));
  }
  const core = JSON.parse(await readFile(new URL('../../packages/core/package.json', import.meta.url), 'utf8'));
  const codegen = JSON.parse(await readFile(new URL('../../packages/codegen/package.json', import.meta.url), 'utf8'));
  const versions = new Set(
    [...manifests.values()].map((text) => JSON.parse(text).artifacts?.serializedWorkspace?.langiumVersion)
  );
  if (versions.size !== 1 || versions.has(undefined))
    throw new Error('Release artifacts have incompatible compiler versions');
  const toolchain = JSON.stringify({
    '@rune-langium/core': core.version,
    '@rune-langium/codegen': codegen.version,
    langium: [...versions][0]
  });
  const plan = prepareCuratedReleasePublication({ sources, manifests, catalogs, baseUrl: values.base, toolchain });
  await mkdir(values.out, { recursive: true });
  for (const [id, catalog] of plan.catalogs)
    await writeFile(join(values.out, id + '.json'), JSON.stringify(catalog) + '\n');
  await writeFile(
    join(values.out, 'plan.json'),
    JSON.stringify({ requiredObjects: plan.requiredObjects, models: [...plan.catalogs.keys()] }) + '\n'
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
