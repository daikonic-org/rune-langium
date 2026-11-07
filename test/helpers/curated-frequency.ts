// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createProjectDraftSnapshot } from '../../packages/project-config/src/index.js';
import {
  resolveProjectReferences,
  createMemoryReferenceCache,
  loadLockedReferences
} from '../../packages/project-runtime/src/references/index.js';
import { prepareCuratedImplementationSources } from '../../packages/project-runtime/src/curated-implementations/install.js';
import { referenceModelSources } from '../../packages/codegen/test/helpers/cdm-reference.js';
import { createReferenceArtifacts } from './project-reference-artifacts.js';
import { frequencyCaller, frequencyDirectory } from './cdm-frequency.js';

/** Publish, checksum-verify and install both library and adapter through the ordinary contracts. */
export async function createCuratedFrequencyProject() {
  const fixture = await createReferenceArtifacts(
    undefined,
    undefined,
    referenceModelSources(frequencyDirectory),
    'https://www.daikonic.dev/curated',
    true
  );
  const cache = createMemoryReferenceCache();
  const signal = new AbortController().signal;
  const resolved = await resolveProjectReferences(fixture.snapshot, fixture.transport, signal, cache);
  if (!resolved.lock || resolved.diagnostics.length)
    throw new Error('Frequency fixture resolution failed: ' + JSON.stringify(resolved.diagnostics));
  const loaded = await loadLockedReferences(resolved.lock, fixture.transport, cache, signal);
  if (loaded.diagnostics.length) throw new Error(JSON.stringify(loaded.diagnostics));
  const snapshot = await createProjectDraftSnapshot(
    fixture.snapshot,
    new Map([
      ['build-config.lock.json', JSON.stringify(resolved.lock)],
      ['model/frequency-caller.rosetta', frequencyCaller.content]
    ]),
    () => []
  );
  const prepared = await prepareCuratedImplementationSources(snapshot, loaded.documents);
  if (prepared.diagnostics.length) throw new Error(JSON.stringify(prepared.diagnostics));
  const installed = await createProjectDraftSnapshot(snapshot, prepared.changes, () => []);
  return { fixture, references: loaded.documents, snapshot, installed, changes: prepared.changes };
}
