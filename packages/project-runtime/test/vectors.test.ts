// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generateSelected, generatePythonModule } from '@rune-langium/codegen/export';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  vectorDirectory,
  vectorCaller,
  vectorCases,
  vectorCallers,
  vectorArguments
} from '../../../test/helpers/cdm-vectors.js';

it(
  'installs publication-selected vector bodies and executes the handwritten reference corpus',
  async () => {
    const project = await createCuratedRuneProject(vectorDirectory, vectorCaller);
    expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([]);
    expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.vectors'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const module = compileGeneratedTypeScript(outputs);
    for (const test of vectorCases) {
      const fn = outputs.flatMap((file) => file.funcs).find((fn) => fn.name === vectorCallers[test.function])!;
      expect(module[fn.exportName!]!(...vectorArguments(test)), test.id).toEqual(test.expected);
    }
    const python = generatePythonModule([...graph.documents]);
    expect(python.diagnostics).toEqual([]);
    expect(
      runPython(
        vectorCases.map((test) => ({
          expression: `${python.bindings.get('example.vectors.' + vectorCallers[test.function])}(data)`,
          data: test.inputs
        })),
        python.code,
        { includeRuntime: false }
      )
    ).toEqual(vectorCases.map((test) => ({ value: test.expected })));
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'preserves authored Rune vector overrides ahead of native bodies in both targets',
  async () => {
    const project = await createCuratedRuneProject(vectorDirectory, vectorCaller);
    const snapshot = await createProjectDraftSnapshot(
      project.installed,
      new Map([
        [
          'model/vector-override.rosetta',
          `override namespace cdm.base.math
func VectorOperation:
  inputs:
    arithmeticOp ArithmeticOperationEnum (1..1)
    left number (0..*)
    right number (0..*)
  output: result number (0..*)
  set result: [42, 43]
func VectorGrowthOperation:
  inputs:
    baseValue number (1..1)
    factor number (0..*)
  output: result number (0..*)
  set result: [44, 45]
`
        ]
      ]),
      () => []
    );
    const graph = await buildEffectiveProject(snapshot, project.references);
    expect(graph.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.vectors'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const module = compileGeneratedTypeScript(outputs);
    for (const [name, args, expected] of [
      ['OperateVectors', ['Divide', [1], [0]], [42, 43]],
      ['GrowVector', [1, []], [44, 45]]
    ] as const) {
      const fn = outputs.flatMap((file) => file.funcs).find((fn) => fn.name === name)!;
      expect(module[fn.exportName!]!(...args)).toEqual(expected);
    }
    const python = generatePythonModule([...graph.documents]);
    expect(python.diagnostics).toEqual([]);
    expect(
      runPython(
        [
          {
            expression: `${python.bindings.get('example.vectors.OperateVectors')}(data)`,
            data: { arithmeticOp: 'Divide', left: [1], right: [0] }
          },
          {
            expression: `${python.bindings.get('example.vectors.GrowVector')}(data)`,
            data: { baseValue: 1, factor: [] }
          }
        ],
        python.code,
        { includeRuntime: false }
      )
    ).toEqual([{ value: [42, 43] }, { value: [44, 45] }]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
