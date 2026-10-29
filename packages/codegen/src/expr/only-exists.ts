// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  isAttribute,
  isChoiceOption,
  isListLiteral,
  isRosettaFeatureCall,
  isRosettaSymbolReference,
  type RosettaExpression,
  type RosettaOnlyExistsExpression
} from '@rune-langium/core';
import { expressionType, featureIsMany, featureName, typeFeatures } from './navigation.js';
import type { ExpressionTranspilerContext } from './transpiler.js';
import { treesEquivalent } from '../emit/rosetta/expression-tree-equivalence.js';
import { renderPresence } from './presence.js';
import { fieldMetadataKind } from './metadata-runtime.js';

/** Shared parent/field selection; emitters own their target predicate syntax. */
export function onlyExistsSelection(
  expr: RosettaOnlyExistsExpression,
  rootAttributes: readonly string[],
  render: (node: RosettaExpression) => string
):
  | {
      parent: RosettaExpression | undefined;
      parentText: string | undefined;
      features: ReadonlyMap<string, ReturnType<typeof typeFeatures>[number]> | undefined;
      attributes: readonly string[];
      selected: readonly string[];
      forbidden: string[];
    }
  | undefined {
  const args = expr.args.length
    ? expr.args
    : isListLiteral(expr.argument)
      ? expr.argument.elements
      : expr.argument
        ? [expr.argument]
        : [];
  if (!args.length) return undefined;
  const first = args[0]!;
  const parent = isRosettaFeatureCall(first) ? first.receiver : undefined;
  const names: string[] = [];
  for (const arg of args) {
    if (parent && isRosettaFeatureCall(arg) && arg.receiver && treesEquivalent(arg.receiver, parent))
      names.push(isChoiceOption(arg.feature?.ref) ? featureName(arg.feature.ref) : (arg.feature?.$refText ?? ''));
    else if (!parent && isRosettaSymbolReference(arg)) names.push(arg.symbol.$refText);
    else return undefined;
  }
  const features = parent
    ? new Map(typeFeatures(expressionType(parent)).map((feature) => [featureName(feature), feature]))
    : undefined;
  const attributes = features ? [...features.keys()] : rootAttributes;
  const allowed = new Set(names);
  const parentText = parent ? render(parent) : undefined;
  return {
    parent,
    parentText,
    features,
    attributes,
    selected: names,
    forbidden: attributes.filter((name) => !allowed.has(name))
  };
}

export function renderOnlyExists(
  expr: RosettaOnlyExistsExpression,
  ctx: ExpressionTranspilerContext,
  render: (node: RosettaExpression) => string,
  renderAttribute: (name: string) => string
): string | undefined {
  const selected = onlyExistsSelection(expr, [...ctx.attributeTypes.keys()], render);
  if (!selected) return undefined;
  const { parent, parentText, features, forbidden } = selected;
  const access = (name: string) => (parent ? `__parent?.[${JSON.stringify(name)}]` : renderAttribute(name));
  const checks = forbidden.map((name) => {
    const field = features?.get(name);
    return `(${renderPresence(
      access(name),
      field ? featureIsMany(field) : undefined,
      isAttribute(field) ? fieldMetadataKind(field) : undefined,
      true,
      ctx.emitMode.startsWith('ts-')
    )})`;
  });
  const predicate = checks.join(' && ') || 'true';
  return parent ? `((__parent) => ${predicate})(${parentText})` : `(${predicate})`;
}
