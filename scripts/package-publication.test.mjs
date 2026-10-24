// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../packages/', import.meta.url);
const packages = new Map(
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = JSON.parse(readFileSync(new URL(`${entry.name}/package.json`, root), 'utf8'));
      return [manifest.name, manifest];
    })
);

for (const consumer of ['@rune-langium/cli', '@rune-langium/lsp-server']) {
  test(`${consumer} has a publishable workspace runtime dependency closure`, () => {
    const seen = new Set();
    const visit = (name, chain) => {
      if (seen.has(name)) return;
      seen.add(name);
      const manifest = packages.get(name);
      assert.ok(manifest, `Missing workspace package ${name}`);
      const path = [...chain, name];
      assert.notEqual(manifest.private, true, `${path.join(' -> ')} is private`);
      assert.equal(manifest.publishConfig?.access, 'public', `${path.join(' -> ')} lacks public scoped access`);
      for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const dependency of Object.keys(manifest[kind] ?? {})) {
          if (packages.has(dependency)) visit(dependency, path);
        }
      }
    };
    visit(consumer, []);
  });
}
