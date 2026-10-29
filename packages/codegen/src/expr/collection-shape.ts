// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getOperationArgument,
  isAttribute,
  isChoiceOption,
  isRosettaFunction,
  isRosettaRule,
  isRosettaSymbolReference,
  isRosettaImplicitVariable,
  isClosureParameter,
  isInlineFunction,
  isSwitchCaseOrDefault,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaEnumValue,
  isShortcutDeclaration,
  isListLiteral,
  isRosettaConditionalExpression,
  isThenOperation,
  isMapOperation,
  isReduceOperation,
  isDefaultOperation,
  isSwitchOperation,
  type RosettaExpression
} from '@rune-langium/core';
import { AstUtils } from 'langium';
import { expressionIsMany, featureIsMany } from './navigation.js';
import { expressionIsPresent } from './scalar-operators.js';
import { functionOutput } from '../types/func.js';
import { parenthesizeReceiver } from './syntax.js';

export type CollectionShape = 'scalar' | 'array' | 'mixed' | 'unknown';

const elementSelectors = new Set([
  'FirstOperation',
  'LastOperation',
  'RosettaOnlyElement',
  'MinOperation',
  'MaxOperation'
]);

function inlineBindingArgument(
  expression: RosettaExpression
): { argument: RosettaExpression; element: boolean } | undefined {
  const target = isRosettaSymbolReference(expression) ? expression.symbol.ref : undefined;
  const owner = isClosureParameter(target)
    ? target.$container
    : isRosettaImplicitVariable(expression)
      ? AstUtils.getContainerOfType(expression, (node) => isInlineFunction(node) || isSwitchCaseOrDefault(node))
      : undefined;
  if (!isInlineFunction(owner)) return undefined;
  const operation = owner.$container;
  if (
    !isThenOperation(operation) &&
    !['MapOperation', 'FilterOperation', 'SortOperation', 'MinOperation', 'MaxOperation', 'ReduceOperation'].includes(
      operation.$type
    )
  )
    return undefined;
  const argument = getOperationArgument(operation);
  return argument ? { argument, element: !isThenOperation(operation) } : undefined;
}

/** Authored empty is absence, not a competing array shape in a value branch. */
function valueBranches(expressions: readonly (RosettaExpression | undefined)[]): RosettaExpression[] {
  return expressions.filter(
    (node): node is RosettaExpression => !!node && !(isListLiteral(node) && node.elements.length === 0)
  );
}

/** A multi-valued expression may mix scalar and array branches; keep that distinction. */
export function collectionShape(
  expression: RosettaExpression | undefined,
  seen = new Set<RosettaExpression>()
): CollectionShape {
  if (!expression || seen.has(expression)) return 'unknown';
  seen.add(expression);
  const from = (node: RosettaExpression | undefined) => collectionShape(node, new Set(seen));
  const merge = (left: CollectionShape, right: CollectionShape) => (left === right ? left : 'mixed');
  const branches = (nodes: readonly (RosettaExpression | undefined)[]): CollectionShape => {
    const shapes = valueBranches(nodes).map(from);
    return shapes.length ? shapes.reduce(merge) : 'array';
  };
  const elementFrom = (argument: RosettaExpression | undefined): CollectionShape =>
    collectionDepth(argument) > 1 || from(argument) === 'unknown' ? 'unknown' : 'scalar';
  const binding = inlineBindingArgument(expression);
  if (binding) return binding.element ? elementFrom(binding.argument) : from(binding.argument);
  if (elementSelectors.has(expression.$type)) return elementFrom(getOperationArgument(expression));
  if (isReduceOperation(expression))
    return merge(elementFrom(getOperationArgument(expression)), from(expression.function?.body));
  if (isListLiteral(expression)) return 'array';
  if (isRosettaConditionalExpression(expression)) return branches([expression.ifthen, expression.elsethen]);
  if (isDefaultOperation(expression)) return branches([expression.left, expression.right]);
  if (isThenOperation(expression)) return from(expression.function?.body ?? expression.argument);
  if (isSwitchOperation(expression)) {
    return branches(expression.cases.map((branch) => branch.expression));
  }
  if (isRosettaSymbolReference(expression)) {
    const ref = expression.symbol.ref;
    if (isShortcutDeclaration(ref) || isRosettaRule(ref)) return from(ref.expression);
    if (isRosettaFunction(ref)) return featureIsMany(functionOutput(ref)) ? 'array' : 'scalar';
    if (isAttribute(ref) || isChoiceOption(ref)) return expressionIsMany(expression) ? 'array' : 'scalar';
    if (isRosettaEnumValue(ref)) return 'scalar';
    return 'unknown';
  }
  if (isRosettaFeatureCall(expression) || isRosettaDeepFeatureCall(expression))
    return expressionIsMany(expression) ? 'array' : 'scalar';
  if (
    expression.$type === 'AsOperation' ||
    expression.$type === 'AsKeyOperation' ||
    expression.$type === 'WithMetaOperation'
  )
    return from(getOperationArgument(expression));
  if (expression.$type === 'RosettaSuperCall') return 'unknown';
  return expressionIsMany(expression) ? 'array' : 'scalar';
}

