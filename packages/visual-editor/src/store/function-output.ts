// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isInlineFunction,
  isRosettaExpression,
  isRosettaSymbolReference,
  type Dehydrated,
  type RosettaFunction
} from '@rune-langium/core';
import { RAW_DSL_TYPE, renderExpression } from '@rune-langium/codegen/rosetta';

type Binding = { output: boolean; captures: readonly string[]; implicit: boolean };
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
      const target = ast.symbol.ref;
      if (target) outputBindings.set(value, { output: target === linked.output, captures, implicit });
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
  let conflict = false;
  const visit = (value: unknown, original: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if ('$type' in value && value.$type === RAW_DSL_TYPE) {
      conflict = true;
      return false;
    }
    let changed = false;
    if (isRosettaSymbolReference(value) && value.symbol?.$refText === oldName) {
      const binding = original && typeof original === 'object' ? outputBindings.get(original) : undefined;
      if (!binding) conflict = true;
      else if (binding.output) {
        // Explicit captures are known. An implicit lambda can introduce additional
        // element fields; without its full scope, do not guess a safe destination.
        if (binding.implicit || binding.captures.includes(newName)) conflict = true;
        else {
          Reflect.set(value.symbol, '$refText', newName);
          changed = true;
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith('$') && key !== 'symbol')
        changed =
          visit(child, original && typeof original === 'object' ? Reflect.get(original, key) : undefined) || changed;
    }
    if (changed && isRosettaExpression(value)) Reflect.set(value, '$cstText', renderExpression(value));
    return changed;
  };
  for (const operation of result.operations) {
    if (operation.assignRoot?.$refText === oldName) operation.assignRoot.$refText = newName;
  }
  visit(result, source);
  return conflict ? undefined : result;
}
