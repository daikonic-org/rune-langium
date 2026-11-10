// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  getFunctionOutput,
  hasComputedScopes,
  isChoice,
  isData,
  isRosettaFunction,
  selectNamespaceOverrideModels,
  type RosettaModel
} from '@rune-langium/core';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { qualifiedNameFromNodeId } from '@rune-langium/visual-editor';
import { withInstrumentation } from './instrumentation/core.js';

export interface FunctionOutputTarget {
  typeFqn: string;
  kind: 'data' | 'choice';
}

function isSingular(card: { inf?: number; sup?: number; unbounded?: boolean } | undefined): boolean {
  return card?.inf === 1 && card.sup === 1 && card.unbounded !== true;
}

function isSingularPreviewOutput(card: { min: number; max: number | 'unbounded' }): boolean {
  return card.min === 1 && card.max === 1;
}

/**
 * Resolves the saved-instance target from the function declaration itself.
 * A result value is never used to infer its type.
 */
export const resolveFunctionOutputTarget = withInstrumentation(
  function resolveFunctionOutputTarget(
    models: ReadonlyArray<RosettaModel>,
    functionFqn: string | null,
    schema?: FormPreviewSchema
  ): FunctionOutputTarget | undefined {
    if (!functionFqn) return undefined;
    const schemaOutput =
      schema?.kind === 'function' && qualifiedNameFromNodeId(schema.targetId) === qualifiedNameFromNodeId(functionFqn)
        ? schema.functionOutput
        : undefined;
    if (schemaOutput && isSingularPreviewOutput(schemaOutput.cardinality)) {
      return { typeFqn: schemaOutput.typeFqn, kind: schemaOutput.kind };
    }
    const functionNode = selectNamespaceOverrideModels(models)
      .flatMap((model) => model.elements)
      .find((element) => isRosettaFunction(element) && `${element.$container.name}.${element.name}` === functionFqn);
    if (!functionNode || !isRosettaFunction(functionNode)) return undefined;
    // UI snapshots may arrive before their local scopes. The worker's schema
    // above is authoritative; only linked/ready declarations support this fallback.
    if (!hasComputedScopes(functionNode)) return undefined;
    const output = getFunctionOutput(functionNode);
    const target = output?.typeCall.type.ref;
    if (!output || !target || !isSingular(output.card) || (!isData(target) && !isChoice(target))) return undefined;
    return {
      typeFqn: `${target.$container.name}.${target.name}`,
      kind: isData(target) ? 'data' : 'choice'
    };
  },
  { op: 'resolveFunctionOutputTarget' }
);
