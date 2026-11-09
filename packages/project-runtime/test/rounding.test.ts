// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generateSelected, resolveNativeImplementation, generatePythonModule } from '@rune-langium/codegen/export';
import { isRosettaModel, isRosettaFunction } from '@rune-langium/core';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  roundingDirectory,
  roundingCaller,
  roundingCases,
  additionalRoundingCases,
  additionalRoundingArguments,
  additionalRoundingCallers
} from '../../../test/helpers/cdm-rounding.js';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';

it(
  'delivers native rounding through a verified bundle without copying a parallel Rune implementation',
  async () => {
    const project = await createCuratedRuneProject(roundingDirectory, roundingCaller);
    expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([]);
    expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const originals = graph.documents.flatMap((doc) =>
      isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
    );
    for (const [name, id] of [
      ['RoundToPrecision', 'cdm.round-to-precision'],
      ['RoundToNearest', 'cdm.round-to-nearest'],
      ['RoundToSignificantFigures', 'cdm.round-to-significant-figures']
    ])
      for (const target of ['typescript', 'python'])
        expect(
          resolveNativeImplementation(
            originals.find((fn) => fn.name === name)!,
            target
          )
        ).toMatchObject({ status: 'available', id });
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.rounding'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const module = compileGeneratedTypeScript(outputs);
    const fn = outputs.flatMap((file) => file.funcs).find((fn) => fn.name === 'RoundQuote')!;
    for (const test of roundingCases) {
      const { value, precision, roundingMode, removeTrailingZeros } = test.inputs;
      expect(module[fn.exportName!]!(value, precision, roundingMode, removeTrailingZeros), test.id).toBe(test.expected);
    }
    const functions = outputs.flatMap((file) => file.funcs);
    for (const test of additionalRoundingCases) {
      const fn = functions.find((fn) => fn.name === additionalRoundingCallers[test.function])!;
      const execute = () => module[fn.exportName!]!(...additionalRoundingArguments(test));
      if (test.error) expect(execute, test.id).toThrow(/Non-terminating decimal/);
      else expect(execute(), test.id).toBe(test.expected);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'keeps authored Rune overrides ahead of installed rounding bodies in both targets',
  async () => {
    const project = await createCuratedRuneProject(roundingDirectory, roundingCaller);
    const snapshot = await createProjectDraftSnapshot(
      project.installed,
      new Map([
        [
          'model/rounding-override.rosetta',
          `override namespace cdm.base.math
version "1.0.0"
func RoundToNearest:
  inputs:
    value number (1..1)
    nearest number (1..1)
    roundingMode RoundingModeEnum (1..1)
  output: roundedValue number (1..1)
  set roundedValue: 42
func RoundToSignificantFigures:
  inputs:
    value number (1..1)
    significantFigures int (1..1)
    roundingMode RoundingDirectionEnum (1..1)
  output: roundedValue number (1..1)
  set roundedValue: 43
`
        ]
      ]),
      () => []
    );
    const graph = await buildEffectiveProject(snapshot, project.references);
    expect(graph.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.rounding'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    const module = compileGeneratedTypeScript(outputs);
    for (const [name, args, expected] of [
      ['RoundQuoteToNearest', [1, 3, 'Up'], 42],
      ['RoundQuoteToSignificantFigures', [Number.MAX_VALUE, 1, 'Up'], 43]
    ] as const) {
      const fn = outputs.flatMap((file) => file.funcs).find((fn) => fn.name === name)!;
      expect(module[fn.exportName!]!(...args)).toBe(expected);
    }
    const python = generatePythonModule([...graph.documents]);
    expect(python.diagnostics).toEqual([]);
    expect(
      runPython(
        [
          {
            expression: `${python.bindings.get('example.rounding.RoundQuoteToNearest')}(data)`,
            data: { value: 1, nearest: 3, roundingMode: 'Up' }
          },
          {
            expression: `${python.bindings.get('example.rounding.RoundQuoteToSignificantFigures')}(data)`,
            data: { value: Number.MAX_VALUE, significantFigures: 1, roundingMode: 'Up' }
          }
        ],
        python.code,
        { includeRuntime: false }
      )
    ).toEqual([{ value: 42 }, { value: 43 }]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
