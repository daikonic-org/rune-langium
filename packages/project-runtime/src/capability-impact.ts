// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { AstNode } from 'langium';
import {
  getEffectiveProjectDeclaration,
  isRosettaFunction,
  isRosettaModel,
  namespaceFromModelName,
  declarationKey
} from '@rune-langium/core';
import {
  ProjectBindingUnavailable,
  collectDeclarationDependencies,
  resolveExportSelection,
  type ExportSelection
} from '@rune-langium/codegen/export';
import type { ProjectSnapshot, SymbolIdentity } from '@rune-langium/project-config';
import type { EffectiveProject } from './effective-project.js';
import type { ProjectDeclarations } from './override-validation.js';
import { projectTargetNamespaces } from './project-build.js';
/** Reverse the shared declaration dependencies once; never approximate impacts with symbol names. */
export function projectCapabilityImpact(
  snapshot: ProjectSnapshot,
  graph: EffectiveProject,
  declarations: readonly ProjectDeclarations[]
) {
  if (!graph.capabilities.some((capability) => capability.affectedDeclarations?.length))
    return { capabilities: graph.capabilities, unavailableFunctions: [] };
  const source = new Map(declarations.map((entry) => [declarationKey(entry.identity), entry.node]));
  const identity = new Map<AstNode, SymbolIdentity>(declarations.map((entry) => [entry.node, entry.identity]));
  const active = new Set(
    declarations.flatMap((entry) => {
      const node = getEffectiveProjectDeclaration(entry.node);
      return node ? [node] : [];
    })
  );
  const reverse = new Map<AstNode, Set<AstNode>>();
  for (const root of active)
    for (const dependency of collectDeclarationDependencies(root)) {
      if (!active.has(dependency)) continue;
      const parents = reverse.get(dependency) ?? new Set<AstNode>();
      parents.add(root);
      reverse.set(dependency, parents);
    }
  const available = new Set(declarations.map((entry) => entry.identity.namespace));
  const scopes = new Map(
    Object.entries(snapshot.project.build.targets).map(([name, target]) => [
      name,
      {
        target,
        selection: resolveExportSelection([...graph.documents], {
          namespaces: projectTargetNamespaces(snapshot, target, available),
          declarations: []
        })
      }
    ])
  );
  const blocked = new Map<string, { symbol: SymbolIdentity; reasons: Set<string> }>();
  const capabilities = graph.capabilities.map((capability) => {
    if (!capability.affectedDeclarations?.length) return capability;
    const affected = new Set<AstNode>();
    const queue = capability.affectedDeclarations.flatMap((symbol) => {
      const node = source.get(declarationKey(symbol));
      const effective = node && getEffectiveProjectDeclaration(node);
      return effective ? [effective] : [];
    });
    while (queue.length) {
      const node = queue.pop()!;
      if (affected.has(node)) continue;
      affected.add(node);
      queue.push(...(reverse.get(node) ?? []));
    }
    const affectedDeclarations = [...affected].flatMap((node) => {
      const symbol = identity.get(node);
      return symbol ? [symbol] : [];
    });
    const affectedFunctions = [...affected]
      .filter(isRosettaFunction)
      .flatMap((node) => {
        const symbol = identity.get(node);
        return symbol ? [symbol] : [];
      })
      .sort((a, b) => (declarationKey(a) < declarationKey(b) ? -1 : declarationKey(a) > declarationKey(b) ? 1 : 0));
    const match = capability.id.startsWith('implementation:') ? affectedFunctions : affectedDeclarations;
    const affectedTargets = [...scopes]
      .filter(
        ([, scope]) =>
          (!capability.id.startsWith('implementation:') || scope.target.generator === 'typescript') &&
          scope.selection.included.some((selected) =>
            match.some(
              (symbol) =>
                selected.namespace === symbol.namespace &&
                selected.kind === symbol.kind &&
                selected.name === symbol.name
            )
          )
      )
      .map(([name]) => name);
    if (capability.status === 'unavailable')
      for (const symbol of affectedFunctions) {
        const key = declarationKey(symbol);
        const entry = blocked.get(key) ?? { symbol, reasons: new Set<string>() };
        entry.reasons.add(capability.id + ': ' + capability.reason);
        blocked.set(key, entry);
      }
    return { ...capability, affectedDeclarations, affectedFunctions, affectedTargets };
  });
  return {
    capabilities,
    unavailableFunctions: [...blocked.values()].map((entry) => ({
      symbol: entry.symbol,
      reason: [...entry.reasons].join('; ')
    }))
  };
}

/** Unavailable functions block only selected executable closures, never unrelated pure types. */
export function assertProjectGenerationCapabilities(
  graph: EffectiveProject,
  selection: ExportSelection | undefined,
  generator: string
): void {
  const unavailable = graph.capabilities
    .map((capability) =>
      capability.id.startsWith('resource:') && !['typescript', 'zod', 'json-schema'].includes(generator)
        ? {
            ...capability,
            status: 'unavailable',
            reason: `The ${generator} generator does not support project code-list constraints.`
          }
        : capability
    )
    .filter(
      (capability) =>
        capability.status === 'unavailable' &&
        capability.affectedDeclarations?.length &&
        (!capability.id.startsWith('implementation:') || generator === 'typescript')
    );
  if (!unavailable.length) return;
  const namespaces = graph.documents.flatMap((document) =>
    isRosettaModel(document.parseResult.value)
      ? [namespaceFromModelName(document.parseResult.value.name)].filter((name): name is string => Boolean(name))
      : []
  );
  const resolved = resolveExportSelection([...graph.documents], selection ?? { namespaces, declarations: [] });
  if (resolved.unknown.length || resolved.unknownNamespaces.length) return;
  const blocked = unavailable.filter((capability) =>
    resolved.included.some((selected) =>
      (capability.id.startsWith('implementation:')
        ? capability.affectedFunctions
        : (capability.affectedDeclarations ?? [])
      ).some(
        (symbol) =>
          symbol.namespace === selected.namespace && symbol.kind === selected.kind && symbol.name === selected.name
      )
    )
  );
  if (blocked.length)
    throw new ProjectBindingUnavailable(
      blocked.map((capability) => capability.id + ': ' + capability.reason).join('; ')
    );
}
