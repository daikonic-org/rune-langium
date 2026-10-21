// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { EditorState } from './editor-store.js';

/**
 * Fields tracked by undo/redo (Phase 3B, Task 6).
 * Maps are the canonical SoT; arrays are derived caches (invariant I1).
 * UI state (selection, viewport) is NOT tracked.
 */
export type TrackedState = Pick<EditorState, 'nodesById' | 'edgesById'>;
