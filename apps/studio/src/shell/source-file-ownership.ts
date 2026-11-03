// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { getModelSourceUri, namespaceFromModelName } from '@rune-langium/core';
import type { ParsedWorkspaceModel, WorkspaceFile } from '../services/workspace.js';
import { pathToUri } from '../utils/uri.js';
import { resolveEditorFilePath } from './explore-file-nav-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Parsed roots own their editor paths; declaration names and basenames cannot identify files. */
export const buildSourceFileOwnership = withInstrumentation(
  function buildSourceFileOwnership(models: readonly ParsedWorkspaceModel[], files: readonly WorkspaceFile[]) {
    const byUri = new Map<string, string | undefined>();
    const namespaceByFile = new Map<string, string>();
    const add = (uri: string, path: string) => {
      if (!byUri.has(uri)) byUri.set(uri, path);
      else if (byUri.get(uri) !== path) byUri.set(uri, undefined);
    };
    for (const file of files) add(pathToUri(file.path), file.path);
    for (const { model, filePath } of models) {
      const path = resolveEditorFilePath(filePath, files);
      if (!path) continue;
      const namespace = namespaceFromModelName(model.name);
      if (namespace) namespaceByFile.set(path, namespace);
      const uri = getModelSourceUri(model);
      if (uri) add(uri, path);
    }
    const urisByFile = new Map<string, Set<string>>();
    for (const [uri, path] of byUri) {
      if (!path) continue;
      const uris = urisByFile.get(path) ?? new Set<string>();
      uris.add(uri);
      urisByFile.set(path, uris);
    }
    return { byUri, namespaceByFile, urisByFile };
  },
  { op: 'buildSourceFileOwnership', capture: 0 }
);
