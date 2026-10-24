// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode, type LangiumDocument } from 'langium';
import { getEffectiveProjectDeclaration, isRosettaModel } from '@rune-langium/core';
import type { ExportSelection } from '../types.js';

type TopLevel = AstNode & { name?: string; $container?: AstNode };

export interface ResolvedExportSelection {
  documents: LangiumDocument[];
  explicit: ExportSelection['declarations'];
  included: ExportSelection['declarations'];
  unknown: ExportSelection['declarations'];
  /** Namespace roots that were requested but have no workspace document. */
  unknownNamespaces: readonly string[];
  /** Each dependency key maps to the explicit roots that require it. */
  requiredBy: ReadonlyMap<string, readonly string[]>;
}

/** Stable, kind-aware identity for a selected top-level declaration. */
export function declarationKey(declaration: ExportSelection['declarations'][number]): string {
  return JSON.stringify([declaration.namespace, declaration.kind, declaration.name]);
}

/** Shared diagnostic details for stale declaration or namespace export roots. */
export function unknownExportSelectionDiagnostics(
  selection: Pick<ResolvedExportSelection, 'unknown' | 'unknownNamespaces'>
) {
  return [
    ...selection.unknown.map((item) => ({
      code: 'unknown-export-selection' as const,
      message: `Unknown ${item.kind} declaration '${item.namespace}.${item.name}'.`
    })),
    ...selection.unknownNamespaces.map((namespace) => ({
      code: 'unknown-export-selection' as const,
      message: `Unknown namespace '${namespace}'.`
    }))
  ];
}

function namespaceOf(doc: LangiumDocument): string | undefined {
  const model = doc.parseResult.value;
  return model && isRosettaModel(model) ? String(model.name).replace(/^"|"$/g, '') : undefined;
}
function rootOf(node: AstNode): TopLevel | undefined {
  let current: AstNode = node;
  while (current.$container && !isRosettaModel(current.$container)) current = current.$container;
  return current.$container && isRosettaModel(current.$container) ? (current as TopLevel) : undefined;
}

/** Direct declaration dependencies through the authoritative effective-reference port. */
export function collectDeclarationDependencies(root: AstNode): readonly AstNode[] {
  const dependencies = new Set<AstNode>();
  for (const node of [root, ...AstUtils.streamAllContents(root)]) {
    for (const { reference } of AstUtils.streamReferences(node)) {
      const candidate = reference as unknown as { ref?: AstNode; refs?: readonly AstNode[] };
      for (const target of candidate.ref ? [candidate.ref] : (candidate.refs ?? [])) {
        const original = rootOf(target);
        const effective = original ? getEffectiveProjectDeclaration(original) : undefined;
        if (effective) dependencies.add(effective);
      }
    }
  }
  return [...dependencies];
}

function declaration(namespace: string, root: TopLevel): ExportSelection['declarations'][number] {
  return { namespace, name: root.name ?? '', kind: root.$type };
}

function uniqueDeclarations(
  roots: Iterable<TopLevel>,
  key: (root: TopLevel) => ExportSelection['declarations'][number] | undefined
): ExportSelection['declarations'] {
  const declarations = new Map<string, ExportSelection['declarations'][number]>();
  for (const root of roots) {
    const value = key(root);
    if (value) declarations.set(declarationKey(value), value);
  }
  return [...declarations.values()];
}

