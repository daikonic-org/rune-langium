// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { unwrapMetadata, type FieldMetadataKind } from './metadata-runtime.js';
import { parenthesizeReceiver } from './syntax.js';

export function renderPresenceCount(values: string, typescript = false): string {
  return `(${values}).filter((value${typescript ? ': unknown' : ''}) => value != null && (!Array.isArray(value) || value.length > 0)).length`;
}

/** Presence of typed values; reference wrappers can legitimately have no payload. */
export function renderPresence(
  value: string,
  many: boolean | undefined,
  metadata?: FieldMetadataKind,
  absent = false,
  typescript = false
): string {
  if (many === undefined) {
    const present = `((value${typescript ? ': unknown' : ''}) => value != null && (!Array.isArray(value) || value.length > 0))(${value})`;
    return absent ? `!${present}` : present;
  }
  if (!many) return `${metadata ? unwrapMetadata(value, false) : value} ${absent ? '==' : '!='} null`;
  const receiver = parenthesizeReceiver(value);
  const present =
    metadata === 'reference' ? `${receiver}?.some((field) => field.value != null)` : `${receiver}?.length`;
  return `${absent ? '!' : '!!'}${present}`;
}
