// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getLinkedReferenceTarget,
  getSymbolReferenceRegions,
  isInlineFunction,
  isOperation,
  isRosettaSymbolReference,
  type Dehydrated,
  type RosettaFunction,
  type SourceRegion
} from '@rune-langium/core';
import { escapeRuneIdentifier } from '@rune-langium/core/rune-identifiers';
import { RAW_DSL_TYPE, renderExpression } from '@rune-langium/codegen/rosetta';
import { SCHEMA_BY_TYPE } from '../schemas/schema-by-type.js';
import {
  applyCstReferenceEdits,
  type CstReferenceEdit,
  type ExpressionSource
} from '../serialize/cst-reference-edits.js';

type Binding = { output: boolean; captures: readonly string[]; implicit: boolean; region?: SourceRegion };
// Facts follow the immutable graph payload's lifetime. Keep no live Langium ASTs,
// runtime links or parallel scope resolver in the editable domain payload.
const outputBindings = new WeakMap<object, Binding>();

/** Capture authoritative link identities before the graph strips runtime references. */
export function rememberFunctionOutputBindings(source: Dehydrated<RosettaFunction>, linked: RosettaFunction): void {
  const visit = (value: unknown, ast: unknown, captures: readonly string[], implicit: boolean) => {
    if (!value || typeof value !== 'object' || !ast || typeof ast !== 'object') return;
    if (isInlineFunction(ast)) {
      captures = [...captures, ...ast.parameters.map((parameter) => parameter.name)];
      implicit = ast.parameters.length === 0;
    }
    if (isRosettaSymbolReference(ast) && ast.symbol?.$refText && ast.symbol.$refText === linked.output?.name) {
      const target = getLinkedReferenceTarget(ast, ast.symbol);
      if (target) {
        const output = target === linked.output;
        const region = output ? getSymbolReferenceRegions(ast)?.name : undefined;
        outputBindings.set(value, { output, captures, implicit, region });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith('$') && key !== 'symbol') visit(child, Reflect.get(ast, key), captures, implicit);
    }
  };
  visit(source, linked, [], false);
}

/** Rename linked output references atomically; stale/unproven bindings fail closed. */
export function renamedFunctionOutput(
  source: Dehydrated<RosettaFunction>,
  oldName: string,
  newName: string
): Dehydrated<RosettaFunction> | undefined {
  if (source.inputs.some((input) => input.name === newName) || source.shortcuts.some((alias) => alias.name === newName))
    return undefined;
  const result = structuredClone(source);
  const replacement = escapeRuneIdentifier(newName);
  let conflict = false;
  const visit = (value: unknown, original: unknown, edits: (CstReferenceEdit | undefined)[]) => {
    if (!value || typeof value !== 'object') return;
    if ('$type' in value && value.$type === RAW_DSL_TYPE) {
      conflict = true;
      return;
    }
    if (isRosettaSymbolReference(value) && value.symbol?.$refText === oldName) {
      const binding = original && typeof original === 'object' ? outputBindings.get(original) : undefined;
      if (!binding) conflict = true;
      else if (binding.output) {
        // Explicit captures are known. An implicit lambda can introduce additional
        // element fields; without its full scope, do not guess a safe destination.
        if (binding.implicit || binding.captures.includes(newName)) conflict = true;
        else {
          Reflect.set(value.symbol, '$refText', newName);
          edits.push(binding.region && { ...binding.region, expectedName: oldName, replacement });
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith('$') && key !== 'symbol')
        visit(child, original && typeof original === 'object' ? Reflect.get(original, key) : undefined, edits);
    }
  };
  for (const key of ['shortcuts', 'conditions', 'operations', 'postConditions'] as const) {
    for (const [index, statement] of (result[key] ?? []).entries()) {
      const renamedAssignment = isOperation(statement) && statement.assignRoot?.$refText === oldName;
      if (renamedAssignment) Reflect.set(statement.assignRoot, '$refText', newName);
      const edits: (CstReferenceEdit | undefined)[] = [];
      visit(statement.expression, source[key]?.[index]?.expression, edits);
      if (conflict) return undefined;
      if (statement.expression && edits.length) {
        const expression = statement.expression as ExpressionSource;
        const { $cstRange: range, $cstText: original } = expression;
        if (range && edits.every((edit) => edit !== undefined)) {
          expression.$cstReferenceEdits = edits;
          expression.$cstText =
            (original && applyCstReferenceEdits(original, range.offset, edits)) ||
            renderExpression(statement.expression);
        } else {
          delete expression.$cstRange;
          expression.$cstText = renderExpression(statement.expression);
        }
      }
      // Match the publication gate so a rejected statement cannot leave a
      // freshly renamed signature paired with stale implementation source.
      if ((renamedAssignment || edits.length) && !SCHEMA_BY_TYPE[statement.$type]?.safeParse(statement).success)
        return undefined;
    }
  }
  return result;
}
