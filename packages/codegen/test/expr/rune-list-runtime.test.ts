// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { RUNTIME_HELPER_JS_SOURCE, runtimeHelperSource } from '../../src/helpers.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it.each(['javascript', 'inline-typescript', 'sidecar-typescript'])(
  'preserves collection behavior with the %s runtime',
  (mode) => {
    const assertions = `
const source = Object.freeze([{ amount: 2 }, { amount: 1 }, { amount: 2 }]);
const list = RuneList.from(...source);
const grouped = RuneList.from([1, 2], [3]);
const dates = RuneList.from(Temporal.PlainDate.from('2026-02-01'), Temporal.PlainDate.from('2026-01-01'));
return [list.count(), list.distinct().count(), list.sort(item => item.amount).first().amount,
 list.reverse().first().amount, source[0].amount, grouped.count(), grouped.flat().toArray(),
 list.isSupersetOf([]), list.isDisjointFrom([{amount: 3}]), list.has({amount: 1}),
 RuneList.from(1).onlyElement(), RuneList.from(1, 2).onlyElement(),
 RuneList.from(1, 2).sum(), RuneList.from().reduce((a, b) => a + b),
 dates.sort(item => item, Temporal.PlainDate.compare).first().toString(),
 JSON.parse(JSON.stringify(grouped)), list.toArray() !== source,
 runeExtract(undefined, () => { throw new Error('absent callback'); }),
 grouped.map(item => item).count()];`;
    const expected = [
      3,
      2,
      1,
      2,
      2,
      2,
      [1, 2, 3],
      false,
      true,
      true,
      1,
      undefined,
      3,
      undefined,
      '2026-01-01',
      [[1, 2], [3]],
      true,
      undefined,
      2
    ];
    if (mode === 'javascript')
      expect(new Function('Temporal', RUNTIME_HELPER_JS_SOURCE + '\n' + assertions)(Temporal)).toEqual(expected);
    else {
      const prefix = mode === 'sidecar-typescript' ? 'export ' : '';
      const content = `${runtimeHelperSource(true, mode === 'sidecar-typescript')}\n${prefix}function run() { ${assertions.replace('RuneList.from().reduce', 'RuneList.from<number>().reduce')} }\n${mode === 'sidecar-typescript' ? '' : 'export { run };'}`;
      const runtime = compileGeneratedTypeScript<{ run: () => unknown }>(
        [{ relativePath: 'runtime.ts', content, diagnostics: [], sourceMap: [], funcs: [] }],
        { checkTypes: true }
      );
      expect(runtime.run()).toEqual(expected);
    }
  }
);
