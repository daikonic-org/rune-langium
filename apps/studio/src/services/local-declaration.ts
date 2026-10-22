// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { getNodeSourceRegion, namespaceFromModelName } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';
import { validateIdentifier } from '@rune-langium/visual-editor';
import { splitNodeId, kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import { loadCuratedNamespaceSource, type WorkspaceFile, type ParsedWorkspaceModel } from './workspace.js';
import { resolveEditorFilePath } from '../shell/explore-file-nav-store.js';

export type LocalDeclarationMode = 'extend' | 'modify';
export interface LocalDeclarationRequest {
  mode: LocalDeclarationMode;
  nodeId: string;
  namespace: string;
  name: string;
  files: readonly WorkspaceFile[];
  models: readonly ParsedWorkspaceModel[];
}

const EXTENSION_PARENT = {
  Data: ['Data', 'superType'],
  Choice: ['Data', 'superType'],
  RosettaEnumeration: ['RosettaEnumeration', 'parent'],
  RosettaFunction: ['RosettaFunction', 'superFunction']
} as const;

export const canExtendDeclaration = withInstrumentation(
  function canExtendDeclaration(kind: string): boolean {
    return Object.prototype.hasOwnProperty.call(EXTENSION_PARENT, kind);
  },
  { op: 'canExtendDeclaration', capture: 0 }
);

/** Validate identities before any network read or workspace mutation. */
export const localDeclarationError = withInstrumentation(
  function localDeclarationError(request: LocalDeclarationRequest): string | undefined {
    const { namespace, name, mode, nodeId, files, models } = request;
    const origin = { ...splitNodeId(nodeId), kind: kindFromNodeId(nodeId) };
    const identifierError = validateIdentifier(name);
    if (identifierError) return identifierError;
    if (namespace.split('.').some((part) => validateIdentifier(part))) return 'Enter a valid local namespace.';
    if (!origin.kind || !origin.namespace) return 'The original declaration is not available yet.';
    if (mode === 'extend' && !canExtendDeclaration(origin.kind)) return 'This declaration cannot be extended.';
    if (mode === 'modify' && name !== origin.name) return 'A local copy retains the original declaration name.';
    if (files.some((file) => (file.refOnly || file.readOnly) && file.namespace === namespace))
      return 'Choose a local namespace, separate from the curated model.';
    if (mode === 'modify' && namespace === origin.namespace)
      return 'Choose a local namespace, separate from the curated model.';
    const targetKind = mode === 'extend' && origin.kind === 'Choice' ? 'Data' : origin.kind;
    if (
      models.some(
        ({ model }) =>
          namespaceFromModelName(model.name) === namespace &&
          model.elements.some((node) => 'name' in node && node.name === name && node.$type === targetKind)
      )
    )
      return 'A declaration with this name and kind already exists in that namespace.';
    if (
      Array.from({ length: mode === 'modify' ? Math.max(1, declarationGroups(request).length) : 1 }, (_, index) =>
        declarationPath(namespace, name, index).toLowerCase()
      ).some((path) => files.some((file) => file.path.toLowerCase() === path))
    )
      return 'That workspace file already exists. Choose another namespace or name.';
    return undefined;
  },
  { op: 'localDeclarationError', capture: 0 }
);

function declarationPath(namespace: string, name: string, index = 0): string {
  return `${namespace.split('.').join('/')}/${name}${index ? `.dispatch-${index}` : ''}.rosetta`;
}

function declarationGroups(request: LocalDeclarationRequest) {
  const origin = { ...splitNodeId(request.nodeId), kind: kindFromNodeId(request.nodeId) };
  const groups = request.models.flatMap((entry) => {
    if (namespaceFromModelName(entry.model.name) !== origin.namespace) return [];
    const nodes = entry.model.elements.filter(
      (node) => 'name' in node && node.name === origin.name && node.$type === origin.kind
    );
    return nodes.length ? [{ entry, nodes }] : [];
  });
  // Open the base declaration first; variants retain their original file-local imports.
  return groups.sort(
    (a, b) =>
      Number(a.nodes.every((node) => node.$type === 'RosettaFunction' && node.dispatchAttribute)) -
      Number(b.nodes.every((node) => node.$type === 'RosettaFunction' && node.dispatchAttribute))
  );
}

/** Create source, never write it: the caller owns the workspace epoch and persistence. */
export const prepareLocalDeclaration = withInstrumentation(
  async function prepareLocalDeclaration(request: LocalDeclarationRequest): Promise<WorkspaceFile[]> {
    const error = localDeclarationError(request);
    if (error) throw new Error(error);
    const { namespace, name, mode, files, nodeId } = request;
    const origin = { ...splitNodeId(nodeId), kind: kindFromNodeId(nodeId) };
    const makeFile = (content: string, index = 0): WorkspaceFile => {
      const path = declarationPath(namespace, name, index);
      return { name: path.split('/').pop()!, path, namespace, content, dirty: true };
    };
    if (mode === 'extend') {
      const [kind, parent] = EXTENSION_PARENT[origin.kind as keyof typeof EXTENSION_PARENT];
      return [
        makeFile(
          renderModel({
            name: namespace,
            elements: [
              {
                $type: kind,
                name,
                [parent]: { $refText: `${origin.namespace}.${origin.name}` }
              }
            ]
          })
        )
      ];
    } else {
      // Retain every member of a dispatch group, including variants in other files.
      const groups = declarationGroups(request);
      if (!groups.length) throw new Error('Wait for the declaration to finish loading, then try again.');
      const copies: WorkspaceFile[] = [];
      const sourceLoads = new Map<string, ReturnType<typeof loadCuratedNamespaceSource>>();
      for (const [index, { entry, nodes }] of groups.entries()) {
        const path = resolveEditorFilePath(entry.filePath, files);
        const file = files.find((candidate) => candidate.path === path);
        if (!file?.refOnly || !file.bundleId || !file.bundleVersion || !file.artifactKey)
          throw new Error('The pinned curated source for this declaration is not available.');
        let source = file.content;
        if (!file.sourceLoaded || !source) {
          let load = sourceLoads.get(file.artifactKey);
          if (!load) {
            load = loadCuratedNamespaceSource(file.bundleId, file.bundleVersion, origin.namespace, file.artifactKey);
            sourceLoads.set(file.artifactKey, load);
          }
          const loaded = await load;
          if (loaded.artifactKey !== file.artifactKey)
            throw new Error('Curated source changed. Reload the model and retry.');
          const document = loaded.documents.find((doc) => resolveEditorFilePath(doc.uri, files) === path);
          if (!document) throw new Error('The original source document is missing from this curated version.');
          source = document.content;
        }
        const slice = (part: Parameters<typeof getNodeSourceRegion>[0]) => {
          const { from, to } = getNodeSourceRegion(part);
          if (to > source.length || to <= from)
            throw new Error('Curated source does not match its declaration ranges.');
          return source.slice(from, to);
        };
        const imports = new Set([`import ${origin.namespace}.*`, ...entry.model.imports.map(slice)]);
        // A separate local file per original file preserves alias and import precedence.
        const content = `${renderModel({ name: namespace, version: entry.model.version, elements: [] }).trimEnd()}\n\n${[...imports].join('\n')}\n\n${nodes.map(slice).join('\n\n')}\n`;
        copies.push(makeFile(content, index));
      }
      return copies;
    }
  },
  { op: 'prepareLocalDeclaration', capture: 0, sanitizeError: () => ({ signature: 'local-declaration-error' }) }
);
