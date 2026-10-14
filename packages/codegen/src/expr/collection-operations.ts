// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { unwrapMetadata } from './metadata-runtime.js';
import { expressionMetadataKind } from './metadata-type.js';
import { inlineContext, freshLocal, arrowBody } from './inline-function.js';
import { nativeCollection } from './collection-shape.js';
import { primitiveElementKind, temporalScalarTypes } from './scalar-operators.js';

import {
  isFilterOperation,
  isMapOperation,
  isMaxOperation,
  isMinOperation,
  isSortOperation,
  type RosettaExpression
} from '@rune-langium/core';
import type { ExpressionTranspilerContext } from './transpiler.js';

type Render = (expr: RosettaExpression, ctx: ExpressionTranspilerContext) => string;

/** Renders collection operations whose inline function is part of the operation's semantics. */
export function renderCollectionOperation(
  expr: RosettaExpression,
  ctx: ExpressionTranspilerContext,
  render: Render
): string | undefined {
  const owned =
    isFilterOperation(expr) ||
    isMapOperation(expr) ||
    isSortOperation(expr) ||
    isMinOperation(expr) ||
    isMaxOperation(expr);
  if (!owned) return undefined;
  const argumentCtx =
    isMapOperation(expr) && expr.function && ctx.emitMode.startsWith('ts-') ? { ...ctx, preserveMetadata: true } : ctx;
  const argument = expr.argument ? render(expr.argument, argumentCtx) : ctx.selfName;
  const values = nativeCollection(argument, expr.argument, ctx.implicitMetadata?.many, ctx.emitMode.startsWith('ts-'));
  const kind = argumentCtx.preserveMetadata
    ? expr.argument
      ? expressionMetadataKind(expr.argument)
      : ctx.implicitMetadata?.kind
    : undefined;
  const metadata = kind ? { kind, many: false } : undefined;
  const fn = 'function' in expr ? expr.function : undefined;
  const param = freshLocal(ctx, fn?.parameters?.[0]?.name ?? 'item');
  const valueCtx = { ...ctx, preserveMetadata: false };
  const keyKind = primitiveElementKind(fn?.body ?? expr.argument);
  const temporal =
    ctx.emitMode.startsWith('ts-') && keyKind && keyKind in temporalScalarTypes
      ? temporalScalarTypes[keyKind as keyof typeof temporalScalarTypes]
      : undefined;
  const key = (name: string) =>
    fn ? render(fn.body, inlineContext(fn, valueCtx, [name], metadata)) : metadata ? unwrapMetadata(name, false) : name;
  if (isFilterOperation(expr) || isMapOperation(expr)) {
    const body = isFilterOperation(expr)
      ? key(param)
      : fn
        ? render(fn.body, inlineContext(fn, ctx, [param], metadata))
        : param;
    return isFilterOperation(expr)
      ? `${values}.filter((${param}) => ${arrowBody(body)})`
      : `${values}.flatMap((${param}) => ${nativeCollection(body, fn?.body, false, ctx.emitMode.startsWith('ts-'))})`;
  }
  if (isSortOperation(expr)) {
    const a = freshLocal(ctx, '__sortA');
    const b = freshLocal(ctx, '__sortB');
    const keyA = freshLocal(ctx, '__keyA');
    const keyB = freshLocal(ctx, '__keyB');
    const ka = key(a);
    const kb = key(b);
    return `${values}.slice().sort((${a}, ${b}) => { const ${keyA} = (${ka}); const ${keyB} = (${kb}); return ${nativeOrder(keyA, keyB, true, temporal)}; })`;
  }
  if (isMinOperation(expr) || isMaxOperation(expr)) {
    const item = freshLocal(ctx, '__item');
    const best = freshLocal(ctx, '__best');
    const values = freshLocal(ctx, '__values');
    const itemKey = key(item);
    const bestKey = key(best);
    const sign = isMinOperation(expr) ? '<' : '>';
    const itemKeyName = freshLocal(ctx, '__itemKey');
    const bestKeyName = freshLocal(ctx, '__bestKey');
    const input = nativeCollection(argument, expr.argument, ctx.implicitMetadata?.many, ctx.emitMode.startsWith('ts-'));
    return `(() => { const ${values} = ${input}; if (${values}.length === 0) return undefined; return ${values}.slice(1).reduce((${best}, ${item}) => { const ${itemKeyName} = (${itemKey}); const ${bestKeyName} = (${bestKey}); return ${nativeOrder(itemKeyName, bestKeyName, isMinOperation(expr), temporal)} ${sign} 0 ? ${item} : ${best}; }, ${values}[0]); })()`;
  }
  return undefined;
}

function nativeOrder(left: string, right: string, nullsLast = true, temporal?: string): string {
  const absent = nullsLast ? '1' : '-1';
  const present = nullsLast ? '-1' : '1';
  const comparison = temporal
    ? `Temporal.${temporal}.compare(${left}, ${right})`
    : `${left} < ${right} ? -1 : ${left} > ${right} ? 1 : 0`;
  return `(${left} == null ? ${right} == null ? 0 : ${absent} : ${right} == null ? ${present} : ${comparison})`;
}
