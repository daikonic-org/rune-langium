// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { discoverFiles } from './discover-files.js';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { parse } from '@rune-langium/core';
import type { ParseResult } from '@rune-langium/core';
import { URI } from 'langium';

export interface ParseCommandOptions {
  json?: boolean;
}

/**
 * Parse one or more Rosetta DSL files and report results.
 */
export async function runParse(paths: string[], options: ParseCommandOptions): Promise<number> {
  const files = await discoverFiles(paths);
  if (files.length === 0) {
    console.error('No .rosetta files found.');
    return 1;
  }

  let hasErrors = false;
  const results: Array<{
    file: string;
    errors: string[];
    elementCount: number;
  }> = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const result: ParseResult = await parse(content, URI.file(file).toString());
    const errors = [
      ...result.lexerErrors.map(
        (e) => `${relative(process.cwd(), file)}:${e.line ?? 0}:${e.column ?? 0}: ${e.message}`
      ),
      ...result.parserErrors.map(
        (e) => `${relative(process.cwd(), file)}:${e.line ?? 0}:${e.column ?? 0}: ${e.message}`
      )
    ];

    if (errors.length > 0) hasErrors = true;

    results.push({
      file: relative(process.cwd(), file),
      errors,
      elementCount: result.value.elements.length
    });
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      if (r.errors.length > 0) {
        for (const err of r.errors) {
          console.error(err);
        }
      } else {
        console.log(`${r.file}: OK (${r.elementCount} elements)`);
      }
    }
  }

  return hasErrors ? 1 : 0;
}
