// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerExplicitDecorators } from './explicit-decorators.ts';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const outputRoot = fileURLToPath(new URL('../dist/src/', import.meta.url));
let count = 0;

async function lowerDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) await lowerDirectory(source);
    else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const result = lowerExplicitDecorators(await readFile(source, 'utf8'), source);
      if (!result) continue;
      const output = join(outputRoot, relative(sourceRoot, source)).replace(/\.ts$/, '.js');
      const previous = await readFile(output, 'utf8');
      if (previous !== result.code) await writeFile(output, result.code);
      if (result.map) {
        result.map.file = basename(output);
        result.map.sourceRoot = '';
        result.map.sources = [relative(dirname(output), source).replaceAll('\\', '/')];
        const text = JSON.stringify(result.map) + '\n';
        if ((await readFile(output + '.map', 'utf8')) !== text) await writeFile(output + '.map', text);
      }
      count++;
    }
  }
}

await lowerDirectory(sourceRoot);
console.log(`Lowered explicit decorators in ${count} Codegen modules`);