export function collectionIsPresent(expression: RosettaExpression | undefined): boolean {
  if (!expression) return false;
  if (isListLiteral(expression)) return true;
  if (isRosettaSymbolReference(expression) && isRosettaFunction(expression.symbol.ref))
    return featureIsMany(functionOutput(expression.symbol.ref));
  if (isThenOperation(expression)) return collectionIsPresent(expression.function?.body ?? expression.argument);
  if (isRosettaConditionalExpression(expression))
    return collectionIsPresent(expression.ifthen) && collectionIsPresent(expression.elsethen);
  if (expression.$type === 'MapOperation' || expression.$type === 'FilterOperation')
    return !getOperationArgument(expression) || expressionIsMany(getOperationArgument(expression));
  return ['SortOperation', 'ReverseOperation', 'DistinctOperation', 'FlattenOperation'].includes(expression.$type);
}

/** Native list materialization preserves legitimate missing and mixed-cardinality values. */
export function nativeCollection(
  value: string,
  expression?: RosettaExpression,
  implicitMany?: boolean,
  typescript = false,
  projection = false
): string {
  const shape = expression
    ? collectionShape(expression)
    : implicitMany === undefined
      ? 'unknown'
      : implicitMany
        ? 'array'
        : 'scalar';
  if (shape === 'array') return collectionIsPresent(expression) ? `(${value})` : `(${value} ?? [])`;
  if (shape === 'scalar' && expressionIsPresent(expression)) return `[${value}]`;
  if (projection) return `rune.list(${value})`;
  const parameter = typescript ? '<const T>(value: T)' : '(value)';
  if (shape === 'scalar') return `(${parameter} => value == null ? [] : [value])(${value})`;
  return `(${parameter} => value == null ? [] : [value].flat())(${value})`;
}

export function nativeCount(value: string, expression?: RosettaExpression, implicitMany?: boolean): string {
  const shape = expression
    ? collectionShape(expression)
    : implicitMany === undefined
      ? 'unknown'
      : implicitMany
        ? 'array'
        : 'scalar';
  if (shape === 'array') return `(${parenthesizeReceiver(value)}?.length ?? 0)`;
  if (shape === 'scalar') return `(${value} == null ? 0 : 1)`;
  return `((value) => Array.isArray(value) ? value.length : value == null ? 0 : 1)(${value})`;
}

/** A many-to-single conversion is an authored cardinality operation, not input validation. */
export function nativeSingle(
  value: string,
  expression?: RosettaExpression,
  typescript = false,
  projection = false
): string {
  if (collectionShape(expression) === 'scalar') return value;
  if (projection) return `rune.single(${value})`;
  const parameter = typescript ? '<const T>(value: T)' : '(value)';
  return `(${parameter} => { if (value == null) return undefined; const values = [value].flat(); if (values.length > 1) throw new Error('Expected at most one value'); return values[0]; })(${value})`;
}

/** Collection extraction retains groups until an explicit flatten or an array boundary. */
export function collectionDepth(
  expression: RosettaExpression | undefined,
  seen = new Set<RosettaExpression>()
): number {
  if (!expression || seen.has(expression)) return 0;
  seen.add(expression);
  const depth = (node: RosettaExpression | undefined) => collectionDepth(node, new Set(seen));
  const binding = inlineBindingArgument(expression);
  if (binding) return Math.max(0, depth(binding.argument) - (binding.element ? 1 : 0));
  if (elementSelectors.has(expression.$type)) return Math.max(0, depth(getOperationArgument(expression)) - 1);
  if (isReduceOperation(expression))
    return Math.max(0, depth(getOperationArgument(expression)) - 1, depth(expression.function?.body));
  if (isListLiteral(expression)) return Math.max(1, ...expression.elements.map(depth));
  if (isMapOperation(expression)) {
    if (!expression.function) return depth(getOperationArgument(expression));
    return (
      (!getOperationArgument(expression) || expressionIsMany(getOperationArgument(expression)) ? 1 : 0) +
      depth(expression.function?.body)
    );
  }
  if (expression.$type === 'FlattenOperation') return Math.max(1, depth(getOperationArgument(expression)) - 1);
  if (['FilterOperation', 'SortOperation', 'ReverseOperation', 'DistinctOperation'].includes(expression.$type))
    return depth(getOperationArgument(expression)) || 1;
  if (isThenOperation(expression)) return depth(expression.function?.body ?? getOperationArgument(expression));
  if (isRosettaConditionalExpression(expression))
    return Math.max(0, ...valueBranches([expression.ifthen, expression.elsethen]).map(depth));
  if (isDefaultOperation(expression))
    return Math.max(0, ...valueBranches([expression.left, expression.right]).map(depth));
  if (isSwitchOperation(expression))
    return Math.max(0, ...valueBranches(expression.cases.map((branch) => branch.expression)).map(depth));
  if (isRosettaSymbolReference(expression)) {
    const target = expression.symbol.ref;
    if (isShortcutDeclaration(target) || isRosettaRule(target)) return depth(target.expression);
  }
  return expressionIsMany(expression) ? 1 : 0;
}
