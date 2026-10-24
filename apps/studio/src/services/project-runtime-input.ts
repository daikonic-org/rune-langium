// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { URI } from 'langium';
import { createProjectDraftSnapshot, projectSourcePaths, type ProjectSnapshot } from '@rune-langium/project-config';
import {
  createProjectResolutionContext,
  projectSourceUri,
  projectReferenceUri
} from '@rune-langium/project-runtime/context';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import type { ReferenceDocument } from '@rune-langium/project-runtime/references';
import type { WorkspaceFile } from './workspace.js';
import { withInstrumentation } from './instrumentation/core.js';
/** One writable-source selection for capture identity and draft overlays. */
export const projectRuntimeSources = withInstrumentation(
  function projectRuntimeSources(files: readonly WorkspaceFile[]) {
    return new Map(
      files
        .filter((file) => !file.readOnly && !file.refOnly && file.path.endsWith('.rosetta'))
        .map((file) => [file.path, file.content])
    );
  },
  { op: 'projectRuntimeSources', capture: 0 }
);
/** Capture editor text and document ownership; parsing remains in the existing language/preview hosts. */
export const captureProjectRuntimeInput = withInstrumentation(
  async function captureProjectRuntimeInput(
    saved: ProjectSnapshot,
    files: readonly WorkspaceFile[],
    referenceDocuments: readonly ReferenceDocument[]
  ) {
    const local = projectRuntimeSources(files);
    const edits = new Map<string, string | null>();
    for (const path of projectSourcePaths(saved.files, saved.project.build.sources))
      if (!local.has(path)) edits.set(path, null);
    for (const [path, text] of local) if (saved.files.get(path) !== text) edits.set(path, text);
    const snapshot = await createProjectDraftSnapshot(saved, edits, validateProjectTarget);
    const models = Object.fromEntries([
      ...projectSourcePaths(snapshot.files, snapshot.project.build.sources).map((path) => [
        URI.parse(projectSourceUri(path)).toString(),
        'local'
      ]),
      ...referenceDocuments.map((document) => [
        URI.parse(projectReferenceUri(document.uri)).toString(),
        document.uri.split('/')[0]!
      ])
    ]);
    const resolution = await createProjectResolutionContext(snapshot, models);
    return { snapshot, referenceDocuments, resolution, receipt: resolution.receipt };
  },
  { op: 'captureProjectRuntimeInput', capture: 0 }
);
export type ProjectRuntimeInput = Awaited<ReturnType<typeof captureProjectRuntimeInput>>;
