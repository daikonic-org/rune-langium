// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
/** Default public mirror; hosts may inject a different endpoint and fetch policy. */
export const CURATED_MIRROR_BASE = 'https://www.daikonic.dev/curated';

/** Canonical upstream identities for the current curated Nightly mirrors. */
export const CURATED_MODEL_REPOSITORIES = {
  cdm: 'https://github.com/finos/common-domain-model',
  fpml: 'https://github.com/rosetta-models/rune-fpml',
  'rune-dsl': 'https://github.com/finos/rune-dsl'
} as const;
