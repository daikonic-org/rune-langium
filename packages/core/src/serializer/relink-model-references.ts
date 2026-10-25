// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  AstUtils,
  isMultiReference,
  type AstNode,
  type LangiumCoreServices,
  type Reference,
  type MultiReference
} from 'langium';
/** Rebuild authored references through Langium's authoritative scope/link boundary. */
export function relinkReference(
  services: LangiumCoreServices,
  container: AstNode,
  property: string,
  reference: Reference | MultiReference
): Reference | MultiReference {
  return isMultiReference(reference)
    ? services.references.Linker.buildMultiReference(container, property, undefined, reference.$refText)
    : services.references.Linker.buildReference(container, property, undefined, reference.$refText);
}
/** Dependency snapshots must stay relinkable after live edits or a project-context transition. */
export function relinkModelReferences(services: LangiumCoreServices, model: AstNode): void {
  for (const node of AstUtils.streamAst(model)) {
    for (const info of AstUtils.streamReferences(node)) {
      const reference = relinkReference(services, info.container, info.property, info.reference);
      const container = info.container as unknown as Record<string, unknown>;
      if (info.index === undefined) container[info.property] = reference;
      else (container[info.property] as unknown[])[info.index] = reference;
    }
  }
}
