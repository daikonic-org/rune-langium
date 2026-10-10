// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isArithmeticOperation,
  isEqualityOperation,
  isComparisonOperation,
  isLogicalOperation,
  isRosettaExistsExpression,
  isRosettaAbsentExpression,
  isAttribute,
  isInlineFunction,
  type Attribute,
  isRosettaBooleanLiteral,
  isRosettaFeatureCall,
  isRosettaIntLiteral,
  isRosettaNumberLiteral,
  isRosettaFunction,
  isRosettaEnumValue,
  isRosettaEnumeration,
  isRosettaConstructorExpression,
  isRosettaConditionalExpression,
  isRosettaStringLiteral,
  isRosettaSymbolReference,
  isShortcutDeclaration,
  type RosettaExpression,
  type TypeCall
} from '@rune-langium/core';
import { AstUtils } from 'langium';
import { expressionIsMany, expressionType, featureIsRequired } from './navigation.js';
import { hasFieldMetadata } from './metadata-runtime.js';
import { resolveTypeCallTarget, type TypeIndexLookup } from '../emit/type-ref-resolver.js';
import { functionOutput } from '../types/func.js';

export const temporalScalarTypes = {
  date: 'PlainDate',
  time: 'PlainTime',
  dateTime: 'PlainDateTime',
  zonedDateTime: 'ZonedDateTime'
} as const;
type TemporalKind = keyof typeof temporalScalarTypes;
type ScalarKind = 'number' | 'string' | 'boolean' | TemporalKind;

const linkedTypes: TypeIndexLookup = {
  enumByName: new Map(),
  dataByName: new Map(),
  choiceByName: new Map(),
  typeAliasByName: new Map()
};

function primitiveKind(name: string | undefined): ScalarKind | undefined {
  if (name && name in temporalScalarTypes) return name as TemporalKind;
  return name === 'int' || name === 'number' ? 'number' : name === 'string' || name === 'boolean' ? name : undefined;
}

/** Use the same declared type resolution as function signatures, including built-ins without loaded source. */
export function declaredScalarKind(call: TypeCall | undefined): ScalarKind | undefined {
  return resolveTypeCallTarget(
    call,
    linkedTypes,
    {
      onPrimitive: primitiveKind,
      onEnum: () => 'string',
      onData: () => undefined,
      onChoice: () => undefined,
      onUnresolved: () => undefined
    },
    ''
  );
}

function scalarKind(expression: RosettaExpression | undefined): ScalarKind | undefined {
  if (isRosettaBooleanLiteral(expression)) return 'boolean';
  if (
    isRosettaStringLiteral(expression) ||
    (isRosettaSymbolReference(expression) && isRosettaEnumValue(expression.symbol.ref))
  )
    return 'string';
  if (isRosettaIntLiteral(expression) || isRosettaNumberLiteral(expression)) return 'number';
  const type = expressionType(expression);
  if (isRosettaEnumeration(type)) return 'string';
  const primitive = primitiveKind(type?.name);
  if (primitive) return primitive;
  const declaration = isRosettaSymbolReference(expression)
    ? expression.symbol.ref
    : isRosettaFeatureCall(expression)
      ? expression.feature?.ref
      : undefined;
  const call = isAttribute(declaration)
    ? declaration.typeCall
    : isRosettaFunction(declaration)
      ? functionOutput(declaration)?.typeCall
      : undefined;
  return declaredScalarKind(call);
}

/** Inputs and the current validated Data record are safe; guarded implicit lookups are not. */
export function attributeReferenceIsValidated(expression: RosettaExpression, attribute: Attribute): boolean {
  return isRosettaFunction(attribute.$container)
    ? attribute.$containerProperty === 'inputs'
    : !AstUtils.getContainerOfType(expression, isRosettaFunction) &&
        !AstUtils.getContainerOfType(expression, isInlineFunction);
}

