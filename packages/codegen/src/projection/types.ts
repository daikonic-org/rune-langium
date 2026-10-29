// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { SourceRegion } from '@rune-langium/core';
import type { SourceMapEntry } from '../types.js';

export interface ProjectionSubject {
  uri: string;
  nodeId: string;
  region: SourceRegion;
}
export interface ProjectionImplementation {
  status: 'available' | 'unavailable';
  language: 'typescript' | 'python';
  label: string;
  reference?: string;
}
/** Serializable origin retained independently of formatted display offsets. */
export interface ProjectionOrigin {
  code: string;
  rune: string;
  fragments: { code: string; from: number; to: number; kind: string }[];
}
export interface GeneratedProjection {
  language: 'typescript' | 'python';
  subject: ProjectionSubject;
  code: string;
  sourceMap: SourceMapEntry[];
  requiredHelpers: readonly string[];
  implementation?: ProjectionImplementation;
  syntax?: 'expression' | 'statements';
  origins?: ProjectionOrigin[];
  /** Emitter-recorded body or predicate for an embedded editor. */
  body?: {
    code: string;
    sourceMap: SourceMapEntry[];
    implementation?: ProjectionImplementation;
    syntax?: 'expression' | 'statements';
    origins?: ProjectionOrigin[];
  };
}
/** Provenance recorded during emission, independent of an editor's node-ID format. */
export interface EmittedProjection {
  kind: 'function' | 'condition';
  source: { uri: string; region: SourceRegion };
  code: string;
  sourceMap: SourceMapEntry[];
  body?: {
    code: string;
    sourceMap: SourceMapEntry[];
    implementation?: ProjectionImplementation;
    syntax?: 'expression' | 'statements';
    origins?: ProjectionOrigin[];
  };
}
