// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { DockviewApi } from 'dockview-react';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const COLLAPSED_SIDE_WIDTH = 52;

type Snapshot = ReturnType<DockviewApi['toJSON']>;
type ResponsiveSnapshot = Snapshot & { studioAutomaticPreviewWidths?: Record<string, number> };

/** Expanded intent accompanies native geometry; never take pixels from another saved group. */
export const expandedPreviewSnapshot = withInstrumentation(
  function expandedPreviewSnapshot(snapshot: Snapshot, widths: ReadonlyMap<string, number>): Snapshot {
    const { studioAutomaticPreviewWidths: _previous, ...native } = snapshot as ResponsiveSnapshot;
    return widths.size
      ? ({ ...native, studioAutomaticPreviewWidths: Object.fromEntries(widths) } as ResponsiveSnapshot)
      : native;
  },
  { op: 'expandedPreviewSnapshot', sanitize: () => ({}) }
);

export const automaticPreviewWidths = withInstrumentation(
  function automaticPreviewWidths(snapshot: unknown): ReadonlyMap<string, number> {
    if (!snapshot || typeof snapshot !== 'object' || !('studioAutomaticPreviewWidths' in snapshot)) return new Map();
    const value = snapshot.studioAutomaticPreviewWidths;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    return new Map(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > COLLAPSED_SIDE_WIDTH
      )
    );
  },
  { op: 'automaticPreviewWidths', sanitize: () => ({}) }
);
