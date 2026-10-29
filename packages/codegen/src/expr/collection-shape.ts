// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getOperationArgument,
  isAttribute,
  isChoiceOption,
  isRosettaFunction,
  isRosettaRule,
  isRosettaSymbolReference,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaEnumValue,
  isShortcutDeclaration,
  isListLiteral,
  isRosettaConditionalExpression,
  isThenOperation,
  isDefaultOperation,
  isSwitchOperation,
  type RosettaExpression
} from '@rune-langium/core';
import { expressionIsMany, featureIsMany } from './navigation.js';
import { expressionIsPresent } from './scalar-operators.js';
import { functionOutput } from '../types/func.js';
import { parenthesizeReceiver } from './syntax.js';

export type CollectionShape = 'scalar' | 'array' | 'mixed' | 'unknown';

/** A multi-valued expression may mix scalar and array branches; keep that distinction. */
export function collectionShape(
  expression: RosettaExpression | undefined,
  seen = new Set<RosettaExpression>()
): CollectionShape {
  if (!expression || seen.has(expression)) return 'unknown';
  seen.add(expression);
  const from = (node: RosettaExpression | undefined) => collectionShape(node, new Set(seen));
  const merge = (left: CollectionShape, right: CollectionShape) => (left === right ? left : 'mixed');
  if (isListLiteral(expression)) return 'array';
  if (isRosettaConditionalExpression(expression))
    return expression.elsethen ? merge(from(expression.ifthen), from(expression.elsethen)) : from(expression.ifthen);
  if (isDefaultOperation(expression)) return merge(from(expression.left), from(expression.right));
  if (isThenOperation(expression)) return from(expression.function?.body ?? expression.argument);
  if (isSwitchOperation(expression)) {
    const branches = expression.cases.map((branch) => from(branch.expression));
    return branches.length ? branches.reduce(merge) : 'unknown';
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
  if (expression.$type === 'ReduceOperation' || expression.$type === 'RosettaSuperCall') return 'unknown';
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
  return [
    'MapOperation',
    'FilterOperation',
    'SortOperation',
    'ReverseOperation',
    'DistinctOperation',
    'FlattenOperation'
  ].includes(expression.$type);
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
