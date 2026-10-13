// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RuneFuncParam } from '../types/func.js';
import {
  isAttribute,
  isChoiceOption,
  isRosettaFeatureCall,
  isRosettaFunction,
  isRosettaSymbolReference,
  isShortcutDeclaration,
  isListLiteral,
  isRosettaConditionalExpression,
  isThenOperation,
  type RosettaExpression
} from '@rune-langium/core';
import { expressionIsMany } from './navigation.js';
import { expressionIsPresent, attributeReferenceIsValidated } from './scalar-operators.js';
import { hasFieldMetadata } from './metadata-runtime.js';

/** Reuse linked bounds when passing already validated values to another declaration. */
export function expressionFitsCardinality(
  expression: RosettaExpression | undefined,
  cardinality: RuneFuncParam['cardinality'],
  visiting = new Set<RosettaExpression>()
): boolean {
  if (!expression || visiting.has(expression)) return false;
  visiting.add(expression);
  try {
    const many = cardinality.upper === null || cardinality.upper > 1;
    if (expressionIsMany(expression) !== many) return false;
    if (!many && cardinality.lower <= 1 && (cardinality.upper ?? 1) >= 1 && expressionIsPresent(expression))
      return true;
    const feature = isRosettaSymbolReference(expression)
      ? expression.symbol.ref
      : isRosettaFeatureCall(expression)
        ? expression.feature?.ref
        : undefined;
    if (isShortcutDeclaration(feature)) return expressionFitsCardinality(feature.expression, cardinality, visiting);
    if (!isAttribute(feature) && !isChoiceOption(feature)) return false;
    if (isAttribute(feature) && isRosettaFunction(feature.$container) && feature.$containerProperty === 'output')
      return false;
    if (!('card' in feature)) return false;
    const card = feature.card;
    const lower =
      hasFieldMetadata(feature) ||
      (isRosettaSymbolReference(expression) &&
        isAttribute(feature) &&
        !attributeReferenceIsValidated(expression, feature)) ||
      (isRosettaFeatureCall(expression) && !expressionIsPresent(expression.receiver))
        ? 0
        : card.inf;
    return (
      lower >= cardinality.lower &&
      (cardinality.upper === null || (!card.unbounded && (card.sup ?? 1) <= cardinality.upper))
    );
  } finally {
    visiting.delete(expression);
  }
}

export function adaptCardinalityValue(
  value: string,
  cardinality: RuneFuncParam['cardinality'],
  label: string,
  expression?: RosettaExpression,
  typescript = false
): string {
  if (expressionFitsCardinality(expression, cardinality)) {
    return expressionIsMany(expression) ? collectionValue(value, expression) : value;
  }
  return normalizeCardinalityValue(value, cardinality, label, expression, typescript);
}

/** Collection-producing operations already return arrays; optional fields can be absent. */
export function collectionValue(value: string, expression: RosettaExpression | undefined): string {
  const present = (node: RosettaExpression | undefined): boolean => {
    if (!node) return false;
    if (isListLiteral(node)) return node.elements.length > 0;
    if (isThenOperation(node)) return present(node.function?.body ?? node.argument);
    if (isRosettaConditionalExpression(node)) return present(node.ifthen) && present(node.elsethen);
    return [
      'MapOperation',
      'FilterOperation',
      'SortOperation',
      'ReverseOperation',
      'DistinctOperation',
      'FlattenOperation'
    ].includes(node.$type);
  };
  return present(expression) ? value : `(${value} ?? [])`;
}

/** Shared runtime bounds for function arguments, outputs, and nested assignments. */
export function renderCardinalityChecks(
  value: string,
  cardinality: RuneFuncParam['cardinality'],
  many: boolean,
  minimumError: string,
  maximumError: string,
  arraySize = `${value}.length`
): string[] {
  const checks: string[] = [];
  if (cardinality.lower > 0) {
    const missing = many ? `${arraySize} < ${cardinality.lower}` : `${value} == null`;
    checks.push(`if (${missing}) throw new Error(${JSON.stringify(minimumError)});`);
  }
  const excess =
    cardinality.upper === null
      ? undefined
      : many
        ? `${arraySize} > ${cardinality.upper}`
        : cardinality.upper === 0
          ? `${value} != null`
          : undefined;
  if (excess) checks.push(`if (${excess}) throw new Error(${JSON.stringify(maximumError)});`);
  return checks;
}

/** Normalize collection values before checking their declared bounds. */
export function normalizeCardinalityValue(
  value: string,
  cardinality: RuneFuncParam['cardinality'],
  label: string,
  expression?: RosettaExpression,
  typescript = false
): string {
  const many = cardinality.upper === null || cardinality.upper > 1;
  const known =
    expression &&
    !(isRosettaSymbolReference(expression) && !expression.symbol.ref) &&
    !(isListLiteral(expression) && expression.elements.length === 0);
  const uniformCollection =
    expression &&
    !isRosettaConditionalExpression(expression) &&
    !isThenOperation(expression) &&
    !(isRosettaSymbolReference(expression) && isShortcutDeclaration(expression.symbol.ref));
  const sameCardinality = known && expressionIsMany(expression) === many && (!many || uniformCollection);
  value = sameCardinality
    ? many
      ? collectionValue(value, expression)
      : value
    : `${many ? 'rune.list' : 'rune.single'}(${value})`;
  const checks = renderCardinalityChecks(
    'value',
    cardinality,
    many,
    many ? `${label} has too few values` : `${label} requires a value`,
    `${label} has too many values`
  );
  return renderCheckedValue(value, checks, many, typescript, cardinality.upper === 0);
}

/** Preserve literal inference when checking an authored value's cardinality. */
export function renderCheckedValue(
  value: string,
  checks: readonly string[],
  many: boolean,
  typescript: boolean,
  absent = false
): string {
  if (!checks.length) return value;
  const parameter = typescript ? `<const T${many ? ' extends unknown[]' : ''}>(value: T)` : '(value)';
  return `(${parameter} => { ${checks.join(' ')} return ${absent ? 'undefined' : 'value'}; })(${value})`;
}
