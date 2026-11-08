// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createCuratedRuneProject } from './curated-rune-project.js';
import { frequencyCaller, frequencyDirectory } from './cdm-frequency.js';

/** Publish, checksum-verify and install both library and adapter through the ordinary contracts. */
export async function createCuratedFrequencyProject() {
  return createCuratedRuneProject(frequencyDirectory, frequencyCaller);
}
