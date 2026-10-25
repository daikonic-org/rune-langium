// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { declarationKey, getNodeSourceRegion, namespaceFromModelName } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';
import { validateIdentifier } from '@rune-langium/visual-editor';
import { splitNodeId, kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import { loadCuratedNamespaceSource, type WorkspaceFile, type ParsedWorkspaceModel } from './workspace.js';
import { resolveEditorFilePath } from '../shell/explore-file-nav-store.js';

import {
  prepareBuildConfigSave,
  projectFileRevision,
  projectSourcePaths,
  type ProjectSnapshot,
  type ProjectWrite,
  type SymbolIdentity
} from '@rune-langium/project-config';
import {
  createProjectReceipt,
  projectReceiptMatches,
  type EffectiveProjectReceipt
} from '@rune-langium/project-runtime/receipt';
import type { ReferenceDocument } from '@rune-langium/project-runtime/references';
import type { ProjectController } from '../workspace/project-controller.js';

export type LocalDeclarationMode = 'extend' | 'modify';
export interface LocalDeclarationRequest {
  signal?: AbortSignal;
  projectReceipt?: EffectiveProjectReceipt;
  projectReferenceDocuments?: readonly ReferenceDocument[];
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
    const targetKind =
      mode === 'extend' ? EXTENSION_PARENT[origin.kind as keyof typeof EXTENSION_PARENT][0] : origin.kind;
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
  // Parser and editor identities can name the same immutable document.
  const distinct = new Map<string, (typeof groups)[number]>();
  for (const group of groups) {
    const path = resolveEditorFilePath(group.entry.filePath, request.files) ?? group.entry.filePath;
    if (!distinct.has(path)) distinct.set(path, { ...group, entry: { ...group.entry, filePath: path } });
  }
  // Open the base declaration first; variants retain their original file-local imports.
  return [...distinct.values()].sort(
    (a, b) =>
      Number(a.nodes.every((node) => node.$type === 'RosettaFunction' && node.dispatchAttribute)) -
      Number(b.nodes.every((node) => node.$type === 'RosettaFunction' && node.dispatchAttribute))
  );
}

function projectDeclarationOrigin(request: LocalDeclarationRequest) {
  const origin = { ...splitNodeId(request.nodeId), kind: kindFromNodeId(request.nodeId) };
  const originFiles = declarationGroups(request).map((group) =>
    request.files.find((file) => file.path === resolveEditorFilePath(group.entry.filePath, request.files))
  );
  const owners = new Set(originFiles.map((file) => file?.bundleId));
  const owner = owners.size === 1 ? [...owners][0] : undefined;
  const source = { model: owner ?? '', namespace: origin.namespace, name: origin.name, kind: origin.kind ?? '' };
  return { originFiles, owner, source };
}
function declarationOverrides(snapshot: ProjectSnapshot, source: SymbolIdentity) {
  return (snapshot.project.build.overrides ?? []).filter(
    (mapping) => mapping.kind === 'declaration' && declarationKey(mapping.source) === declarationKey(source)
  );
}
/** Navigation follows the saved explicit identity, including an already-existing replacement. */
export const projectDeclarationDestination = withInstrumentation(
  function projectDeclarationDestination(snapshot: ProjectSnapshot, request: LocalDeclarationRequest): SymbolIdentity {
    const { source } = projectDeclarationOrigin(request);
    if (request.mode === 'modify') {
      const existing = declarationOverrides(snapshot, source);
      if (existing.length !== 1 || existing[0]!.kind !== 'declaration')
        throw new Error('The saved declaration replacement is missing or ambiguous.');
      return existing[0]!.replacement;
    }
    return {
      model: 'local',
      namespace: request.namespace,
      kind: EXTENSION_PARENT[source.kind as keyof typeof EXTENSION_PARENT][0],
      name: request.name
    };
  },
  { op: 'projectDeclarationDestination', capture: 0 }
);

/** Create source, never write it: the caller owns the workspace epoch and persistence. */
async function prepareDeclaration(request: LocalDeclarationRequest, sourceUris: string[]): Promise<WorkspaceFile[]> {
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
      if (!file?.refOnly || !file.bundleId)
        throw new Error('The pinned curated source for this declaration is not available.');
      const verified =
        request.projectReceipt &&
        request.projectReferenceDocuments?.find((document) => resolveEditorFilePath(document.uri, files) === path);
      if (request.projectReceipt && (!verified || (file.sourceLoaded && file.content !== verified.content)))
        throw new Error(
          'This declaration does not match the locked reference release. Reload that release before modifying it.'
        );
      let source = verified ? verified.content : file.content;
      if (!verified && (!file.bundleVersion || !file.artifactKey))
        throw new Error('The pinned curated source for this declaration is not available.');
      if (!verified && (!file.sourceLoaded || !source)) {
        let load = sourceLoads.get(file.artifactKey!);
        if (!load) {
          load = loadCuratedNamespaceSource(file.bundleId, file.bundleVersion!, origin.namespace, file.artifactKey!);
          sourceLoads.set(file.artifactKey!, load);
        }
        const loaded = await load;
        if (loaded.artifactKey !== file.artifactKey)
          throw new Error('Curated source changed. Reload the model and retry.');
        const document = loaded.documents.find((doc) => resolveEditorFilePath(doc.uri, files) === path);
        if (!document) throw new Error('The original source document is missing from this curated version.');
        source = document.content;
      }
      if (request.projectReferenceDocuments) {
        const pinned =
          verified ||
          request.projectReferenceDocuments.find(
            (document) => document.uri.startsWith(file.bundleId + '/') && document.content === source
          );
        if (!pinned)
          throw new Error(
            'This declaration does not match the locked reference release. Reload that release before modifying it.'
          );
        sourceUris.push(pinned.uri);
      }
      const slice = (part: Parameters<typeof getNodeSourceRegion>[0]) => {
        const { from, to } = getNodeSourceRegion(part);
        if (to > source.length || to <= from) throw new Error('Curated source does not match its declaration ranges.');
        return source.slice(from, to);
      };
      const imports = new Set([`import ${origin.namespace}.*`, ...entry.model.imports.map(slice)]);
      // A separate local file per original file preserves alias and import precedence.
      const content = `${renderModel({ name: namespace, version: entry.model.version, elements: [] }).trimEnd()}\n\n${[...imports].join('\n')}\n\n${nodes.map(slice).join('\n\n')}\n`;
      copies.push(makeFile(content, index));
    }
    return copies;
  }
}
export const prepareLocalDeclaration = withInstrumentation(
  async function prepareLocalDeclaration(request: LocalDeclarationRequest): Promise<WorkspaceFile[]> {
    return prepareDeclaration(request, []);
  },
  { op: 'prepareLocalDeclaration', capture: 0, sanitizeError: () => ({ signature: 'local-declaration-error' }) }
);

