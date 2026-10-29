// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Keep generated runtime strings reproducible and formatter-stable. */
export async function writeRuntimeSource(output, raw) {
  const generated = execFileSync('pnpm', ['exec', 'oxfmt', '--stdin-filepath', fileURLToPath(output)], {
    input: raw,
    encoding: 'utf8'
  });
  if (process.argv.includes('--check')) {
    if ((await readFile(output, 'utf8').catch(() => '')) !== generated)
      throw new Error(`${fileURLToPath(output)} is stale; regenerate its runtime source.`);
  } else {
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(output, generated);
  }
}