/** Presence is independent of whether a required receiver is an object or a primitive. */
export function expressionIsPresent(
  expression: RosettaExpression | undefined,
  visiting = new Set<RosettaExpression>()
): boolean {
  if (!expression || visiting.has(expression) || expressionIsMany(expression)) return false;
  visiting.add(expression);
  try {
    if (isRosettaSymbolReference(expression)) {
      const declaration = expression.symbol.ref;
      if (isShortcutDeclaration(declaration)) return expressionIsPresent(declaration.expression, visiting);
      return (
        isAttribute(declaration) &&
        attributeReferenceIsValidated(expression, declaration) &&
        featureIsRequired(declaration) &&
        !hasFieldMetadata(declaration)
      );
    }
    if (isRosettaFeatureCall(expression)) {
      const declaration = expression.feature?.ref;
      if (isRosettaEnumValue(declaration)) return true;
      return (
        isAttribute(declaration) &&
        featureIsRequired(declaration) &&
        !hasFieldMetadata(declaration) &&
        expressionIsPresent(expression.receiver, visiting)
      );
    }
    return (
      isRosettaBooleanLiteral(expression) ||
      isRosettaStringLiteral(expression) ||
      isRosettaIntLiteral(expression) ||
      isRosettaNumberLiteral(expression) ||
      isEqualityOperation(expression) ||
      isComparisonOperation(expression) ||
      isLogicalOperation(expression) ||
      isRosettaExistsExpression(expression) ||
      isRosettaAbsentExpression(expression) ||
      isRosettaConstructorExpression(expression) ||
      requiredScalarKind(expression) !== undefined
    );
  } finally {
    visiting.delete(expression);
  }
}

/** Prove a non-null primitive using linked declarations, never identifier spelling. */
export function requiredScalarKind(
  expression: RosettaExpression | undefined,
  visiting = new Set<RosettaExpression>()
): ScalarKind | undefined {
  if (!expression || visiting.has(expression) || expressionIsMany(expression)) return undefined;
  visiting.add(expression);
  const primitive = scalarKind(expression);
  try {
    if (isRosettaBooleanLiteral(expression)) return 'boolean';
    if (isRosettaStringLiteral(expression)) return 'string';
    if (isRosettaIntLiteral(expression) || isRosettaNumberLiteral(expression)) return 'number';
    if (isRosettaSymbolReference(expression)) {
      const declaration = expression.symbol.ref;
      if (isShortcutDeclaration(declaration)) return requiredScalarKind(declaration.expression, visiting);
      // Output cardinality is enforced at return, after potentially absent writes.
      // It cannot prove that the accumulator (or an alias of it) is initialized.
      if (
        isAttribute(declaration) &&
        isRosettaFunction(declaration.$container) &&
        declaration.$containerProperty === 'output'
      )
        return undefined;
      return isAttribute(declaration) &&
        attributeReferenceIsValidated(expression, declaration) &&
        featureIsRequired(declaration) &&
        !hasFieldMetadata(declaration)
        ? primitive
        : undefined;
    }
    if (isRosettaFeatureCall(expression)) {
      const declaration = expression.feature?.ref;
      // Required children of optional receivers can still be absent.
      if (!isAttribute(declaration) || !featureIsRequired(declaration) || hasFieldMetadata(declaration))
        return undefined;
      return expressionIsPresent(expression.receiver, visiting) ? primitive : undefined;
    }
    if (isArithmeticOperation(expression)) {
      const left = requiredScalarKind(expression.left, visiting);
      const right = requiredScalarKind(expression.right, visiting);
      if (left === right && (left === 'number' || (left === 'string' && expression.operator === '+'))) return left;
    }
    if (isRosettaConditionalExpression(expression)) {
      const thenKind = requiredScalarKind(expression.ifthen, visiting);
      return thenKind && thenKind === requiredScalarKind(expression.elsethen, visiting) ? thenKind : undefined;
    }
    return undefined;
  } finally {
    visiting.delete(expression);
  }
}

export function nativeScalarOperands(
  left: RosettaExpression | undefined,
  right: RosettaExpression
): ScalarKind | undefined {
  const kind = requiredScalarKind(left);
  return kind && kind === requiredScalarKind(right) ? kind : undefined;
}

/** Primitives, ISO calendar strings and enums retain native equality over validated JSON values. */
export function scalarEqualityOperands(
  left: RosettaExpression | undefined,
  right: RosettaExpression,
  isoDates = true
): ScalarKind | undefined {
  if (expressionIsMany(left) || expressionIsMany(right)) return undefined;
  const kind = scalarKind(left);
  if (!kind || kind !== scalarKind(right)) return undefined;
  return kind in temporalScalarTypes ? (isoDates ? 'string' : undefined) : kind;
}

/** Required calendar operands use native Temporal operations in TypeScript. */
export function nativeTemporalOperands(
  left: RosettaExpression | undefined,
  right: RosettaExpression
): TemporalKind | undefined {
  const kind = nativeScalarOperands(left, right);
  return kind && kind in temporalScalarTypes ? (kind as TemporalKind) : undefined;
}

/** Declared scalar computations follow the target language's equality conventions. */
export function nativeEqualityOperands(
  left: RosettaExpression | undefined,
  right: RosettaExpression,
  isoDates = true
): boolean {
  return scalarEqualityOperands(left, right, isoDates) !== undefined;
}
