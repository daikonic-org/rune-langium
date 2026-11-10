// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  AstUtils,
  DocumentState,
  type AstNode,
  type AstNodeDescription,
  type LangiumCoreServices,
  type Scope,
  type URI
} from 'langium';
import { isRosettaFunction, isRosettaModel, type RosettaModel } from '../generated/ast.js';
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
  namespaceOverrides?: boolean;
  namespaceTargets?: ReadonlyMap<AstNode, AstNode | undefined>;
  diagnostics?: Array<{ node: AstNode; code: string; message: string }>;
}
const projects = new WeakMap<object, ResolutionState>();
const observedBuilders = new WeakSet<object>();
const effectiveDeclarations = new WeakMap<AstNode, { target: AstNode | undefined }>();
function state(services: LangiumCoreServices): ResolutionState {
  let value = projects.get(services.shared);
  if (!value) {
    value = { models: new Map() };
    projects.set(services.shared, value);
  }
  if (!observedBuilders.has(services.shared)) {
    observedBuilders.add(services.shared);
    const builder = services.shared.workspace.DocumentBuilder;
    builder.onUpdate(() => invalidateProjectResolution(services));
    builder.onBuildPhase(DocumentState.IndexedContent, () => invalidateProjectResolution(services));
  }
  return value;
}
/** Hosts explicitly assign document ownership; core does not infer model identity from names or namespaces. */
export function setProjectDocumentModel(services: LangiumCoreServices, uri: URI, model: string): void {
  const value = state(services);
  value.models.set(uri.toString(), model);
  invalidateProjectResolution(services);
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
    value.namespaceOverrides = undefined;
    value.namespaceTargets = undefined;
    value.diagnostics = undefined;
  }
}
export function clearProjectResolution(services: LangiumCoreServices): void {
  projects.delete(services.shared);
}
export function hasProjectRedirects(services: LangiumCoreServices): boolean {
  const value = state(services);
  value.namespaceOverrides ??= services.shared.workspace.LangiumDocuments.all.some(
    (document) => isRosettaModel(document.parseResult.value) && document.parseResult.value.overridden
  );
  return Boolean(value.redirects || value.namespaceOverrides);
}
/** The language marker selects matching declarations, not an entire namespace's contents. */
type NamespaceModel = Pick<RosettaModel, 'name' | 'elements'> & Partial<Pick<RosettaModel, 'overridden'>>;
function namespaceKey(node: AstNode, root: NamespaceModel, dispatch = true): string {
  return declarationKey({
    model: 'namespace',
    namespace: namespaceFromModelName(root.name) ?? '',
    kind: node.$type,
    name: String((node as AstNode & { name: string }).name),
    ...(dispatch && declarationDispatch(node) ? { dispatch: declarationDispatch(node) } : {})
  });
}
/** Shared source-facing overlay for linked graphs and structurally serialized editor models. */
export function resolveNamespaceOverrides(models: readonly NamespaceModel[]) {
  const targets = new Map<AstNode, AstNode | undefined>();
  const diagnostics: Array<{ node: AstNode; model: NamespaceModel; code: string; message: string }> = [];
  if (!models.some((model) => model.overridden)) return { targets, diagnostics };
  const owners = new Map<AstNode, NamespaceModel>();
  const groups = new Map<string, AstNode[]>();
  const families = new Map<string, AstNode[]>();
  for (const model of models)
    for (const node of model.elements ?? []) {
      if (!('name' in node) || typeof node.name !== 'string') continue;
      owners.set(node, model);
      const key = namespaceKey(node, model);
      groups.set(key, [...(groups.get(key) ?? []), node]);
      if (isRosettaFunction(node)) {
        const family = namespaceKey(node, model, false);
        families.set(family, [...(families.get(family) ?? []), node]);
      }
    }
  const overriding = (node: AstNode) => owners.get(node)!.overridden;
  for (const group of groups.values()) {
    const replacements = group.filter(overriding);
    if (!replacements.length) continue;
    for (const node of group) targets.set(node, replacements.length === 1 ? replacements[0] : undefined);
    if (replacements.length > 1)
      for (const node of replacements)
        diagnostics.push({
          node,
          model: owners.get(node)!,
          code: 'NAMESPACE_OVERRIDE_AMBIGUOUS',
          message:
            'Several override declarations replace the same qualified name and kind: ' +
            String((node as AstNode & { name: string }).name)
        });
  }
  for (const family of families.values()) {
    const originals = family.filter((node) => !overriding(node));
    const replacements = family.filter(overriding);
    if (!replacements.length || !originals.some((node) => declarationDispatch(node))) continue;
    const originalKeys = new Set(originals.map((node) => namespaceKey(node, owners.get(node)!)));
    const replacementKeys = new Set(replacements.map((node) => namespaceKey(node, owners.get(node)!)));
    const existingSelectorsOnly =
      originals.filter((node) => !declarationDispatch(node)).length === 1 &&
      replacements.every(
        (node) => declarationDispatch(node) && originalKeys.has(namespaceKey(node, owners.get(node)!))
      );
    if (existingSelectorsOnly) continue;
    if (originalKeys.size === replacementKeys.size && [...originalKeys].every((key) => replacementKeys.has(key)))
      continue;
    for (const node of family) targets.set(node, undefined);
    for (const node of replacements)
      diagnostics.push({
        node,
        model: owners.get(node)!,
        code: 'NAMESPACE_OVERRIDE_DISPATCH',
        message: 'A namespace override must replace existing selectors or retain the complete dispatch family.'
      });
  }
  return { targets, diagnostics };
}
/** Shallow view: keeps effective declarations while preserving their original source ownership. */
export function selectNamespaceOverrideModels<T extends NamespaceModel>(models: readonly T[]): T[] {
  const { targets } = resolveNamespaceOverrides(models);
  if (!targets.size) return [...models];
  return models.map((model) => {
    const elements = model.elements.filter((node) => !targets.has(node) || targets.get(node) === node);
    return elements.length === model.elements.length ? model : { ...model, elements };
  });
}
function index(services: LangiumCoreServices): ResolutionState {
  const value = state(services);
  if (value.nodes) return value;
  value.nodes = new Map();
  value.identities = new WeakMap();
  value.diagnostics = [];
  const owned: Array<[AstNode, DeclarationIdentity]> = [];
  const roots: AstNode[] = [];
  const models: RosettaModel[] = [];
  for (const document of services.shared.workspace.LangiumDocuments.all) {
    const root = document.parseResult.value;
    const model = value.models.get(document.uri.toString());
    if (!isRosettaModel(root)) continue;
    models.push(root);
    for (const node of root.elements) {
      if (!('name' in node) || typeof node.name !== 'string') continue;
      roots.push(node);
      if (!model) continue;
      const identity = {
        model,
        namespace: namespaceFromModelName(root.name) ?? '',
        kind: node.$type,
        name: node.name,
        ...(declarationDispatch(node) ? { dispatch: declarationDispatch(node) } : {})
      };
      value.identities.set(node, identity);
      owned.push([node, identity]);
    }
  }
  const { targets: nativeTargets, diagnostics } = resolveNamespaceOverrides(models);
  value.namespaceTargets = nativeTargets;
  value.diagnostics.push(...diagnostics);
  const nodeFor = (node: AstNode) => (nativeTargets.has(node) ? nativeTargets.get(node) : node);
  const keyed = new Map<string, Set<AstNode | undefined>>();
  for (const [node, identity] of owned) {
    const key = declarationKey(identity);
    const candidates = keyed.get(key) ?? new Set();
    candidates.add(nodeFor(node));
    keyed.set(key, candidates);
  }
  for (const [key, candidates] of keyed) value.nodes.set(key, candidates.size === 1 ? [...candidates][0] : undefined);
  const identities = new Map(owned);
  const conflicts = new Set<AstNode>();
  for (const node of roots) {
    const identity = identities.get(node);
    const resolved = identity && value.redirects?.resolve(identity);
    const target =
      resolved && declarationKey(resolved) !== declarationKey(identity!)
        ? value.nodes.get(declarationKey(resolved))
        : node;
    const effective = target && nodeFor(target);
    const native = nativeTargets.get(node);
    if (native && native !== node && effective !== native && !conflicts.has(native)) {
      conflicts.add(native);
      value.diagnostics.push({
        node: native,
        code: 'NAMESPACE_OVERRIDE_CONFLICT',
        message: 'A configured replacement and namespace override compete for the same declaration.'
      });
    }
    effectiveDeclarations.set(node, { target: effective });
  }
  for (const node of roots)
    if (conflicts.has(nativeTargets.get(node)!)) effectiveDeclarations.set(node, { target: undefined });
  return value;
}
/** Build and validation share the same effective declaration inventory. */
export function initializeProjectResolution(services: LangiumCoreServices): void {
  index(services);
}
export function namespaceOverrideDiagnostics(services: LangiumCoreServices, model: RosettaModel) {
  return index(services).diagnostics!.filter((issue) => issue.node.$container === model);
}
/** The same native replacement pairs selected by linking, available after indexing. */
export function getNamespaceOverrideTargets(services: LangiumCoreServices): ReadonlyMap<AstNode, AstNode | undefined> {
  return index(services).namespaceTargets!;
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
  if (!hasProjectRedirects(services)) return node;
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
        .filter((value): value is AstNodeDescription => Boolean(value))
        .distinct((value) => JSON.stringify([value.documentUri.toString(), value.path, value.name])),
    getAllElements: () =>
      scope
        .getAllElements()
        .map(map)
        .filter((value): value is AstNodeDescription => Boolean(value))
        .distinct((value) => JSON.stringify([value.documentUri.toString(), value.path, value.name]))
  };
}