/** Save a logical copy and its explicit map together; commit/push remain separate actions. */
export const modifyProjectDeclaration = withInstrumentation(
  async function modifyProjectDeclaration(
    request: LocalDeclarationRequest,
    controller: ProjectController
  ): Promise<ProjectSnapshot> {
    request.signal?.throwIfAborted();
    const original = controller.current();
    if (!original || !projectReceiptMatches(await createProjectReceipt(original), request.projectReceipt))
      throw new Error(
        'Project resolution is stale or not ready. Wait for the current project before creating a declaration.'
      );
    const assertCurrent = () => {
      request.signal?.throwIfAborted();
      const current = controller.current();
      if (current?.workspaceId !== original.workspaceId || current.revision !== original.revision)
        throw new Error('Project changed while preparing the local declaration.');
    };
    const { owner, source } = projectDeclarationOrigin(request);
    if (request.mode === 'modify') {
      if (!owner || !original.lock?.references[owner])
        throw new Error('Select and resolve the original reference model release before modifying it.');
      const existing = declarationOverrides(original, source);
      if (existing?.length) {
        if (existing.length !== 1 || existing[0]!.kind !== 'declaration')
          throw new Error('The original declaration has ambiguous replacements.');
        assertCurrent();
        return original;
      }
    }
    if (request.mode === 'modify' && !request.projectReferenceDocuments)
      throw new Error('The locked reference release has not been verified for this copy.');
    const sourceUris: string[] = [];
    const copies = await prepareDeclaration(request, sourceUris);
    assertCurrent();
    const build = structuredClone(original.project.build);
    const writes: ProjectWrite[] = [];
    for (const copy of copies) {
      const path = localProjectSourcePath(original, copy.path);
      if (
        [...original.files.keys(), ...writes.map((write) => write.path)].some(
          (existing) => existing.toLowerCase() === path.toLowerCase()
        )
      )
        throw new Error('That local declaration file already exists.');
      writes.push({ path, text: copy.content, expectedRevision: null });
    }
    if (request.mode === 'modify') {
      const locked = original.lock!.references[owner!]!;
      build.overrides = [
        ...(build.overrides ?? []),
        {
          kind: 'declaration',
          source,
          replacement: { model: 'local', namespace: request.namespace, kind: source.kind, name: request.name },
          provenance: { uri: sourceUris[0]!, commit: locked.commit, cohort: locked.cohort }
        }
      ];
      const revisions = new Map<string, string>();
      for (const [path, text] of original.files)
        if (path === 'build-config.yml' || path === 'build-config.yaml')
          revisions.set(path, await projectFileRevision(text));
      const model = original.project.rune.model as { name?: unknown } | undefined;
      const prepared = prepareBuildConfigSave({
        files: original.files,
        revisions,
        build,
        modelName: typeof model?.name === 'string' ? model.name : 'Workspace'
      });
      if (prepared.diagnostics.length) throw new Error(prepared.diagnostics.map((issue) => issue.message).join('\n'));
      writes.push(...prepared.writes);
    }
    assertCurrent();
    return controller.save(writes);
  },
  { op: 'modifyProjectDeclaration', capture: 0, sanitizeError: () => ({ signature: 'local-declaration-error' }) }
);

function localProjectSourcePath(snapshot: ProjectSnapshot, relative: string): string {
  const directories = snapshot.project.build.sources.map((pattern) => {
    const literal = pattern
      .split('/')
      .filter((_, index, parts) => parts.slice(0, index + 1).every((part) => !/[*?{[]/.test(part)));
    if (literal[literal.length - 1]?.endsWith('.rosetta')) literal.pop();
    return literal.join('/');
  });
  directories.push(
    ...projectSourcePaths(snapshot.files, snapshot.project.build.sources).map((path) =>
      path.split('/').slice(0, -1).join('/')
    )
  );
  const candidates = [
    relative,
    ...directories.flatMap((directory) =>
      [relative, relative.split('/').slice(-1)[0]!].map((path) => (directory ? directory + '/' + path : path))
    )
  ];
  const path = candidates.find(
    (path) => projectSourcePaths(new Map([[path, '']]), snapshot.project.build.sources).length > 0
  );
  if (!path)
    throw new Error(
      'The configured source patterns have no destination for this declaration. Choose a source folder in build-config first.'
    );
  return path;
}
