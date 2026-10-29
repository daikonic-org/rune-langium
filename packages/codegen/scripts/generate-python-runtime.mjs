// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFile } from 'node:fs/promises';
import { writeRuntimeSource } from './runtime-source.mjs';

const source = await readFile(new URL('../src/projection/python-runtime.py', import.meta.url), 'utf8');
const output = new URL('../src/projection/generated/python-runtime-source.ts', import.meta.url);
const raw =
  '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Pradeep Mouli\n// Generated from ../python-runtime.py; do not edit.\n\nexport const PYTHON_RUNTIME_SOURCE = ' +
  JSON.stringify(source) +
  ';\n';
await writeRuntimeSource(output, raw);
