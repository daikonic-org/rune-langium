// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Graph state for consumers that do not render editor components. */
export { createEditorStore, useEditorStore } from './store/editor-store.js';
export { selectNodeRepository } from './store/node-repository.js';
export type { NodeRepository, NodeOf } from './store/node-repository.js';
export type {
  InspectorMetadataActions,
  MetadataPath,
  MetadataNode,
  MetadataTarget,
  MetadataCommand,
  MetadataEditResult
} from './store/metadata-target.js';
export { createAnnotationDraft, createSynonymDraft } from './store/metadata-ops.js';
