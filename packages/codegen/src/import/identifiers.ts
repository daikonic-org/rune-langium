// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Normalize source names into Rune identifier characters; callers choose the empty-name fallback. */
export function sanitizeIdentifier(raw: string, fallback: string): string {
  let cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) cleaned = fallback;
  if (/^[0-9]/.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned;
}

/** Reserve a unique identifier, retaining source order and existing numeric suffixes. */
export function dedupeIdentifier(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Drop invalid namespace characters and reject segments with an invalid leading character. */
export function sanitizeNamespaceSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : '';
}
