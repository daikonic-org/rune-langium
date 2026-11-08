// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RosettaExpression, RosettaSymbol } from '@rune-langium/core';
import { countedLookupCalls, type CountedReduction } from './counted-reduction.js';
import type { ExpressionTranspilerContext } from './transpiler.js';
import { nativeCollection } from './collection-shape.js';
import { resolveFuncValueTypeTs } from '../types/func.js';
import { freshLocal } from './inline-function.js';

/** Lower proven counted folds while keeping all appended values private to this call. */
export function renderCountedReductionTs(
  plan: CountedReduction,
  ctx: ExpressionTranspilerContext,
  render: (expression: RosettaExpression, context: ExpressionTranspilerContext) => string
): string {
  const reserved = new Set(ctx.reservedLocalNames);
  const local = (name: string) => {
    const result = freshLocal({ ...ctx, reservedLocalNames: reserved }, name);
    reserved.add(result);
    return result;
  };
  const values = local('__indexedValues'),
    index = local('__indexedPosition');
  const state = resolveFuncValueTypeTs(plan.type, undefined, ctx.typeNameResolver);
  const element = resolveFuncValueTypeTs(plan.sourceField, undefined, ctx.typeNameResolver);
  const overrides = new Map(ctx.expressionOverrides);
  overrides.set(plan.counterUpdate, `${values}.length`);
  const child = { ...ctx, reservedLocalNames: reserved, expressionOverrides: overrides };
  // Rune extraction removes absent entries; snapshot before invoking any user body.
  const source = `rune.list(${render(plan.source, ctx)}).filter(value => value != null)`;
  const seed = render(plan.seed, ctx);
  if (plan.kind === 'lookup') {
    overrides.set(
      plan.selection,
      `(typeof ${index} === 'number' && Number.isInteger(${index}) && ${index} >= 0 && ${index} < ${values}.length ? ${values}[${index}] : undefined)`
    );
    return `((${values}: ${element}[], ${index}: unknown): ${state} => ${values}.length ? ${render(plan.body, child)} : ${seed})(${source}, ${render(plan.index, ctx)})`;
  }
  const rows = local('__indexedRows'),
    item = local('__indexedItem');
  for (const read of plan.counterReads) overrides.set(read, index);
  for (const read of plan.itemReads) overrides.set(read, `${values}[${index}]`);
  const captures: string[] = [];
  const prepared = new Map<RosettaSymbol, string>();
  for (const lookup of countedLookupCalls(plan, ctx.canInlineFunction)) {
    const symbol = lookup.source.symbol.ref;
    if (!symbol) continue;
    let captured = prepared.get(symbol);
    if (!captured) {
      captured = local('__indexedLookup');
      prepared.set(symbol, captured);
      captures.push(`const ${captured} = rune.list(${render(lookup.source, ctx)}).filter(value => value != null);`);
    }
    overrides.set(lookup.call, `${captured}[${index}]`);
  }
  const rowType = resolveFuncValueTypeTs(plan.field, undefined, ctx.typeNameResolver);
  const appended = nativeCollection(render(plan.append, child), plan.append, undefined, true);
  overrides.set(plan.collection, rows);
  return `((${values}: ${element}[]): ${state} => { if (${values}.length === 0) return ${seed}; ${captures.join(' ')} const ${rows}: ${rowType}[] = []; for (let ${index} = 0; ${index} < ${values}.length; ${index}++) { for (const ${item} of ${appended}) ${rows}.push(${item}); } return ${render(plan.body, child)}; })(${source})`;
}
