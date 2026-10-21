// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * useTypeRefDrop — shared drop-target hook for `application/x-rune-type-ref`
 * payloads (Structure View, Phase 4).
 *
 * Consumed by:
 * - Phase 5 TypePickerCell (cell-level drop)
 * - Phase 8 NamespaceExplorer palette (cross-pane drop)
 * - Phase 9 CodeMirror editor (paste-as-drop)
 *
 * Design notes:
 * - The hook is purely event-handler driven; it has no subscriptions and
 *   needs no cleanup. Do not add `useEffect`.
 * - During `dragover`, browsers return `''` from `dataTransfer.getData` for
 *   security; only `dataTransfer.types` is reliable. We check for kind-specific
 *   MIME variants (typeRefMimeForKind) so the `accept` policy is enforced at
 *   dragover time, not just at drop time.
 * - `dropEffect` writes can throw in some strict-mode test stubs; we guard
 *   the assignment defensively without altering the public contract.
 * - The `enterCountRef` pattern (shared by nested native drop targets) prevents
 *   `isOver` from flickering when the pointer crosses child element boundaries
 *   inside the drop zone.
 *
 * @module
 */

import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  TYPE_REF_PAYLOAD_MIME,
  type TypeRefPayload,
  isTypeRefPayload,
  typeRefMimeForKind
} from '../types/structure-view.js';

export interface UseTypeRefDropOptions {
  /**
   * Kinds this drop target will accept. Drops whose `payload.kind` is not in
   * this list are silently ignored (no `onDrop` call).
   *
   * `isOver` semantics during dragover depend on what the drag source
   * registered on `dataTransfer`:
   * - **Kind-specific MIME** (e.g. `application/x-rune-type-ref+data`): `isOver`
   *   is set only when at least one registered kind matches this list — strict
   *   accept gating during hover.
   * - **Canonical MIME only** (`application/x-rune-type-ref`, no kind suffix):
   *   `isOver` is set as a backward-compatibility fallback; kind filtering
   *   moves to drop time via the parsed payload + `accept` check. Hover may
   *   briefly show "accepting" before the drop is rejected.
   *
   * Drag sources following the recommended dual-MIME contract get the strict
   * behavior; single-MIME sources still work but lose dragover-time filtering.
   */
  readonly accept: ReadonlyArray<TypeRefPayload['kind']>;
  /** Called with the parsed payload when an accepted drop completes. */
  readonly onDrop: (payload: TypeRefPayload) => void;
}

export interface UseTypeRefDropResult {
  readonly dragOverHandlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** True between an accepted `dragenter` and the subsequent `dragleave`/`drop`. */
  readonly isOver: boolean;
}

function parsePayload(e: React.DragEvent): TypeRefPayload | undefined {
  const raw = e.dataTransfer?.getData(TYPE_REF_PAYLOAD_MIME);
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return isTypeRefPayload(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function useTypeRefDrop(opts: UseTypeRefDropOptions): UseTypeRefDropResult {
  const { accept, onDrop } = opts;
  const [isOver, setIsOver] = useState(false);

  // enterCountRef prevents isOver from flickering when the pointer crosses
  // child element boundaries inside the drop zone .
  const enterCountRef = useRef(0);

  // Memoize the acceptable MIME set so the dragover/dragenter handlers can do
  // O(1) lookups without recomputing per event.
  const acceptableMimes = useMemo(() => new Set(accept.map(typeRefMimeForKind)), [accept]);

  /**
   * Returns true when the dataTransfer should be treated as an accepted drag.
   *
   * Three-phase check:
   * 0. If `accept` is empty, return false immediately — the target accepts nothing.
   *    This is the "disabled target" semantic: `accept: []` means reject all drags,
   *    including the canonical-MIME fallback path. Without this guard the canonical
   *    fallback loop would match any `application/x-rune-type-ref` drag even when
   *    the consumer has explicitly opted out (e.g. TypePickerCell when disabled).
   * 1. If the source registered ANY kind-specific MIME (`TYPE_REF_PAYLOAD_MIME+<kind>`),
   *    use strict policy: accept only if at least one of those kinds is in `acceptableMimes`.
   *    This enforces accept-policy during the dragover phase for dual-MIME sources.
   * 2. If NO kind-specific MIME is present but the canonical `TYPE_REF_PAYLOAD_MIME` is,
   *    allow the drag through (single-MIME fallback). Accept-policy enforcement moves to
   *    drop time via `parsePayload` + `accept`. Hover may briefly show "accepting" for
   *    drags whose payload kind will ultimately be rejected — migration-safety trade-off.
   */
  function hasAcceptedMime(
    types: DataTransfer['types'] | ReadonlyArray<string> | undefined,
    currentAccept: ReadonlyArray<TypeRefPayload['kind']>
  ): boolean {
    // Phase 0: empty accept means "reject everything" (disabled-target semantics).
    if (currentAccept.length === 0) return false;
    if (!types) return false;
    // Phase 1: scan for any kind-specific MIME (prefix `TYPE_REF_PAYLOAD_MIME+`).
    // If the source registered at least one kind-specific MIME, use strict policy:
    // accept only if one of them is in acceptableMimes (enforces accept during hover).
    const kindMimePrefix = `${TYPE_REF_PAYLOAD_MIME}+`;
    let hasAnyKindSpecific = false;
    for (const type of types) {
      const t = type.toLowerCase();
      if (t.startsWith(kindMimePrefix)) {
        hasAnyKindSpecific = true;
        if (acceptableMimes.has(t)) return true;
      }
    }
    if (hasAnyKindSpecific) return false; // kind-specific present but none matched
    // Phase 2: canonical MIME alone — source didn't register any kind-specific MIME.
    // Drop handler still validates via parsePayload + accept before firing onDrop.
    for (const type of types) {
      if (type.toLowerCase() === TYPE_REF_PAYLOAD_MIME) return true;
    }
    return false;
  }

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!hasAcceptedMime(e.dataTransfer?.types, accept)) return;
      enterCountRef.current++;
      setIsOver(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accept, acceptableMimes]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!hasAcceptedMime(e.dataTransfer?.types, accept)) return;
      e.preventDefault();
      // Some test stubs / locked-down browsers may make dropEffect read-only.
      try {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
      } catch {
        // Non-fatal; the accept signal is carried by preventDefault().
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accept, acceptableMimes]
  );

  const onDragLeave = useCallback((_e: React.DragEvent) => {
    enterCountRef.current--;
    if (enterCountRef.current <= 0) {
      enterCountRef.current = 0;
      setIsOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      // Always reset hover state — a drop ends the drag session regardless of
      // whether the payload is ours. This prevents isOver from persisting after
      // non-type-ref drops (e.g., plain text or file drops onto a CodeMirror
      // surface that also uses this hook in Phase 9).
      enterCountRef.current = 0;
      setIsOver(false);

      const payload = parsePayload(e);
      if (!payload) return; // not a type-ref drop — let the browser handle it

      // Belt-and-braces: also check kind for sources that registered the
      // canonical MIME but not the kind-specific one.
      if (!accept.includes(payload.kind)) return; // not accepted — let browser handle

      // Only preventDefault once we've confirmed the payload is ours and accepted.
      // Calling it unconditionally would suppress plain-text/file drops on any
      // shared surface (e.g., CodeMirror editor in Phase 9).
      e.preventDefault();
      onDrop(payload);
    },
    [accept, onDrop]
  );

  return {
    isOver,
    dragOverHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop }
  };
}
