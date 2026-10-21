// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { discoverFiles } from '../src/discover-files.js';

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('discovers nested Rune files and retains explicit input order and duplicates', async () => {
  directory = await mkdtemp(join(tmpdir(), 'rune-discovery-'));
  await mkdir(join(directory, 'nested'));
  const first = join(directory, 'first.rosetta');
  const nested = join(directory, 'nested', 'second.rosetta');
  await Promise.all([
    writeFile(first, ''),
    writeFile(nested, ''),
    writeFile(join(directory, 'ignore.txt'), ''),
    writeFile(join(directory, 'ignore.ROSETTA'), '')
  ]);
  const files = await discoverFiles([relative(process.cwd(), nested), directory]);
  expect(files[0]).toBe(nested);
  expect(files.slice(1).sort()).toEqual([first, nested].sort());
});

it('propagates missing input errors instead of silently skipping them', async () => {
  directory = await mkdtemp(join(tmpdir(), 'rune-discovery-'));
  await expect(discoverFiles([join(directory, 'missing.rosetta')])).rejects.toMatchObject({ code: 'ENOENT' });
});
