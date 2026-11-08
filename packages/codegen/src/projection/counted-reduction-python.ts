// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { CountedReduction } from '../expr/counted-reduction.js';
import { pythonCollection, pythonFresh, type PythonRender, type PythonRenderContext } from './python-operations.js';

/** Python consumes the same structural proof as TypeScript, retaining its collection admission. */
export function renderCountedReductionPython(
  plan: CountedReduction,
  ctx: PythonRenderContext,
  render: PythonRender
): string {
  const values = pythonFresh(ctx, 'indexed_values'),
    index = pythonFresh(ctx, 'indexed_position');
  const overrides = new Map(ctx.expressionOverrides);
  overrides.set(plan.counterUpdate, `float(len(${values}))`);
  const child = { ...ctx, expressionOverrides: overrides };
  const source = `list(${pythonCollection(render(plan.source, ctx), plan.source)})`;
  const seed = render(plan.seed, ctx);
  if (plan.kind === 'lookup') {
    overrides.set(
      plan.selection,
      `(${values}[int(${index})] if isinstance(${index}, (int, float)) and 0 <= ${index} < len(${values}) and ${index} == int(${index}) else None)`
    );
    return `(lambda ${values}, ${index}: ${render(plan.body, child)} if ${values} else ${seed})(${source}, ${render(plan.index, ctx)})`;
  }
  const item = pythonFresh(ctx, 'indexed_item'),
    row = pythonFresh(ctx, 'indexed_row');
  for (const read of plan.counterReads) overrides.set(read, `float(${index})`);
  for (const read of plan.itemReads) overrides.set(read, item);
  const append = pythonCollection(render(plan.append, child), plan.append);
  overrides.set(plan.collection, `[${row} for ${index}, ${item} in enumerate(${values}) for ${row} in ${append}]`);
  return `(lambda ${values}: ${render(plan.body, child)} if ${values} else ${seed})(${source})`;
}
