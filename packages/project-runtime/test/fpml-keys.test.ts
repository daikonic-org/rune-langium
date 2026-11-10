// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { parseProjectPayload } from '@rune-langium/core/serialization';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  fpmlKeyCases as cases,
  fpmlKeyNamespace as namespace,
  publishFpmlKeyFixture
} from '../../../test/helpers/cdm-fpml-keys.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { fpmlKeyRecipes, prepareFpmlHashLayout } from '../src/curated-implementations/fpml-keys.js';

const functions = Object.keys(fpmlKeyRecipes);
const selection = {
  namespaces: [],
  declarations: [
    ...[...functions, 'CreateQuantityKey', 'CreateQuotedCurrencyPairKey'].map((name) => ({
      name,
      namespace,
      kind: 'RosettaFunction'
    })),
    { name: 'CrossRate', namespace: 'fpml.consolidated.fx', kind: 'Data' }
  ]
};
type KeyExports = Record<keyof typeof fpmlKeyRecipes, (...args: unknown[]) => unknown> & {
  CrossRate: { fromJSON(text: string, options: { preserveNumberText: boolean }): unknown };
  CreateQuotedCurrencyPairKey(input: unknown): string;
  CreateQuantityKey(id: string, leg: unknown): string;
};
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const { snapshot, published, fpml, sources } = await publishFpmlKeyFixture();
  expect(await prepareFpmlHashLayout([], fpml)).toBeUndefined();
  await expect(prepareFpmlHashLayout(sources, fpml)).rejects.toThrow('differs from the pinned Java hash layout');
  graph = await buildEffectiveProject(snapshot, published);
  expect(graph.diagnostics).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

it.each(['single-file', 'barrel'] as const)(
  'projects the Java key fixtures in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    expect(outputs.flatMap((output) => [...output.content.matchAll(/const \$rune\$fpmlKey =/g)])).toHaveLength(1);
    const execute = compileGeneratedTypeScript<KeyExports>(outputs, {
      entry: layout === 'barrel' ? 'index.ts' : 'model.ts'
    });
    for (const test of cases) {
      const value =
        parseProjectPayload(test.json, 'JSON', {
          preserveNumberText: test.preserveNumberText ?? true
        }) ?? undefined;
      const args = test.function === 'CreateKey' ? [test.prefix, test.keyId, value] : [test.prefix, value];
      expect(execute[test.function]!(...args), test.id).toBe(test.expected);
    }
    const { CrossRate, CreateKeyForQuotedCurrencyPair, CreateQuotedCurrencyPairKey, CreateQuantityKey, CreateKey } =
      execute;
    const input = CrossRate.fromJSON('{"rate":1.00,"currency1":{"value":"USD"},"currency2":{"value":"EUR"}}', {
      preserveNumberText: true
    });
    expect(CreateKeyForQuotedCurrencyPair('observable', input)).toBe('observable-$405');
    expect(CreateQuotedCurrencyPairKey(input)).toBe(CreateKeyForQuotedCurrencyPair('quotedCurrencyPair', input));
    const leg = { id: 'quantity-1' };
    expect(CreateQuantityKey('id', leg)).toBe(CreateKey('quantity', 'id', leg));
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('projects the same number cases in standalone Python', () => {
  const module = generatePythonModule(graph.documents);
  expect(module.diagnostics).toEqual([]);
  expect(module.code.match(/def _rune_fpml_key\(/g)).toHaveLength(1);
  const calls = cases.map((test) => {
    const name = module.bindings.get(namespace + '.' + test.function);
    const id = test.function === 'CreateKey' ? "data['keyId'], " : '';
    const decimal = test.preserveNumberText === false ? '' : ", parse_float=__import__('decimal').Decimal";
    return {
      expression: `${name}(data['prefix'], ${id}__import__('json').loads(data['json']${decimal}))`,
      data: test
    };
  });
  expect(runPython(calls, module.code, { includeRuntime: false })).toEqual(
    cases.map((test) => ({ value: test.expected }))
  );
});
