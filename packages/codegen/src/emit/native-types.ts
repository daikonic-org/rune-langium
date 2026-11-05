// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isRosettaBasicType,
  isRosettaRecordType,
  type RosettaBasicType,
  type RosettaRecordType,
  type RosettaType
} from '@rune-langium/core';
import { resolveBuiltin } from './language-profile.js';
import { typescriptProfile } from './typescript-profile.js';

export type TypeScriptNativeType = RosettaBasicType | RosettaRecordType;

export function isTypeScriptNativeMapping(mapped: unknown): mapped is string {
  return typeof mapped === 'string' && (mapped.startsWith('Temporal.') || mapped === 'globalThis.RegExp');
}

/** Native value descriptors follow the same profile as field and function signatures. */
export function isTypeScriptNativeType(node: RosettaType | undefined): node is TypeScriptNativeType {
  if (!isRosettaBasicType(node) && !isRosettaRecordType(node)) return false;
  const mapped = resolveBuiltin(typescriptProfile, node.name);
  return isTypeScriptNativeMapping(mapped);
}
