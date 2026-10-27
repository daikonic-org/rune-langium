// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { URI, type LangiumDocument, type Reference } from 'langium';
import {
  CODE_LIST_ENUM_NAMESPACE,
  CODE_LIST_ENUM_SOURCE,
  declarationKey,
  isRosettaTypeAlias,
  type RosettaTypeAlias,
  type RosettaType,
  type RuneDslServices
} from '@rune-langium/core';
import { projectBytesRevision } from '@rune-langium/project-config';
import { renderCodeListEnum, type ProjectCodeListBinding } from '@rune-langium/codegen/export';
import type { ProjectDeclarations } from './override-validation.js';

/** Materialized data belongs to this captured graph; workspace and upstream source bytes stay untouched. */
export async function prepareCodeListEnums(
  declarations: readonly ProjectDeclarations[],
  bindings: readonly ProjectCodeListBinding[],
  services: RuneDslServices,
  fromString: (content: string, uri: URI) => LangiumDocument
) {
  const plans: { alias: RosettaTypeAlias; key: string; name: string; document: LangiumDocument }[] = [];
  for (const binding of bindings) {
    if (!binding.values?.length || binding.unavailable) continue;
    const declaration = declarations.find((entry) => declarationKey(entry.identity) === declarationKey(binding.symbol));
    if (!declaration || !isRosettaTypeAlias(declaration.node)) continue;
    const digest = await projectBytesRevision(new TextEncoder().encode(declarationKey(binding.symbol)));
    const name = 'CodeList_' + digest.slice(0, 24);
    plans.push({
      alias: declaration.node,
      key: declarationKey(binding.symbol),
      name,
      document: fromString(
        renderCodeListEnum(name, binding.values, { declareSource: false }),
        URI.parse('file:///project-resources/' + name + '.rosetta')
      )
    });
  }
  const source = plans.length
    ? fromString(
        `namespace ${CODE_LIST_ENUM_NAMESPACE}\nsynonym source ${CODE_LIST_ENUM_SOURCE}\n`,
        URI.parse('file:///project-resources/source.rosetta')
      )
    : undefined;
  return {
    documents: [...(source ? [source] : []), ...plans.map((plan) => plan.document)],
    keys: new Set(plans.map((plan) => plan.key)),
    apply() {
      for (const plan of plans)
        plan.alias.typeCall.type = services.references.Linker.buildReference(
          plan.alias.typeCall,
          'type',
          undefined,
          `${CODE_LIST_ENUM_NAMESPACE}.${plan.name}`
        ) as Reference<RosettaType>;
    }
  };
}
