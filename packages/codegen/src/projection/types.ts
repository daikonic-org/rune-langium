// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { SourceRegion } from '@rune-langium/core';
import type { SourceMapEntry } from '../types.js';

export interface ProjectionSubject {
  uri: string;
  nodeId: string;
  region: SourceRegion;
}
export interface GeneratedProjection {
  language: 'typescript' | 'python';
  subject: ProjectionSubject;
  code: string;
  sourceMap: SourceMapEntry[];
  requiredHelpers: readonly string[];
  /** Emitter-recorded body or predicate for an embedded editor. */
  body?: { code: string; sourceMap: SourceMapEntry[] };
}
/** Provenance recorded during emission, independent of an editor's node-ID format. */
export interface EmittedProjection {
  kind: 'function' | 'condition';
  source: { uri: string; region: SourceRegion };
  code: string;
  sourceMap: SourceMapEntry[];
  body?: { code: string; sourceMap: SourceMapEntry[] };
}
