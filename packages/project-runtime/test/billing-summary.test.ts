// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { buildEffectiveProject } from '../src/effective-project.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  billingCases,
  billingDeclaration,
  billingRecords,
  createCuratedBillingProject
} from '../../../test/helpers/cdm-billing-summary.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';

let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
beforeAll(async () => {
  const project = await createCuratedBillingProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

function nativeDates(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return Temporal.PlainDate.from(value);
  if (Array.isArray(value)) return value.map(nativeDates);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, field]) => [name, nativeDates(field)]));
  return value;
}

function expectedSummary(test: (typeof billingCases)[number]) {
  const record = billingRecords(test.inputs)[0]!;
  const [kind, transfer] = Object.entries(record.recordTransfer)[0]!;
  if (!('quantity' in transfer) || !transfer.quantity || !transfer.payerReceiver)
    throw new Error('Missing complete expected billing record: ' + test.id);
  const { asset, settlementDate, quantity, payerReceiver, ...classification } = transfer;
  return {
    summaryAmountType: 'ParentTotal',
    summaryTransfer: {
      [kind]: {
        asset,
        settlementDate,
        quantity: { value: test.expectedAmount, unit: quantity.unit },
        payerReceiver: {
          payerPartyReference: payerReceiver.payerPartyReference,
          receiverPartyReference: payerReceiver.receiverPartyReference
        },
        ...classification
      }
    }
  };
}

it(
  'sums complete CDM billing records and preserves parent references in strict TypeScript',
  async () => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: [billingDeclaration] },
      { target: 'typescript', strict: true, typescript: { layout: 'per-namespace' } }
    );
    expect(outputs.flatMap((output) => output.diagnostics.filter((item) => item.severity === 'error'))).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === billingDeclaration.name))!;
    const name = entry.funcs.find((fn) => fn.name === billingDeclaration.name)!.exportName!;
    const execute = compileGeneratedTypeScript(outputs, {
      entry: entry.relativePath,
      checkTypes: 'workspace'
    })[name]!;
    for (const test of billingCases) {
      const run = () => execute(nativeDates(billingRecords(test.inputs)));
      if (test.expectedError) expect(run, test.id).toThrow(new RegExp(test.expectedError));
      else expect(JSON.parse(JSON.stringify(run())), test.id).toEqual(expectedSummary(test));
    }
  },
  // Strict compilation of the complete CDM dependency closure can exceed 30 seconds under root coverage.
  60_000
);

it(
  'sums the same pinned CDM records in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    const fn = python.bindings.get(billingDeclaration.namespace + '.' + billingDeclaration.name);
    const results = runPython(
      billingCases.map((test) => ({ expression: `${fn}(data)`, data: { billingRecord: billingRecords(test.inputs) } })),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(billingCases.length);
    for (const [index, test] of billingCases.entries())
      expect(results[index], test.id).toEqual(
        test.expectedError
          ? { error: expect.stringMatching(new RegExp(test.expectedError)) }
          : { value: expectedSummary(test) }
      );
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
