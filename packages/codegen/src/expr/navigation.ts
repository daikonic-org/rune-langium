// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  getOperationArgument,
  getChoiceOptionPaths,
  resolveOperationType,
  resolveTypeAliases,
  isAttribute,
  isChoice,
  isChoiceOption,
  isData,
  isRosettaRecordFeature,
  isRosettaRecordType,
  isRosettaSymbolReference,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaConstructorExpression,
  isRosettaFunction,
  isRosettaEnumValue,
  isShortcutDeclaration,
  isRosettaOnlyElement,
  isRosettaConditionalExpression,
  isDefaultOperation,
  isInlineFunction,
  isClosureParameter,
  isFilterOperation,
  isMapOperation,
  isSortOperation,
  isReverseOperation,
  isDistinctOperation,
  isFlattenOperation,
  isListLiteral,
  isThenOperation,
  isSwitchOperation,
  type RosettaDeepFeatureCall,
  type RosettaExpression,
  type RosettaType,
  type TypeCall,
  type Attribute,
  type ChoiceOption,
  type RosettaRecordFeature,
  type IntrinsicTypeName,
  type Choice
} from '@rune-langium/core';
import { AstUtils } from 'langium';
import { choiceOptionFieldName } from '../emit/base-namespace-emitter.js';
import { functionOutput } from '../types/func.js';

type Feature = Attribute | ChoiceOption | RosettaRecordFeature;

export type ExpressionType = RosettaType | { $type: 'IntrinsicType'; name: IntrinsicTypeName };

export function resolveType(call: TypeCall | undefined, seen: Set<RosettaType> = new Set()): RosettaType | undefined {
  return resolveTypeAliases(call?.type?.ref, seen);
}

export function featureIsMany(feature: Feature | undefined): boolean {
  const card = feature && 'card' in feature ? feature.card : undefined;
  return card?.unbounded === true || (card?.sup ?? 1) > 1;
}

function featureMatches(candidate: Feature, target: Feature): boolean {
  if (candidate === target) return true;
  if (featureName(candidate) !== featureName(target)) return false;
  const candidateType = resolveType(candidate.typeCall);
  const targetType = resolveType(target.typeCall);
  if (!candidateType || candidateType !== targetType) return false;
  const candidateCard = 'card' in candidate ? candidate.card : undefined;
  const targetCard = 'card' in target ? target.card : undefined;
  return (
    candidateCard?.inf === targetCard?.inf &&
    candidateCard?.sup === targetCard?.sup &&
    candidateCard?.unbounded === targetCard?.unbounded
  );
}

