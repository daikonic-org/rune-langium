// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isAsOperation,
  isChoice,
  isChoiceOption,
  isAttribute,
  isLogicalOperation,
  isRosettaAbsentExpression,
  isRosettaExistsExpression,
  isRosettaFeatureCall,
  isRosettaSymbolReference,
  isShortcutDeclaration,
  type Condition,
  type RosettaExpression,
  type ShortcutDeclaration
} from '@rune-langium/core';
import { choiceOptionPaths, expressionIsMany, expressionType, featureName, type Feature } from './expr/navigation.js';

interface InputPath {
  path: string;
  // When this path exists, all sibling Choice arms on the way to it are excluded.
  otherArms: string[];
}

function inputPath(
  expression: RosettaExpression | undefined,
  roots: ReadonlySet<Feature>,
  aliases: ReadonlySet<ShortcutDeclaration>,
  visiting = new Set<ShortcutDeclaration>()
): InputPath | undefined {
  if (isRosettaSymbolReference(expression) && !expression.explicitArguments) {
    const symbol = expression.symbol.ref;
    if ((isAttribute(symbol) || isChoiceOption(symbol)) && roots.has(symbol))
      return { path: featureName(symbol), otherArms: [] };
    if (isShortcutDeclaration(symbol) && aliases.has(symbol) && !visiting.has(symbol))
      return inputPath(symbol.expression, roots, aliases, new Set(visiting).add(symbol));
  }
  if (isRosettaFeatureCall(expression) && !expressionIsMany(expression.receiver)) {
    const feature = expression.feature?.ref;
    const receiver = inputPath(expression.receiver, roots, aliases, visiting);
    if (!receiver || (!isAttribute(feature) && !isChoiceOption(feature))) return undefined;
    const choice = expressionType(expression.receiver);
    const otherArms =
      isChoice(choice) && isChoiceOption(feature) && choice.attributes.includes(feature)
        ? choice.attributes.filter((arm) => arm !== feature).map((arm) => receiver.path + '.' + featureName(arm))
        : [];
    return { path: receiver.path + '.' + featureName(feature), otherArms: [...receiver.otherArms, ...otherArms] };
  }
  if (isAsOperation(expression) && !expressionIsMany(expression.argument)) {
    const choice = expressionType(expression.argument);
    const target = expression.type.ref;
    const receiver = inputPath(expression.argument, roots, aliases, visiting);
    if (!receiver || !isChoice(choice) || !target) return undefined;
    const paths = choiceOptionPaths(choice, target);
    if (paths.length !== 1 || paths[0]!.length !== 1) return undefined;
    const selected = paths[0]![0]!;
    return {
      path: receiver.path + '.' + selected,
      otherArms: [
        ...receiver.otherArms,
        ...choice.attributes
          .map(featureName)
          .filter((arm) => arm !== selected)
          .map((arm) => receiver.path + '.' + arm)
      ]
    };
  }
  return undefined;
}

/** Find only field exclusions guaranteed by linked, unconditional presence tests. */
export function conditionExcludedPaths(
  conditions: readonly Condition[],
  fields: readonly Feature[],
  shortcuts: readonly ShortcutDeclaration[] = []
): string[] {
  const roots = new Set(fields);
  const aliases = new Set(shortcuts);
  function exclusions(expression: RosettaExpression | undefined): string[] {
    if (isLogicalOperation(expression)) {
      const left = exclusions(expression.left);
      const right = exclusions(expression.right);
      if (expression.operator === 'and') return [...left, ...right];
      if (expression.operator === 'or') return left.filter((path) => right.includes(path));
      return [];
    }
    if (isRosettaAbsentExpression(expression) || isRosettaExistsExpression(expression)) {
      const path = inputPath(expression.argument, roots, aliases);
      if (path) return isRosettaAbsentExpression(expression) ? [path.path] : path.otherArms;
    }
    return [];
  }
  return Array.from(
    new Set(
      conditions.filter((condition) => !condition.postCondition).flatMap(({ expression }) => exclusions(expression))
    )
  );
}