/** Resolve selected roots and return shallow document views without mutating the linked workspace. */
export function resolveExportSelection(docs: LangiumDocument[], selection: ExportSelection): ResolvedExportSelection {
  const wanted = new Set(selection.declarations.map(declarationKey));
  const selectedNamespaces = new Set(selection.namespaces);
  const roots = new Set<TopLevel>();
  const allRoots = new Map<TopLevel, string>();
  const explicitRoots = new Set<TopLevel>();
  const found = new Set<string>();
  const foundNamespaces = new Set<string>();
  const requiredByRoot = new Map<TopLevel, Set<TopLevel>>();
  for (const doc of docs) {
    const namespace = namespaceOf(doc);
    const model = doc.parseResult.value;
    if (!namespace || !model || !isRosettaModel(model)) continue;
    foundNamespaces.add(namespace);
    for (const element of model.elements as TopLevel[]) {
      allRoots.set(element, namespace);
      if (selectedNamespaces.has(namespace) || wanted.has(declarationKey(declaration(namespace, element)))) {
        const effective = getEffectiveProjectDeclaration(element) as TopLevel | undefined;
        if (!effective) continue;
        roots.add(effective);
        explicitRoots.add(effective);
        found.add(declarationKey(declaration(namespace, element)));
        requiredByRoot.set(effective, new Set([effective]));
      }
    }
  }
  const dependencies = new Map<TopLevel, readonly AstNode[]>();
  const queue = [...roots];
  while (queue.length) {
    const root = queue.pop()!;
    const rootsRequiringCurrent = requiredByRoot.get(root) ?? new Set<TopLevel>();
    let targets = dependencies.get(root);
    if (!targets) {
      targets = collectDeclarationDependencies(root);
      dependencies.set(root, targets);
    }
    for (const target of targets) {
      const targetRoot = target as TopLevel;
      if (allRoots.has(targetRoot)) {
        roots.add(targetRoot);
        const rootsRequiringTarget = requiredByRoot.get(targetRoot) ?? new Set<TopLevel>();
        const before = rootsRequiringTarget.size;
        for (const requiringRoot of rootsRequiringCurrent) rootsRequiringTarget.add(requiringRoot);
        if (rootsRequiringTarget.size !== before) {
          requiredByRoot.set(targetRoot, rootsRequiringTarget);
          queue.push(targetRoot);
        }
      }
    }
  }

  const documents = docs.flatMap((doc) => {
    const model = doc.parseResult.value;
    if (!model || !isRosettaModel(model)) return [];
    const elements = model.elements.filter((element) => roots.has(element as TopLevel));
    if (!elements.length) return [];
    return [{ ...doc, parseResult: { ...doc.parseResult, value: { ...model, elements } } } as LangiumDocument];
  });
  const key = (root: TopLevel) => {
    const namespace = allRoots.get(root);
    return namespace ? declaration(namespace, root) : undefined;
  };
  const requiredBy = new Map<string, readonly string[]>();
  for (const root of roots) {
    if (explicitRoots.has(root)) continue;
    const dependency = key(root);
    const requiringRoots = requiredByRoot.get(root);
    if (!dependency || !requiringRoots?.size) continue;
    requiredBy.set(
      declarationKey(dependency),
      [...requiringRoots].flatMap((requiringRoot) => {
        const requiring = key(requiringRoot);
        return requiring ? [declarationKey(requiring)] : [];
      })
    );
  }
  return {
    documents,
    explicit: uniqueDeclarations(explicitRoots, key),
    included: uniqueDeclarations(roots, key),
    unknown: selection.declarations.filter((item) => !found.has(declarationKey(item))),
    unknownNamespaces: selection.namespaces.filter((namespace) => !foundNamespaces.has(namespace)),
    requiredBy
  };
}

/** Return shallow document views whose models expose only selected closure roots. */
export function selectDeclarationDocuments(docs: LangiumDocument[], selection: ExportSelection): LangiumDocument[] {
  return resolveExportSelection(docs, selection).documents;
}

/** Resolve a kind-qualified authored target through core's linked project identity. */
export function resolveEffectiveProjectTargetId(
  docs: readonly LangiumDocument[],
  targetId: string,
  kind: string
): string {
  for (const document of docs) {
    const model = document.parseResult.value;
    const namespace = namespaceOf(document);
    if (!isRosettaModel(model) || !namespace) continue;
    const node = model.elements.find(
      (node) => node.$type === kind && 'name' in node && `${namespace}.${node.name}` === targetId
    );
    if (!node) continue;
    const effective = getEffectiveProjectDeclaration(node) as TopLevel | undefined;
    if (!effective) throw new Error(`Project replacement for ${kind} '${targetId}' is unavailable.`);
    const owner = effective.$container;
    return owner && isRosettaModel(owner) ? `${String(owner.name).replace(/^"|"$/g, '')}.${effective.name}` : targetId;
  }
  return targetId;
}

/** Reuse the selection view for active project roots; linked originals remain available for inspection. */
export function selectEffectiveProjectDocuments(docs: LangiumDocument[]): LangiumDocument[] {
  const namespaces = new Set<string>();
  let redirected = false;
  for (const doc of docs) {
    const namespace = namespaceOf(doc);
    const model = doc.parseResult.value;
    if (namespace) namespaces.add(namespace);
    if (isRosettaModel(model) && model.elements.some((node) => getEffectiveProjectDeclaration(node) !== node))
      redirected = true;
  }
  return redirected ? resolveExportSelection(docs, { namespaces: [...namespaces], declarations: [] }).documents : docs;
}
