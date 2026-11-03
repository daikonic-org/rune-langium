// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { DocumentState, type AstNode, type LangiumCoreServices } from 'langium';
import { isRosettaFunction, type Attribute, type RosettaFunction, type RosettaModel } from '../generated/ast.js';
import { getFunctionInputs, getFunctionOutput } from '../utils/expression-utils.js';
import { canonicalProjectJson } from './project-contract.js';
import { getNamespaceOverrideTargets, projectDeclarationIdentity } from './project-resolution.js';

/** Ordered, constraint-preserving callable contract shared by every replacement mechanism. */
function callableSignature(services: LangiumCoreServices, node: RosettaFunction): string {
  const attribute = (attr: Attribute | undefined) =>
    attr
      ? {
          name: attr.name,
          type: attr.typeCall.type.ref
            ? projectDeclarationIdentity(services, attr.typeCall.type.ref)
            : { unresolved: attr.typeCall.type.$refText },
          arguments: [...attr.typeCall.arguments, ...attr.typeCallArgs].map((argument) => ({
            parameter: argument.parameter.$refText,
            value: JSON.parse(
              services.serializer.JsonSerializer.serialize(argument.value, {
                refText: true,
                replacer: (key, value, defaultReplacer) =>
                  ['$textRegion', '$sourceText', '$comment'].includes(key)
                    ? undefined
                    : typeof value === 'bigint'
                      ? Number(value)
                      : defaultReplacer(key, value)
              })
            )
          })),
          card: { inf: attr.card.inf, sup: attr.card.sup, unbounded: attr.card.unbounded }
        }
      : null;
  return canonicalProjectJson({
    inputs: getFunctionInputs(node).map(attribute),
    output: attribute(getFunctionOutput(node))
  });
}

export function callableOverrideSignaturesMatch(
  services: LangiumCoreServices,
  source: RosettaFunction,
  replacement: RosettaFunction
): boolean {
  return callableSignature(services, source) === callableSignature(services, replacement);
}

/** Validate after scopes exist; indexing must never resolve signature references. */
export function namespaceOverrideSignatureDiagnostics(services: LangiumCoreServices, model?: RosettaModel) {
  const diagnostics: Array<{ node: AstNode; code: string; message: string }> = [];
  for (const [source, replacement] of getNamespaceOverrideTargets(services)) {
    if (!replacement || source === replacement || !isRosettaFunction(source) || !isRosettaFunction(replacement))
      continue;
    // Either document can be built first or materialized later. Both sides must
    // diagnose an incompatible pair when their own model is validated.
    const node =
      !model || replacement.$container === model ? replacement : source.$container === model ? source : undefined;
    if (!node) continue;
    const ready = [source, replacement].every(
      (entry) => (entry.$container.$document?.state ?? DocumentState.Parsed) >= DocumentState.ComputedScopes
    );
    if (!ready || !callableOverrideSignaturesMatch(services, source, replacement))
      diagnostics.push({
        node,
        code: 'NAMESPACE_OVERRIDE_SIGNATURE',
        message: ready
          ? `Namespace override callable signature differs: ${node.$container?.name}.${node.name}`
          : `Namespace override signature requires computed dependency scopes: ${node.$container?.name}.${node.name}`
      });
  }
  return diagnostics;
}
