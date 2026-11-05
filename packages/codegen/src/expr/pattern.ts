// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getFunctionInputs,
  isAttribute,
  isChoiceOption,
  isConstructorKeyValuePair,
  isDefaultOperation,
  isListLiteral,
  isOperation,
  isRosettaConditionalExpression,
  isRosettaFunction,
  isRosettaStringLiteral,
  isRosettaSymbolReference,
  isRosettaBasicType,
  isSwitchCaseOrDefault,
  type RosettaExpression
} from '@rune-langium/core';
import type { AstNode } from 'langium';
import { resolveType } from './navigation.js';

function patternField(field: unknown): boolean {
  if (!isAttribute(field) && !isChoiceOption(field)) return false;
  const type = resolveType(field.typeCall);
  return isRosettaBasicType(type) && type.name === 'pattern';
}

/** A STRING only denotes a native pattern when its authored destination says so. */
export function patternLiteral(expression: RosettaExpression): string | undefined {
  if (!isRosettaStringLiteral(expression)) return;
  let current: AstNode = expression;
  while (current.$container) {
    const parent = current.$container;
    if (isSwitchCaseOrDefault(parent) && parent.expression === current) {
      current = parent.$container;
      continue;
    }
    if (isConstructorKeyValuePair(parent)) return patternField(parent.key.ref) ? expression.value : undefined;
    if (isOperation(parent)) {
      let field: unknown = parent.assignRoot.ref;
      for (let segment = parent.path; segment; segment = segment.next) field = segment.feature.ref;
      return patternField(field) ? expression.value : undefined;
    }
    if (isRosettaSymbolReference(parent) && isRosettaFunction(parent.symbol.ref)) {
      const index = parent.rawArgs.findIndex((argument) => argument === current);
      return patternField(getFunctionInputs(parent.symbol.ref)[index]) ? expression.value : undefined;
    }
    if (
      isListLiteral(parent) ||
      isDefaultOperation(parent) ||
      (isRosettaConditionalExpression(parent) && parent.if !== current)
    ) {
      current = parent;
      continue;
    }
    return;
  }
}

/** RegExp's own source escaping handles slashes, line breaks and the empty pattern. */
export function renderPatternLiteral(source: string): string {
  try {
    return new RegExp(source).toString();
  } catch {
    // Invalid patterns must fail when evaluated, rather than corrupt the module's syntax.
    return `new RegExp(${JSON.stringify(source)})`;
  }
}
