// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { generate, generatePreviewSchemas } from '@rune-langium/codegen/export';
import { serializeRuneModel } from '@rune-langium/core';
import { URI } from 'langium';
import {
  cdmRuneImplementationSources,
  cdmRuneReferenceDocuments
} from '../../../test/helpers/cdm-rune-implementations.js';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { projectReferenceUri } from '../src/project-uri.js';

const files = () =>
  new Map([
    ['rune-config.yml', 'model: {name: CDM Rune implementations}\n'],
    ['build-config.yml', 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n'],
    ...cdmRuneImplementationSources
  ]);

it.each([false, true])(
  'executes upstream callers through the source pack, serialized references=%s',
  async (serialized) => {
    let references = cdmRuneReferenceDocuments;
    if (serialized) {
      const original = await buildEffectiveProject(
        await createProjectSnapshot(
          'original',
          new Map([...files()].filter(([path]) => !path.endsWith('.rosetta'))),
          () => []
        ),
        references
      );
      expect(original.diagnostics).toEqual([]);
      references = references.map((reference) => {
        const document = original.documents.find(
          (document) => document.uri.path === URI.parse(projectReferenceUri(reference.uri)).path
        )!;
        return {
          ...reference,
          serialized: serializeRuneModel(original.services.serializer.JsonSerializer, document.parseResult.value)
        };
      });
    }
    const unchanged = JSON.stringify(references);
    const graph = await buildEffectiveProject(await createProjectSnapshot('cdm-rune', files(), () => []), references);
    expect(graph.diagnostics).toEqual([]);
    const outputs = await generate([...graph.documents], {
      target: 'typescript',
      typescript: { layout: 'single-file' }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const compiled = compileGeneratedTypeScript(outputs);
    for (const [name, expected] of [
      ['ClearExecution', true],
      ['ClearHistory', 0]
    ] as const) {
      const fn = outputs.flatMap((output) => output.funcs).find((func) => func.name === name)!;
      expect(compiled[fn.exportName!]!()).toBe(expected);
    }
    expect(JSON.stringify(references)).toBe(unchanged);
    expect(
      generatePreviewSchemas([...graph.documents]).find(
        (schema) => schema.targetId === 'cdm.event.common.ClearExecution'
      )?.executionUnavailable
    ).toBeUndefined();
  }
);

it('restores honest unavailability when the clearing overrides are removed', async () => {
  const without = files();
  without.delete('model/implementations/event-common.rosetta');
  const graph = await buildEffectiveProject(
    await createProjectSnapshot('removed', without, () => []),
    cdmRuneReferenceDocuments
  );
  expect(graph.diagnostics).toEqual([]);
  const schema = generatePreviewSchemas([...graph.documents]).find(
    (schema) => schema.targetId === 'cdm.event.common.EmptyExecutionDetails'
  );
  expect(schema).toBeDefined();
  expect(schema?.executionUnavailable).toBeDefined();
});

it('rejects signature drift instead of applying a stale override', async () => {
  const references = cdmRuneReferenceDocuments.map((reference) => ({
    ...reference,
    content: reference.content.replace(
      'executionDetails ExecutionDetails (0..1)',
      'executionDetails ExecutionDetails (1..1)'
    )
  }));
  const graph = await buildEffectiveProject(await createProjectSnapshot('drift', files(), () => []), references);
  expect(graph.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'NAMESPACE_OVERRIDE_SIGNATURE',
      message: expect.stringContaining('signature differs')
    })
  );
});