function choiceOptionType(
  choice: Choice,
  optionName: string,
  seen: Set<RosettaType> = new Set()
): RosettaType | undefined {
  if (seen.has(choice)) return undefined;
  const nextSeen = new Set(seen).add(choice);
  const wanted = choiceOptionFieldName(optionName.split('.').pop()!);
  for (const feature of typeFeatures(choice)) {
    const featureType = resolveType(feature.typeCall);
    if (featureName(feature) === wanted && featureType) return featureType;
    if (isChoice(featureType)) {
      const nested = choiceOptionType(featureType, optionName, nextSeen);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function featureIsRequired(feature: Feature): boolean {
  const card = 'card' in feature ? feature.card : undefined;
  return card?.inf !== undefined && card.inf > 0;
}

/** Whether evaluating an expression can produce a collection. */
export function expressionIsMany(
  expr: RosettaExpression | undefined,
  visiting = new Set<RosettaExpression>()
): boolean {
  if (!expr || visiting.has(expr)) return false;
  visiting.add(expr);
  const from = (value: RosettaExpression | undefined) => expressionIsMany(value, visiting);
  try {
    if (isRosettaOnlyElement(expr)) return false;
    if (expr.$type === 'AsOperation') return from(getOperationArgument(expr));
    if (
      isFilterOperation(expr) ||
      isMapOperation(expr) ||
      isSortOperation(expr) ||
      isReverseOperation(expr) ||
      isDistinctOperation(expr) ||
      isFlattenOperation(expr)
    )
      return true;
    if (isListLiteral(expr)) return expr.elements.length > 0;
    if (isRosettaDeepFeatureCall(expr)) {
      return from(expr.receiver) || deepNavigationPaths(expr).some((path) => path.some(featureIsMany));
    }
    if (isRosettaFeatureCall(expr)) {
      return featureIsMany(expr.feature?.ref as Feature | undefined) || from(expr.receiver);
    }
    if (isRosettaSymbolReference(expr)) {
      const ref = expr.symbol?.ref;
      const owner = AstUtils.getContainerOfType(expr, isInlineFunction);
      if (owner && isThenOperation(owner.$container)) {
        const argument = getOperationArgument(owner.$container);
        if (
          isClosureParameter(ref) ||
          ((isAttribute(ref) || isRosettaRecordFeature(ref)) && typeFeatures(expressionType(argument)).includes(ref))
        )
          return from(argument) || featureIsMany(isAttribute(ref) || isRosettaRecordFeature(ref) ? ref : undefined);
      }
      if (isRosettaFunction(ref)) return featureIsMany(functionOutput(ref));
      if (isShortcutDeclaration(ref)) return from(ref.expression);
      return featureIsMany(ref as Feature | undefined);
    }
    if (expr.$type === 'RosettaImplicitVariable') {
      const owner = AstUtils.getContainerOfType(expr, isInlineFunction);
      return !!owner && isThenOperation(owner.$container) && from(getOperationArgument(owner.$container));
    }
    if (isThenOperation(expr)) {
      return expr.function ? from(expr.function.body) : from(expr.argument);
    }
    if (isRosettaConditionalExpression(expr)) return from(expr.ifthen) || from(expr.elsethen);
    if (isDefaultOperation(expr)) return from(expr.left) || from(expr.right);
    if (isSwitchOperation(expr))
      return expr.cases.some(
        (branch) =>
          !(isListLiteral(branch.expression) && branch.expression.elements.length === 0) && from(branch.expression)
      );
    return false;
  } finally {
    visiting.delete(expr);
  }
}

export function expressionType(
  expr: RosettaExpression | undefined,
  visiting = new Set<RosettaExpression>()
): ExpressionType | undefined {
  if (!expr || visiting.has(expr)) return undefined;
  visiting.add(expr);
  const from = (value: RosettaExpression | undefined) => expressionType(value, visiting);
  try {
    if (isRosettaConstructorExpression(expr)) return from(expr.typeRef);
    if (isRosettaSymbolReference(expr)) {
      const ref = expr.symbol?.ref;
      if (isData(ref) || isChoice(ref) || isRosettaRecordType(ref)) return ref;
      if (isAttribute(ref) || isChoiceOption(ref) || isRosettaRecordFeature(ref)) return resolveType(ref.typeCall);
      if (isRosettaFunction(ref)) return resolveType(functionOutput(ref)?.typeCall);
      if (isShortcutDeclaration(ref)) return from(ref.expression);
    }
    if (expr.$type === 'RosettaImplicitVariable') {
      // `item` is commonly wrapped by one or more feature calls before it is
      // consumed. Walk the linked containment chain to recover the switch case
      // type instead of relying on the immediate container shape.
      const visited = new Set<object>();
      let owner: unknown = expr.$container;
      while (owner && typeof owner === 'object' && !visited.has(owner)) {
        visited.add(owner);
        if ((owner as { $type?: string }).$type === 'SwitchCaseOrDefault') {
          const target = (owner as { guard?: { referenceGuard?: { ref?: unknown } } }).guard?.referenceGuard?.ref;
          if (isData(target) || isChoice(target)) return target;
          // A bare Choice option can be shadowed by an enum value with the same
          // spelling (for example `Index`). Recover the declared option type
          // from the switch argument rather than treating that link as final.
          const operation = (owner as { $container?: unknown }).$container;
          if (isSwitchOperation(operation)) {
            const input = from(operation.argument);
            const targetName =
              (target && typeof target === 'object' && 'name' in target && typeof target.name === 'string'
                ? target.name
                : undefined) ??
              operation.cases.find((currentCase) => currentCase.guard?.referenceGuard?.ref === target)?.guard
                ?.referenceGuard?.$refText;
            if (isChoice(input) && targetName) {
              const optionType = choiceOptionType(input, targetName);
              if (isData(optionType) || isChoice(optionType)) return optionType;
            }
          }
        }
        if (isInlineFunction(owner)) {
          const parent = owner.$container;
          if (parent && typeof parent === 'object' && 'argument' in parent) {
            return from(getOperationArgument(parent));
          }
        }
        owner = (owner as { $container?: unknown }).$container;
      }
    }
    if (isRosettaFeatureCall(expr) || isRosettaDeepFeatureCall(expr)) {
      const ref = expr.feature?.ref;
      if (isAttribute(ref) || isChoiceOption(ref) || isRosettaRecordFeature(ref)) return resolveType(ref.typeCall);
    }
    return resolveOperationType<ExpressionType>(
      expr,
      from,
      (type) => type,
      (name) => ({ $type: 'IntrinsicType', name })
    );
  } finally {
    visiting.delete(expr);
  }
}

export function typeFeatures(type: ExpressionType | undefined, seen: Set<RosettaType> = new Set()): Feature[] {
  if (!type || type.$type === 'IntrinsicType' || seen.has(type)) return [];
  seen.add(type);
  if (isRosettaRecordType(type)) return type.features;
  if (isChoice(type)) return type.attributes;
  if (!isData(type)) return [];
  const inherited = typeFeatures(type.superType?.ref, seen);
  return [...new Map([...inherited, ...type.attributes].map((feature) => [featureName(feature), feature])).values()];
}

export function featureName(feature: Feature): string {
  if (!isChoiceOption(feature)) return feature.name;
  const typeRef = feature.typeCall.type;
  const typeName = typeRef.ref?.name ?? typeRef.$refText ?? '?';
  return choiceOptionFieldName(typeName.split('.').pop()!);
}

/** Calendar reads use native Temporal fields in TS and ISO adapters at JSON schema boundaries. */
export function renderCalendarField(
  feature: unknown,
  receiver: () => string,
  many = false,
  temporal = false,
  required = false
): string | undefined {
  if (
    !isRosettaRecordFeature(feature) ||
    !isRosettaRecordType(feature.$container) ||
    !['date', 'dateTime', 'zonedDateTime'].includes(feature.$container.name)
  )
    return undefined;
  const field =
    feature.name === 'date'
      ? 'toPlainDate()'
      : feature.name === 'time'
        ? 'toPlainTime()'
        : feature.name === 'timezone'
          ? 'timeZoneId'
          : feature.name;
  const temporalType =
    feature.$container.name === 'date'
      ? 'PlainDate'
      : feature.$container.name === 'dateTime'
        ? 'PlainDateTime'
        : 'ZonedDateTime';
  const read = (value: string, knownPresent: boolean) =>
    temporal
      ? knownPresent
        ? `${value}.${field}`
        : `(${value} as Temporal.${temporalType} | undefined)?.${field}`
      : `rune.dateField(${value}, ${JSON.stringify(feature.$container.name)}, ${JSON.stringify(feature.name)})`;
  const value = receiver();
  return many ? `rune.list(${value}).flatMap((value) => rune.list(${read('value', true)}))` : read(value, required);
}

export function deepFeaturePaths(
  type: ExpressionType | undefined,
  name: string,
  seen: Set<RosettaType> = new Set(),
  target?: Feature
): Feature[][] {
  if (!type || type.$type === 'IntrinsicType' || seen.has(type)) return [];
  const features = typeFeatures(type);
  const direct = features.filter(
    (feature) => featureName(feature) === name && (!target || featureMatches(feature, target))
  );
  if (direct.length > 0) return direct.map((feature) => [feature]);
  const nextSeen = new Set(seen).add(type);
  const paths = features.flatMap((feature) =>
    deepFeaturePaths(resolveType(feature.typeCall), name, nextSeen, target).map((path) => [feature, ...path])
  );
  return [...new Map(paths.map((path) => [path.map(featureName).join('\u0000'), path])).values()];
}

function deepNavigationPaths(expr: RosettaDeepFeatureCall): Feature[][] {
  const feature = expr.feature?.ref;
  const target =
    isAttribute(feature) || isChoiceOption(feature) || isRosettaRecordFeature(feature) ? feature : undefined;
  const name = target ? featureName(target) : expr.feature?.$refText;
  return name ? deepFeaturePaths(expressionType(expr.receiver), name, new Set(), target) : [];
}

export function typeMatches(
  candidate: RosettaType | undefined,
  goal: RosettaType,
  seen = new Set<RosettaType>()
): boolean {
  if (!candidate || seen.has(candidate)) return false;
  if (candidate === goal) return true;
  seen.add(candidate);
  return isData(candidate) && typeMatches(candidate.superType?.ref, goal, seen);
}

/** Find paths from a Choice's declared option keys to a guarded type. */
export function choiceOptionPaths(choice: Choice, goal: RosettaType, exact = false): string[][] {
  const paths = getChoiceOptionPaths(choice)
    .filter((path) => {
      const declared = path[path.length - 1]!.typeCall.type.ref;
      return (
        declared === goal || (!exact && typeMatches(resolveTypeAliases(declared), resolveTypeAliases(goal) ?? goal))
      );
    })
    .map((path) => path.map(featureName));
  if (!exact && typeMatches(choice, goal)) paths.unshift([]);
  return [...new Map(paths.map((path) => [path.join('\u0000'), path])).values()];
}

/** Project a path while retaining TypeScript's union narrowing at each choice arm. */
export function renderFeaturePath(receiver: string, path: readonly string[], many = false): string {
  if (path.length === 0) return receiver;
  // Keep the emitted expression linear in the path length. Each step is
  // wrapped once; the previous implementation recursively rendered the
  // suffix in both object and array branches, which was exponential for
  // deeply nested corpus paths.
  let result = receiver;
  for (const key of path) {
    const field = JSON.stringify(key);
    const access = `__value != null && (typeof __value === 'object' || typeof __value === 'function') && ${field} in __value ? __value[${field}] : undefined`;
    if (!many) {
      result = `((__value) => ${access})(${result})`;
      continue;
    }
    result = `rune.list(${result}).flatMap((__value) => rune.list(${access}))`;
  }
  return result;
}

export function renderNavigation(
  expr: RosettaExpression,
  render: (expr: RosettaExpression) => string
): string | undefined {
  if (!isRosettaFeatureCall(expr) && !isRosettaDeepFeatureCall(expr)) return undefined;
  const feature = expr.feature?.ref;
  if (isRosettaEnumValue(feature)) return JSON.stringify(feature.name);
  const name = isChoiceOption(feature)
    ? featureName(feature)
    : (expr.feature?.$refText ?? (feature && 'name' in feature ? feature.name : undefined));
  if (!name || !expr.receiver) return undefined;
  const receiver = render(expr.receiver);
  if (isRosettaDeepFeatureCall(expr)) {
    const paths = deepNavigationPaths(expr);
    if (paths.length === 0) return undefined;
    const many = expressionIsMany(expr);
    if (!many && paths.every((path) => path.every((feature) => !isChoiceOption(feature)))) {
      const read = (root: string, path: Feature[]) =>
        `${root}${path.map((feature) => `?.${featureName(feature)}`).join('')}`;
      if (paths.length === 1) return read(receiver, paths[0]!);
      return `((__root) => ${paths.map((path) => read('__root', path)).join(' ?? ')})(${receiver})`;
    }
    const projections = paths.map((path) => renderFeaturePath('__root', path.map(featureName), many));
    const projected = many ? `[${projections.map((value) => `...${value}`).join(', ')}]` : projections.join(' ?? ');
    return `((__root) => ${projected})(${receiver})`;
  }
  if (isChoice(expressionType(expr.receiver)) || expressionIsMany(expr.receiver)) {
    return renderFeaturePath(receiver, [name], expressionIsMany(expr));
  }
  return `${receiver}?.${name}`;
}
