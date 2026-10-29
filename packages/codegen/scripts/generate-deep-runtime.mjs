// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFile } from 'node:fs/promises';
import { writeRuntimeSource } from './runtime-source.mjs';

const source = (await readFile(new URL('../src/expr/deep-paths.ts', import.meta.url), 'utf8')).replace(
  'export function',
  'function'
);
await writeRuntimeSource(
  new URL('../src/expr/generated/deep-runtime-source.ts', import.meta.url),
  '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pradeep Mouli\n// Generated from ../deep-paths.ts; do not edit.\n\nexport const DEEP_RUNTIME_SOURCE = ' +
    JSON.stringify(source) +
    ';\n'
);
