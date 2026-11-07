#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { readFile, readdir } from 'node:fs/promises';
import { writeRuntimeSource } from '../../codegen/scripts/runtime-source.mjs';
const root = new URL('../src/curated-implementations/', import.meta.url);
const files = (await readdir(new URL('rune/', root)))
  .filter((file) => file.endsWith('.rosetta') || file === 'LICENSE' || /-(LICENSE|NOTICE)\.txt$/.test(file))
  .sort();
const sources = Object.fromEntries(
  await Promise.all(files.map(async (file) => [file, await readFile(new URL('rune/' + file, root), 'utf8')]))
);
const content =
  '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pradeep Mouli\n// Generated from rune/ sources and license; do not edit.\nexport const RUNE_IMPLEMENTATION_SOURCES: Readonly<Record<string,string>> = ' +
  JSON.stringify(sources, null, 2) +
  ';\n';
const destination = new URL('generated/rune-sources.ts', root);
await writeRuntimeSource(destination, content);
