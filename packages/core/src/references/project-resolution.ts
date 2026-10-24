// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  AstUtils,
  type AstNode,
  type AstNodeDescription,
  type LangiumCoreServices,
  type Scope,
  type URI
} from 'langium';
import { isRosettaFunction, isRosettaModel } from '../generated/ast.js';
import { namespaceFromModelName } from '../naming/namespace.js';

import { declarationKey, type DeclarationIdentity } from './project-contract.js';
export * from './project-contract.js';
export interface DeclarationRedirects {
  resolve(identity: DeclarationIdentity): DeclarationIdentity;
}
/** Selector text is stable before linking; resolving it here would recursively enter scope construction. */
export function declarationDispatch(node: AstNode): string | undefined {
  if (!isRosettaFunction(node) || !node.dispatchAttribute) return undefined;
  return JSON.stringify([
    node.dispatchAttribute.$refText,
    node.dispatchValue?.enumeration.$refText,
    node.dispatchValue?.value.$refText
  ]);
}
interface ResolutionState {
  models: Map<string, string>;
  redirects?: DeclarationRedirects;
  nodes?: Map<string, AstNode | undefined>;
  identities?: WeakMap<AstNode, DeclarationIdentity>;
}
const projects = new WeakMap<object, ResolutionState>();
const effectiveDeclarations = new WeakMap<AstNode, { target: AstNode | undefined }>();
function state(services: LangiumCoreServices): ResolutionState {
  let value = projects.get(services.shared);
  if (!value) {
    value = { models: new Map() };
    projects.set(services.shared, value);
  }
  return value;
}
/** Hosts explicitly assign document ownership; core does not infer model identity from names or namespaces. */
export function setProjectDocumentModel(services: LangiumCoreServices, uri: URI, model: string): void {
  const value = state(services);
  value.models.set(uri.toString(), model);
  value.nodes = undefined;
  value.identities = undefined;
}
export function setProjectRedirects(services: LangiumCoreServices, redirects: DeclarationRedirects | undefined): void {
  state(services).redirects = redirects;
  invalidateProjectResolution(services);
}
/** A host must invalidate identity indexes whenever it replaces document roots. */
export function invalidateProjectResolution(services: LangiumCoreServices): void {
  const value = projects.get(services.shared);
  if (value) {
    value.nodes = undefined;
    value.identities = undefined;
  }
}
export function clearProjectResolution(services: LangiumCoreServices): void {
  projects.delete(services.shared);
}
export function hasProjectRedirects(services: LangiumCoreServices): boolean {
  return Boolean(projects.get(services.shared)?.redirects);
}
function index(services: LangiumCoreServices): ResolutionState {
  const value = state(services);
  if (value.nodes) return value;
  value.nodes = new Map();
  value.identities = new WeakMap();
  const owned: Array<[AstNode, DeclarationIdentity]> = [];
  for (const document of services.shared.workspace.LangiumDocuments.all) {
    const root = document.parseResult.value;
    const model = value.models.get(document.uri.toString());
    if (!model || !isRosettaModel(root)) continue;
    for (const node of root.elements) {
      if (!('name' in node) || typeof node.name !== 'string') continue;
      const identity = {
        model,
        namespace: namespaceFromModelName(root.name) ?? '',
        kind: node.$type,
        name: node.name,
        ...(declarationDispatch(node) ? { dispatch: declarationDispatch(node) } : {})
      };
      value.identities.set(node, identity);
      owned.push([node, identity]);
      const key = declarationKey(identity);
      value.nodes.set(key, value.nodes.has(key) ? undefined : node);
    }
  }
  for (const [node, identity] of owned) {
    if (!value.redirects) {
      effectiveDeclarations.delete(node);
      continue;
    }
    const resolved = value.redirects.resolve(identity);
    effectiveDeclarations.set(node, {
      target: declarationKey(resolved) === declarationKey(identity) ? node : value.nodes.get(declarationKey(resolved))
    });
  }
  return value;
}
/** All consumers select through the same generation-local declaration targets as core linking. */
export function getEffectiveProjectDeclaration(node: AstNode): AstNode | undefined {
  const entry = effectiveDeclarations.get(node);
  return entry ? entry.target : node;
}
export function projectDeclarationIdentity(
  services: LangiumCoreServices,
  node: AstNode
): DeclarationIdentity | undefined {
  const known = index(services).identities!.get(node);
  if (known) return known;
  if (!('name' in node) || typeof node.name !== 'string' || !isRosettaModel(node.$container)) return undefined;
  return {
    model: 'stdlib',
    namespace: namespaceFromModelName(node.$container.name) ?? '',
    kind: node.$type,
    name: node.name
  };
}
/** A missing replacement stays unresolved; it must never fall back to the immutable original. */
export function redirectProjectNode(services: LangiumCoreServices, node: AstNode): AstNode | undefined {
  const value = projects.get(services.shared);
  if (!value?.redirects) return node;
  index(services);
  return getEffectiveProjectDeclaration(node);
}
/** Keep authored lookup names while navigation and linking descriptions point at the effective declaration. */
export function redirectProjectScope(services: LangiumCoreServices, scope: Scope): Scope {
  if (!hasProjectRedirects(services)) return scope;
  const map = (description: AstNodeDescription | undefined): AstNodeDescription | undefined => {
    if (!description) return undefined;
    const root = services.shared.workspace.LangiumDocuments.getDocument(description.documentUri)?.parseResult.value;
    const node =
      description.node ?? (root ? services.workspace.AstNodeLocator.getAstNode(root, description.path) : undefined);
    if (!node) return description;
    const target = redirectProjectNode(services, node);
    if (!target) return undefined;
    return target === node
      ? description
      : services.workspace.AstNodeDescriptionProvider.createDescription(
          target,
          description.name,
          AstUtils.getDocument(target)
        );
  };
  return {
    getElement: (name) => map(scope.getElement(name)),
    getElements: (name) =>
      scope
        .getElements(name)
        .map(map)
        .filter((value): value is AstNodeDescription => Boolean(value)),
    getAllElements: () =>
      scope
        .getAllElements()
        .map(map)
        .filter((value): value is AstNodeDescription => Boolean(value))
  };
}
