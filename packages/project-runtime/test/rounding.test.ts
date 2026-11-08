// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generateSelected, resolveNativeImplementation } from '@rune-langium/codegen/export';
import { isRosettaModel, isRosettaFunction } from '@rune-langium/core';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedRuneProject } from '../../../test/helpers/curated-rune-project.js';
import { roundingDirectory, roundingCaller, roundingCases } from '../../../test/helpers/cdm-rounding.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';

it(
  'delivers native rounding through a verified bundle without copying a parallel Rune implementation',
  async () => {
    const project = await createCuratedRuneProject(roundingDirectory, roundingCaller);
    expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([]);
    expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const original = graph.documents
      .flatMap((doc) =>
        isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
      )
      .find((fn) => fn.name === 'RoundToPrecision')!;
    for (const target of ['typescript', 'python'])
      expect(resolveNativeImplementation(original, target)).toMatchObject({
        status: 'available',
        id: 'cdm.round-to-precision'
      });
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
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
