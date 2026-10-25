// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { projectBytesRevision } from '@rune-langium/project-config';
import type { ReferenceCache } from './types.js';
/** Bounded immutable-byte cache; persistence hosts can supply the same interface. */
export function createMemoryReferenceCache(maxBytes = 128 * 1024 * 1024): ReferenceCache {
  const entries = new Map<string, Uint8Array>();
  let size = 0;
  return {
    async get(key) {
      const value = entries.get(key);
      if (value) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value?.slice();
    },
    async put(key, bytes) {
      if (bytes.byteLength > maxBytes || (await projectBytesRevision(bytes)) !== key) return;
      const copy = bytes.slice();
      size -= entries.get(key)?.byteLength ?? 0;
      entries.delete(key);
      while (entries.size && size + copy.byteLength > maxBytes) {
        const oldest = entries.keys().next().value!;
        size -= entries.get(oldest)!.byteLength;
        entries.delete(oldest);
      }
      entries.set(key, copy);
      size += copy.byteLength;
    }
  };
}
