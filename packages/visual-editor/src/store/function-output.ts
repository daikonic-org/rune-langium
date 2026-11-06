// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isRosettaExpression, type Dehydrated, type RosettaFunction } from '@rune-langium/core';
import { RAW_DSL_TYPE, renderExpression } from '@rune-langium/codegen/rosetta';
import { normalizedExpressionDraft } from './edit-reconcile.js';

/** Prepare a lexical output rename without changing the committed graph on failure. */
export function renamedFunctionOutput(
  source: Dehydrated<RosettaFunction>,
  oldName: string,
  newName: string
): Dehydrated<RosettaFunction> | undefined {
  if (source.inputs.some((input) => input.name === newName) || source.shortcuts.some((alias) => alias.name === newName))
    return undefined;
  const result = structuredClone(source);
  let conflict = false;
  const visit = (value: unknown, shadowed = false, captured = false): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.map((item) => visit(item, shadowed, captured)).some(Boolean);
    if (
      '$type' in value &&
      value.$type === 'InlineFunction' &&
      'parameters' in value &&
      Array.isArray(value.parameters)
    ) {
      const names = value.parameters.map((parameter: { name: string }) => parameter.name);
      shadowed ||= names.includes(oldName);
      captured ||= names.includes(newName);
    }
    let changed = false;
    if (!shadowed && '$type' in value && value.$type === 'RosettaSymbolReference' && 'symbol' in value) {
      const ref = value.symbol;
      if (ref && typeof ref === 'object' && '$refText' in ref && ref.$refText === oldName) {
        conflict ||= captured;
        ref.$refText = newName;
        changed = true;
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$') || key === 'symbol') continue;
      const normalized = normalizedExpressionDraft(child);
      if (
        normalized === child &&
        child &&
        typeof child === 'object' &&
        '$type' in child &&
        child.$type === RAW_DSL_TYPE
      ) {
        conflict = true; // Invalid private text cannot safely participate in a structural rename.
        continue;
      }
      const candidate = normalized === child ? child : structuredClone(normalized);
      if (visit(candidate, shadowed, captured)) {
        Reflect.set(value, key, candidate);
        changed = true;
      }
    }
    if (changed && isRosettaExpression(value)) Reflect.set(value, '$cstText', renderExpression(value));
    return changed;
  };
  for (const operation of result.operations) {
    if (operation.assignRoot.$refText === oldName) operation.assignRoot.$refText = newName;
  }
  visit(result);
  return conflict ? undefined : result;
}
