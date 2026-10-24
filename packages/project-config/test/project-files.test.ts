// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { isIgnoredProjectEntry } from '../src/project-files.js';
it.each(['.git', '.GIT', '.studio', 'node_modules'])('excludes non-project entry %s for every host', (name) => {
  expect(isIgnoredProjectEntry(name)).toBe(true);
});
it.each(['.github', 'model', 'node_modules.rosetta', 'package.json'])('retains project entry %s', (name) => {
  expect(isIgnoredProjectEntry(name)).toBe(false);
});
