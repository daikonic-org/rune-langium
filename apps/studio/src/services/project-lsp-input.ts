// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { projectSourcePaths } from '@rune-langium/project-config';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import type { ParsedWorkspaceModel, WorkspaceFile } from './workspace.js';
import { collectLspWorkspaceModels, type LspModelCacheEntry } from './lsp-workspace-models.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Reuse parser snapshots only when they describe the exact captured editor text. */
export const collectProjectLspInput = withInstrumentation(
  function collectProjectLspInput(
    input: ProjectRuntimeInput,
    parsedModels: ParsedWorkspaceModel[],
    cache: Map<string, LspModelCacheEntry>,
    activeFile?: string
  ) {
    const parsed = new Map(parsedModels.map((model) => [model.filePath, model]));
    const files: WorkspaceFile[] = projectSourcePaths(input.snapshot.files, input.snapshot.project.build.sources).map(
      (path) => {
        const content = input.snapshot.files.get(path)!;
        const model = parsed.get(path);
        if (!model?.serializedModelJson || model.source !== content)
          throw new Error(`Waiting for the parser snapshot of the current source: ${path}`);
        return { path, name: path.slice(path.lastIndexOf('/') + 1), content, dirty: false };
      }
    );
    for (const document of input.referenceDocuments) {
      if (!document.serialized) throw new Error(`The locked semantic document is unavailable: ${document.uri}`);
      files.push({
        path: projectReferenceUri(document.uri),
        name: document.uri,
        content: '',
        serializedModelJson: document.serialized,
        readOnly: true,
        refOnly: true,
        dirty: false
      });
    }
    const roots = (input.snapshot.project.build.overrides ?? []).flatMap((mapping) =>
      mapping.kind === 'declaration' ? [mapping.source.namespace, mapping.replacement.namespace] : []
    );
    return {
      models: collectLspWorkspaceModels(files, parsedModels, cache, activeFile, roots),
      resolution: input.resolution
    };
  },
  { op: 'collectProjectLspInput', capture: 0 }
);
