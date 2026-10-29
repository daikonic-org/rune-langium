// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { TS_RESERVED_WORDS } from '../lens/reserved-words.js';
import { RUNE_HELPER_NAMES } from '../helpers.js';
import { RUNE_VALUE_NAMES } from '../expr/rune-value-runtime.js';

/** One binding policy for TypeScript parameters, namespace declarations and bundled exports. */
export const TYPESCRIPT_RESERVED_NAMES: ReadonlySet<string> = new Set<string>([
  ...TS_RESERVED_WORDS,
  ...RUNE_HELPER_NAMES,
  ...RUNE_VALUE_NAMES,
  'arguments',
  'eval',
  'undefined',
  'NaN',
  'Infinity',
  'globalThis',
  'Array',
  'Boolean',
  'Number',
  'String',
  'Object',
  'Set',
  'Map',
  'WeakSet',
  'WeakMap',
  'Date',
  'Temporal',
  'Math',
  'JSON',
  'RegExp',
  'Symbol',
  'BigInt',
  'Error',
  'TypeError',
  'parseInt',
  'parseFloat',
  'isFinite',
  'isNaN'
]);
