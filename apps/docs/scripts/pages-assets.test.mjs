// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyPagesAssets, PAGES_ASSET_LIMIT, validatePagesAssets } from './pages-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rune-pages-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('combined assets omit nested maps from every source and preserve local maps', (t) => {
  const root = fixture(t);
  const output = join(root, 'output');
  for (const source of ['site', 'docs', 'studio']) {
    const input = join(root, source);
    const assets = join(input, 'assets');
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(input, 'index.html'), '<html></html>');
    writeFileSync(join(assets, 'index.js'), 'export {};');
    writeFileSync(join(assets, 'index.css'), 'body {}');
    writeFileSync(join(assets, 'index.js.map'), '');
    truncateSync(join(assets, 'index.js.map'), PAGES_ASSET_LIMIT + 1);
    writeFileSync(join(assets, 'index.css.map'), '{}');
    const destination = join(output, 'rune-studio', source);
    copyPagesAssets(input, destination);
    for (const file of ['index.html', 'assets/index.js', 'assets/index.css']) {
      assert.ok(existsSync(join(destination, file)), file);
    }
    for (const file of ['index.js.map', 'index.css.map']) {
      assert.ok(existsSync(join(assets, file)), 'local source map retained');
      assert.equal(existsSync(join(destination, 'assets', file)), false);
    }
  }
  assert.ok(validatePagesAssets(output));
});

test('preflight permits the exact Pages limit and reports the largest asset', (t) => {
  const root = fixture(t);
  const file = join(root, 'bundle.wasm');
  writeFileSync(file, '');
  truncateSync(file, PAGES_ASSET_LIMIT);
  writeFileSync(join(root, 'index.html'), 'hello');
  assert.deepEqual(validatePagesAssets(root), { path: 'bundle.wasm', size: PAGES_ASSET_LIMIT });
});

test('preflight rejects oversized assets with their relative path and byte size', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'assets'));
  const file = join(root, 'assets', 'bundle.wasm');
  writeFileSync(file, '');
  truncateSync(file, PAGES_ASSET_LIMIT + 1);
  assert.throws(() => validatePagesAssets(root), /assets\/bundle\.wasm \(26214401 bytes\)/);
});

test('preflight rejects source maps introduced after copying', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'bundle.js.map'), '{}');
  assert.throws(() => validatePagesAssets(root), /source map in public Pages output: bundle\.js\.map/);
});

test('missing build input fails instead of publishing an incomplete tree', (t) => {
  const root = fixture(t);
  assert.throws(() => copyPagesAssets(join(root, 'missing'), join(root, 'output')), /ENOENT/);
});
