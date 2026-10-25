// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  declarationKey,
  projectDeclarationIdentity,
  getFunctionInputs,
  getFunctionOutput,
  isRosettaFunction,
  type DeclarationIdentity,
  type DeclarationRedirects,
  type RuneDslServices,
  type Attribute,
  type RosettaFunction
} from '@rune-langium/core';
import { type AstNode } from 'langium';
import { canonicalProjectJson, type ProjectOverride, type ProjectDiagnostic } from '@rune-langium/project-config';
export interface ProjectDeclarations {
  identity: DeclarationIdentity;
  node: AstNode;
}
const family = (identity: DeclarationIdentity): DeclarationIdentity => ({
  model: identity.model,
  namespace: identity.namespace,
  kind: identity.kind,
  name: identity.name
});
/** Explicit identities only; the absence of a destination never means 'use the original'. */
export function projectOverrideRedirects(overrides: readonly ProjectOverride[]): {
  redirects: DeclarationRedirects;
  diagnostics: ProjectDiagnostic[];
} {
  const mappings = new Map<string, DeclarationIdentity>();
  const diagnostics: ProjectDiagnostic[] = [];
  for (const mapping of overrides) {
    if (mapping.kind !== 'implementation') continue;
    if (
      overrides.some(
        (other) =>
          other.kind === 'declaration' &&
          declarationKey(family(other.source)) === declarationKey(family(mapping.source))
      )
    )
      diagnostics.push(
        issue(
          'OVERRIDE_AMBIGUOUS',
          'A declaration replacement and an installed implementation compete for the same source family: ' +
            declarationKey(mapping.source)
        )
      );
  }
  for (const mapping of overrides) {
    if (mapping.kind !== 'declaration') continue;
    const key = declarationKey(mapping.source);
    if (mappings.has(key))
      diagnostics.push(issue('OVERRIDE_AMBIGUOUS', 'Several replacements map the same declaration: ' + key));
    mappings.set(key, mapping.replacement);
  }
  const resolve = (identity: DeclarationIdentity): DeclarationIdentity => {
    const seen = new Set<string>();
    let current = identity;
    while (true) {
      const key = declarationKey(current);
      if (seen.has(key)) throw new Error('Override cycle: ' + [...seen, key].join(' -> '));
      seen.add(key);
      const exact = mappings.get(key);
      const base = current.dispatch === undefined ? undefined : mappings.get(declarationKey(family(current)));
      const next = exact ?? (base ? { ...base, dispatch: current.dispatch } : undefined);
      if (!next) return current;
      current = next;
    }
  };
  for (const mapping of overrides)
    if (mapping.kind === 'declaration') {
      try {
        resolve(mapping.source);
      } catch (error) {
        diagnostics.push(issue('OVERRIDE_CYCLE', String(error)));
      }
    }
  return { redirects: { resolve }, diagnostics };
}
export function validateProjectOverrides(
  services: RuneDslServices,
  overrides: readonly ProjectOverride[],
  declarations: readonly ProjectDeclarations[],
  signatures = false
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const redirects = projectOverrideRedirects(overrides).redirects;
  const byKey = new Map<string, ProjectDeclarations[]>();
  for (const declaration of declarations) {
    const key = declarationKey(declaration.identity);
    byKey.set(key, [...(byKey.get(key) ?? []), declaration]);
  }
  for (const mapping of overrides) {
    if (mapping.kind !== 'declaration') continue;
    const source = byKey.get(declarationKey(mapping.source));
    const replacement = byKey.get(declarationKey(mapping.replacement));
    if (source?.length !== 1)
      diagnostics.push(
        issue('OVERRIDE_SOURCE', 'Override source is missing or ambiguous: ' + declarationKey(mapping.source))
      );
    if (replacement?.length !== 1 || mapping.replacement.model !== 'local')
      diagnostics.push(
        issue(
          'OVERRIDE_DESTINATION',
          'Override destination must be one local declaration: ' + declarationKey(mapping.replacement)
        )
      );
    if (mapping.source.kind !== mapping.replacement.kind)
      diagnostics.push(issue('OVERRIDE_KIND', 'Override declaration kinds differ.'));
    if (source?.length !== 1 || replacement?.length !== 1) continue;
    const sourceFamily = declarations.filter(
      (entry) => declarationKey(family(entry.identity)) === declarationKey(family(mapping.source))
    );
    const targetFamily = declarations.filter(
      (entry) =>
        declarationKey(family(entry.identity)) === declarationKey(family(redirects.resolve(mapping.replacement)))
    );
    if (
      isRosettaFunction(source[0]!.node) &&
      (canonicalProjectJson(sourceFamily.map((entry) => entry.identity.dispatch ?? '').sort()) !==
        canonicalProjectJson(targetFamily.map((entry) => entry.identity.dispatch ?? '').sort()) ||
        sourceFamily.some(
          (entry) =>
            !targetFamily.some(
              (target) => declarationKey(target.identity) === declarationKey(redirects.resolve(entry.identity))
            )
        ))
    )
      diagnostics.push(
        issue('OVERRIDE_DISPATCH', 'Replacement must retain the complete dispatch family: ' + mapping.source.name)
      );
    if (!signatures) continue;
    for (const entry of sourceFamily) {
      const target = targetFamily.find((candidate) => candidate.identity.dispatch === entry.identity.dispatch);
      if (target && isRosettaFunction(entry.node) && isRosettaFunction(target.node)) {
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
        const signature = (node: RosettaFunction) => ({
          inputs: getFunctionInputs(node).map(attribute),
          output: attribute(getFunctionOutput(node))
        });
        if (canonicalProjectJson(signature(entry.node)) !== canonicalProjectJson(signature(target.node)))
          diagnostics.push(
            issue('OVERRIDE_SIGNATURE', 'Replacement callable signature differs: ' + declarationKey(entry.identity))
          );
      }
    }
  }
  return diagnostics;
}
function issue(code: string, message: string): ProjectDiagnostic {
  return { code, message, severity: 'error', path: 'build-config.yml' };
}
