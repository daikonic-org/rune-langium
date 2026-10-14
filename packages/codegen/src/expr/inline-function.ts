// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { getOperationArgument, isRosettaExpression, type InlineFunction } from '@rune-langium/core';
import {
  expressionType,
  expressionIsMany,
  typeFeatures,
  featureName,
  featureIsMany,
  renderFeaturePath,
  renderCalendarField,
  type ExpressionType
} from './navigation.js';
import { fieldMetadataKind, unwrapMetadata } from './metadata-runtime.js';
import { RUNE_HELPER_NAMES } from '../helpers.js';
import type { ExpressionTranspilerContext } from './transpiler.js';

export function freshLocal(ctx: ExpressionTranspilerContext, preferred: string): string {
  const names = new Set<string>([...RUNE_HELPER_NAMES, ...(ctx.localBindings?.values() ?? [])]);
  names.add(ctx.selfName);
  let name = preferred;
  for (let suffix = 1; names.has(name); suffix++) name = `${preferred}${suffix}`;
  return name;
}

export function bindImplicitFeatures(
  ctx: ExpressionTranspilerContext,
  type: ExpressionType | undefined,
  many = false
): ExpressionTranspilerContext {
  const bindings = new Map(ctx.localBindings);
  const localMetadata = new Map(ctx.localMetadata);
  const receiver = ctx.implicitMetadata ? unwrapMetadata(ctx.selfName, ctx.implicitMetadata.many) : ctx.selfName;
  for (const field of typeFeatures(type)) {
    const name = featureName(field);
    bindings.set(
      name,
      renderCalendarField(field, () => receiver, many, ctx.emitMode.startsWith('ts-')) ??
        renderFeaturePath(receiver, [name], many || featureIsMany(field), ctx.emitMode.startsWith('ts-'))
    );
    const kind = 'annotations' in field ? fieldMetadataKind(field) : undefined;
    localMetadata.set(name, kind ? { kind, many: many || featureIsMany(field) } : undefined);
  }
  return { ...ctx, localBindings: bindings, localMetadata };
}

export function inlineContext(
  fn: InlineFunction,
  ctx: ExpressionTranspilerContext,
  names: readonly string[],
  implicitMetadata?: ExpressionTranspilerContext['implicitMetadata']
): ExpressionTranspilerContext {
  const bindings = new Map([...ctx.attributeTypes.keys()].map((name) => [name, `${ctx.selfName}.${name}`]));
  for (const [name, value] of ctx.localBindings ?? []) bindings.set(name, value);
  const localMetadata = new Map(ctx.localMetadata);
  fn.parameters.forEach((parameter, index) => {
    bindings.set(parameter.name, names[index] ?? names[0]!);
    localMetadata.set(parameter.name, implicitMetadata);
  });
  const result = { ...ctx, selfName: names[0]!, localBindings: bindings, localMetadata, implicitMetadata };
  if (fn.parameters.length === 0 && isRosettaExpression(fn.$container)) {
    const argument = getOperationArgument(fn.$container);
    return bindImplicitFeatures(
      result,
      expressionType(argument),
      fn.$container.$type === 'ThenOperation' && expressionIsMany(argument)
    );
  }
  return result;
}

/** An object-valued arrow expression must not be parsed as a statement block. */
export function arrowBody(expression: string): string {
  return expression.trimStart().startsWith('{') ? `(${expression})` : expression;
}
