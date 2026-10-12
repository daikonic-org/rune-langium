// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { InspectorMetadataActions } from '@rune-langium/visual-editor/model';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Old view callbacks share a live scope guard, including identical declaration IDs. */
export const createScopedMetadataActions = withInstrumentation(
  function createScopedMetadataActions(
    capturedScope: string,
    current: () => { scope: string; canEdit: (nodeId: string) => boolean },
    actions: InspectorMetadataActions
  ): InspectorMetadataActions {
    return {
      captureMetadataTarget(nodeId, path) {
        const live = current();
        return live.scope === capturedScope && live.canEdit(nodeId)
          ? actions.captureMetadataTarget(nodeId, path)
          : undefined;
      },
      applyMetadataCommand(target, command) {
        const live = current();
        if (live.scope !== capturedScope) return { status: 'stale' };
        if (!live.canEdit(target.nodeId)) return { status: 'readOnly' };
        return actions.applyMetadataCommand(target, command);
      }
    };
  },
  { op: 'createScopedMetadataActions' }
);
