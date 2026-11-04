// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFile } from 'node:fs/promises';
import { writeRuntimeSource } from './runtime-source.mjs';

const source = (await readFile(new URL('../../core/src/serialization/rune-json.ts', import.meta.url), 'utf8'))
  .split('export type ProjectDataFormat')[0]
  .replaceAll('export ', '');
await writeRuntimeSource(
  new URL('../src/expr/generated/rune-json-runtime-source.ts', import.meta.url),
  '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pradeep Mouli\n// Generated from core/src/serialization/rune-json.ts; do not edit.\n\nexport const RUNE_JSON_RUNTIME_SOURCE = ' +
    JSON.stringify(source) +
    ';\n'
);
