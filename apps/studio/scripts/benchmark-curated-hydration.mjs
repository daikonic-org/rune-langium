// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Local-only A/B replay: real pinned gzip artifacts, deterministic simulated I/O.
// No HTTP calls, production state, source parsing, or browser rendering.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const [artifactArg = 'dist/codegen-corpus-artifacts', baselineArg = 'origin/master'] = process.argv.slice(2);
const artifactRoot = path.resolve(root, artifactArg);
const output = path.join(root, 'dist/issue-582/benchmark');
const baseline = execFileSync('git', ['rev-parse', baselineArg], { cwd: root, encoding: 'utf8' }).trim();
const sources = JSON.parse(await readFile(path.join(artifactRoot, 'resolved-sources.json'), 'utf8'));
const cohort = `cohort-${createHash('sha256').update(JSON.stringify(sources)).digest('hex')}`;
const manifests = new Map();
const payloads = new Map();
const delays = new Map();
for (const source of sources) {
  const meta = JSON.parse(await readFile(path.join(artifactRoot, source.id, 'artifact-meta.json'), 'utf8'));
  if (meta.upstreamCommit !== source.commit) throw new Error(`Artifact provenance mismatch: ${source.id}`);
  manifests.set(source.id, {
    ...meta,
    version: meta.version.slice(0, 10),
    schemaVersion: 2,
    cohort,
    generatedAt: '2026-10-18T00:00:00Z',
    upstreamRef: source.ref,
    archiveUrl: `https://www.daikonic.dev/curated/${source.id}/latest.tar.gz`,
    history: [],
    dependencies: Object.fromEntries(Object.keys(meta.dependencies).map((id) => [id, cohort]))
  });
  const names = (await readdir(path.join(artifactRoot, source.id, 'ns'))).sort();
  for (const [index, name] of names.entries()) {
    const key = `${source.id}/${name}`;
    payloads.set(key, await readFile(path.join(artifactRoot, source.id, 'ns', name)));
    delays.set(key, index % 8 === 0 ? 120 : 15);
  }
}

await mkdir(output, { recursive: true });
const service = path.join(root, 'apps/studio/src/services');
for (const variant of ['before', 'after']) {
  await build({
    stdin: {
      contents: `export { loadCuratedWorkspace } from './curated-workspace.ts';
        export { configureInstrumentation } from './instrumentation/core.ts';`,
      resolveDir: service,
      loader: 'ts'
    },
    outfile: path.join(output, `${variant}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins:
      variant === 'before'
        ? [
            {
              name: 'baseline-sources',
              setup(plugin) {
                plugin.onLoad({ filter: /\/curated-(?:fetch|workspace)\.ts$/ }, (args) => ({
                  contents: execFileSync('git', ['show', `${baseline}:${path.relative(root, args.path)}`], {
                    cwd: root,
                    encoding: 'utf8'
                  }),
                  loader: 'ts',
                  resolveDir: path.dirname(args.path)
                }));
              }
            }
          ]
        : []
  });
}

const rows = [];
for (let repeat = 0; repeat < 3; repeat++) {
  // Alternate order to reduce process/JIT warmup bias; each import resets caches.
  for (const variant of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
    const module = await import(`${pathToFileURL(path.join(output, `${variant}.mjs`))}?repeat=${repeat}`);
    const stages = [];
    module.configureInstrumentation((record) => stages.push(record), undefined, { level: 'trace', timingOnly: true });
    const roots = sources.map(({ id }) => ({ id, version: cohort }));
    let calls = [];
    let active = 0;
    let peak = 0;
    const fetcher = async (url) => {
      const pathname = new URL(url).pathname;
      const id = pathname.split('/')[2];
      const name = path.basename(pathname);
      const key = `${id}/${name}`;
      calls.push(pathname);
      peak = Math.max(peak, ++active);
      try {
        await new Promise((resolve) => setTimeout(resolve, name === 'manifest.json' ? 25 : delays.get(key)));
        if (name === 'manifest.json') return new Response(JSON.stringify(manifests.get(id)));
        const payload = payloads.get(key);
        if (!payload) throw new Error(`Missing local artifact: ${key}`);
        return new Response(payload);
      } finally {
        active--;
      }
    };
    let known = new Set();
    for (const mode of ['cold', 'warm-isolate', 'browser-receipts']) {
      calls = [];
      peak = 0;
      stages.length = 0;
      const start = performance.now();
      const loaded = await module.loadCuratedWorkspace(roots, new Set(['cdm.base.datetime']), fetcher, false, known);
      const durationMs = performance.now() - start;
      if (mode === 'warm-isolate') known = new Set(loaded.artifacts.map(({ key }) => key));
      const stageTotals = {};
      for (const { op, durationMs: elapsed } of stages) {
        const total = (stageTotals[op] ??= { calls: 0, elapsedMs: 0 });
        total.calls++;
        total.elapsedMs += elapsed ?? 0;
      }
      const digest = createHash('sha256').update(JSON.stringify(loaded)).digest('hex');
      rows.push({
        repeat,
        variant,
        mode,
        durationMs,
        requests: calls.length,
        peak,
        artifactCount: loaded.artifacts.length,
        documentCount: loaded.bundles.reduce((sum, bundle) => sum + bundle.documents.length, 0),
        digest,
        stageTotals
      });
    }
  }
}
for (const repeat of [0, 1, 2]) {
  for (const mode of ['cold', 'warm-isolate', 'browser-receipts']) {
    const pair = rows.filter((row) => row.repeat === repeat && row.mode === mode);
    if (pair[0].digest !== pair[1].digest) throw new Error(`Output changed: ${repeat}/${mode}`);
    if (pair.some((row) => row.peak > 8)) throw new Error(`Concurrency exceeded: ${repeat}/${mode}`);
  }
}
const result = { baseline, cohort, sources, simulatedLatencyMs: { manifest: 25, artifact: [15, 120] }, rows };
await writeFile(path.join(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
for (const variant of ['before', 'after']) {
  for (const mode of ['cold', 'warm-isolate', 'browser-receipts']) {
    const group = rows.filter((row) => row.variant === variant && row.mode === mode);
    const times = group.map((row) => row.durationMs).sort((a, b) => a - b);
    console.log(
      `${variant} ${mode}: median ${times[1].toFixed(1)} ms, ${group[0].requests} requests, ${group[0].artifactCount} artifacts, ${group[0].documentCount} documents`
    );
  }
}
console.log(`Identical closure outputs verified; evidence: ${path.join(output, 'results.json')}`);
