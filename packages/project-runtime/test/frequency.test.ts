// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { generateSelected, generatePreviewSchemas } from '@rune-langium/codegen/export';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import { prepareCuratedImplementationSources } from '../src/curated-implementations/install.js';
import { createCuratedFrequencyProject } from '../../../test/helpers/curated-frequency.js';
import { frequencyIdentity, frequencyCases } from '../../../test/helpers/cdm-frequency.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';

it(
  'installs the shared Strata library with its CDM adapter, notices and ordinary override precedence',
  async () => {
    const project = await createCuratedFrequencyProject();
    expect([...project.changes.keys()].filter((path) => path.endsWith('.rosetta'))).toEqual([
      'model/implementations/cdm/frequency.rosetta',
      'model/implementations/cdm/strata-frequency.rosetta'
    ]);
    expect(project.installed.files.get('model/implementations/cdm/strata-LICENSE.txt')).toContain('Apache License');
    expect(project.installed.files.get('model/implementations/cdm/strata-NOTICE.txt')).toContain('OpenGamma');
    expect((await prepareCuratedImplementationSources(project.installed, project.references)).changes.size).toBe(0);
    const uninstalled = await prepareCuratedImplementationSources(project.installed, []);
    expect(uninstalled.changes.get('model/implementations/cdm/strata-LICENSE.txt')).toBeNull();
    expect(uninstalled.changes.get('model/implementations/cdm/strata-NOTICE.txt')).toBeNull();
    const graph = await buildEffectiveProject(project.installed, project.references);
    expect(graph.diagnostics).toEqual([]);
    const output = await generateSelected(
      [...graph.documents],
      { namespaces: ['example.frequency'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(output.outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const module = compileGeneratedTypeScript(output.outputs);
    const fn = output.outputs.flatMap((file) => file.funcs).find((fn) => fn.name === 'AnnualPeriods')!;
    for (const test of frequencyCases) {
      const invoke = () => module[fn.exportName!]!(test.inputs.frequency);
      if (test.expectedError) expect(invoke, test.id).toThrow(new RegExp(test.expectedError, 'i'));
      else expect(invoke(), test.id).toBe(test.expected);
    }
    const path = 'model/implementations/cdm/frequency.rosetta';
    const edited = await createProjectDraftSnapshot(
      project.installed,
      new Map([[path, project.installed.files.get(path)! + '\n// user edit\n']]),
      () => []
    );
    const refresh = await prepareCuratedImplementationSources(edited, project.references);
    expect(refresh.changes.has(path)).toBe(false);
    expect(refresh.diagnostics).toContainEqual(expect.objectContaining({ code: 'IMPLEMENTATION_SOURCE_EDITED', path }));
    const removed = await createProjectDraftSnapshot(project.installed, new Map([[path, null]]), () => []);
    const missing = await buildEffectiveProject(removed, project.references);
    expect(missing.diagnostics).toEqual([]);
    expect(
      generatePreviewSchemas([...missing.documents]).find((schema) => schema.targetId === frequencyIdentity)
        ?.executionUnavailable
    ).toBeTruthy();
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
