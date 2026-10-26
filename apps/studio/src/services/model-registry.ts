// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Curated registry of well-known Rune DSL model repositories.
 * @see specs/008-core-editor-features/data-model.md — ModelRegistry, ModelSource
 */

import type { ModelSource } from '../types/model-types.js';
import { CURATED_MODEL_REPOSITORIES } from '@rune-langium/curated-schema';
import { withInstrumentation, Capture } from './instrumentation/core.js';

const MIRROR_BASE = 'https://www.daikonic.dev/curated';

/**
 * Built-in curated model sources. The `archiveUrl` is the preferred load
 * path (CF R2 mirror); `repoUrl`/`ref` are kept for the custom-URL flow
 * and as a documentation pointer to upstream.
 */
const CURATED_MODELS: readonly ModelSource[] = [
  {
    id: 'cdm',
    name: 'CDM (Common Domain Model)',
    repoUrl: `${CURATED_MODEL_REPOSITORIES.cdm}.git`,
    ref: 'master',
    paths: ['rosetta-source/src/main/rosetta/**/*.rosetta'],
    archiveUrl: `${MIRROR_BASE}/cdm/latest.tar.gz`,
    depends: ['fpml']
  },
  {
    id: 'fpml',
    name: 'FpML (Rune)',
    repoUrl: `${CURATED_MODEL_REPOSITORIES.fpml}.git`,
    ref: 'master',
    paths: ['rosetta-source/src/main/rosetta/**/*.rosetta'],
    archiveUrl: `${MIRROR_BASE}/fpml/latest.tar.gz`
  },
  {
    id: 'rune-dsl',
    name: 'Rune DSL (Built-in Types)',
    repoUrl: `${CURATED_MODEL_REPOSITORIES['rune-dsl']}.git`,
    ref: 'main',
    paths: ['rune-runtime/src/main/resources/model/**/*.rosetta'],
    archiveUrl: `${MIRROR_BASE}/rune-dsl/latest.tar.gz`
  }
] as const;

// Static, hardcoded curated constant — no diagnostic value in re-capturing
// an unchanging value every call.
export const getModelRegistry = withInstrumentation(
  function getModelRegistry(): readonly ModelSource[] {
    return CURATED_MODELS;
  },
  { op: 'getModelRegistry' }
);

// `id` is one of the fixed curated ids ('cdm'/'fpml'/'rune-dsl'); the
// matched ModelSource (if any) is itself curated/public data — both safe.
export const getModelSource = withInstrumentation(
  function getModelSource(id: string): ModelSource | undefined {
    return CURATED_MODELS.find((m) => m.id === id);
  },
  { op: 'getModelSource', capture: Capture.Input | Capture.Output, sanitize: (value) => value }
);

// `repoUrl` is a user-entered custom git URL — the reason hashUrl() exists
// (see telemetry-shipper.ts's safeSubject commentary for the same
// pattern) — never captured raw, nor is the derived `name` (may echo the
// repo name). Only the resulting hashed `id` is safe.
export const createCustomModelSource = withInstrumentation(
  function createCustomModelSource(
    repoUrl: string,
    ref: string = 'main',
    paths: string[] = ['**/*.rosetta']
  ): ModelSource {
    const id = `custom-${hashUrl(repoUrl)}`;
    const name = extractRepoName(repoUrl);
    return { id, name, repoUrl, ref, paths };
  },
  {
    op: 'createCustomModelSource',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? { id: (value as ModelSource).id } : undefined)
  }
);

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? url;
}
