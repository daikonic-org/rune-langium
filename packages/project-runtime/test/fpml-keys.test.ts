// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { isRosettaModel, serializeRuneModel } from '@rune-langium/core';
import { parseProjectPayload } from '@rune-langium/core/serialization';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { referenceModelSources } from '../../codegen/test/helpers/cdm-reference.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { projectReferenceUri } from '../src/project-uri.js';
import { fpmlHashLayout, fpmlKeyRecipes, prepareFpmlHashLayout } from '../src/curated-implementations/fpml-keys.js';
import { publishCuratedImplementations } from '../src/curated-implementations/publication.js';

const fixture = new URL('../../../test/fixtures/third-party/cdm-fpml-keys/', import.meta.url);
const namespace = 'cdm.ingest.fpml.confirmation.pricequantity';
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
interface KeyCase {
  id: string;
  function: keyof typeof fpmlKeyRecipes;
  prefix: string;
  keyId?: string;
  json: string;
  expected: string;
}
type KeyExports = Record<KeyCase['function'], (...args: unknown[]) => unknown> & {
  CrossRate: { fromJSON(text: string, options: { preserveNumberText: boolean }): unknown };
  CreateQuotedCurrencyPairKey(input: unknown): string;
  CreateQuantityKey(id: string, leg: unknown): string;
};
const cases: KeyCase[] = JSON.parse(readFileSync(new URL('cases.json', fixture), 'utf8'));
const sources: { sources: { model: string; commit: string }[] } = JSON.parse(
  readFileSync(new URL('sources.json', fixture), 'utf8')
);
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const references = Object.entries(referenceModelSources(fileURLToPath(fixture))).flatMap(([model, files]) =>
    files.map(({ path, content }) => ({ model, uri: model + '/' + path, content }))
  );
  const snapshot = await createProjectSnapshot(
    'fpml-keys',
    new Map([
      ['rune-config.yml', 'model: {name: FpmlKeys}'],
      ['build-config.yml', 'schemaVersion: 1']
    ]),
    () => []
  );
  const linked = await buildEffectiveProject(snapshot, references);
  expect(linked.diagnostics).toEqual([]);
  const models = linked.documents.map((document) => document.parseResult.value).filter(isRosettaModel);
  const fpml = models.filter((model) => model.name.startsWith('fpml.consolidated.'));
  // This is a representative source slice. The inventory verifies the complete pinned layout.
  const layout = fpmlHashLayout(fpml);
  expect(await prepareFpmlHashLayout([], fpml)).toBeUndefined();
  await expect(prepareFpmlHashLayout(sources.sources, fpml)).rejects.toThrow(
    'differs from the pinned Java hash layout'
  );
  const byUri = new Map(linked.documents.map((document) => [document.uri.toString(true), document.parseResult.value]));
  const published = await Promise.all(
    references.map(async (reference) => {
      const model = byUri.get(projectReferenceUri(reference.uri));
      if (!isRosettaModel(model)) throw new Error('Missing linked fixture model ' + reference.uri);
      const commit = sources.sources.find((source) => source.model === reference.model)?.commit;
      if (!commit) throw new Error('Missing fixture origin ' + reference.model);
      const serialized = await publishCuratedImplementations(
        model,
        serializeRuneModel(linked.services.serializer.JsonSerializer, model),
        { model: reference.model, commit },
        { fpmlHashLayout: layout }
      );
      return { ...reference, serialized };
    })
  );
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
      const value = parseProjectPayload(test.json, 'JSON', { preserveNumberText: true }) ?? undefined;
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

it('projects the same exact-number cases in standalone Python', () => {
  const module = generatePythonModule(graph.documents);
  expect(module.diagnostics).toEqual([]);
  expect(module.code.match(/def _rune_fpml_key\(/g)).toHaveLength(1);
  const calls = cases.map((test) => {
    const name = module.bindings.get(namespace + '.' + test.function);
    const id = test.function === 'CreateKey' ? "data['keyId'], " : '';
    return {
      expression: `${name}(data['prefix'], ${id}__import__('json').loads(data['json'], parse_float=__import__('decimal').Decimal))`,
      data: test
    };
  });
  expect(runPython(calls, module.code, { includeRuntime: false })).toEqual(
    cases.map((test) => ({ value: test.expected }))
  );
});
