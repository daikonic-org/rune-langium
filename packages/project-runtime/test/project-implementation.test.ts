// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { generate, emitStandaloneZodSchema } from '@rune-langium/codegen/export';
import { createProjectSnapshot, readExamples, readWorkflows, readPresentations } from '@rune-langium/project-config';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { recordFunctionExports } from '../../codegen/test/helpers/record-function-exports.js';
import { runeImplementationProject } from '../../../test/helpers/rune-implementation-project.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { openLocalProject } from '../src/local-project.js';
async function compile(
  snapshot: Awaited<ReturnType<typeof runeImplementationProject>>['snapshot'],
  documents: Awaited<ReturnType<typeof runeImplementationProject>>['documents']
) {
  const graph = await buildEffectiveProject(snapshot, documents);
  expect(graph.diagnostics).toEqual([]);
  const outputs = await generate([...graph.documents], {
    target: 'typescript',
    typescript: { layout: 'single-file' },
    projectBindings: graph.implementationBindings,
    projectResources: graph.bindings
  });
  expect(outputs.flatMap((output) => output.diagnostics.filter((issue) => issue.severity === 'error'))).toEqual([]);
  const functions = recordFunctionExports(compileGeneratedTypeScript(outputs), outputs);
  const name = outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'Caller')!;
  expect(name).toBeDefined();
  // Use the same canonical input schema as Studio; typed TS exports alone are not runtime validators.
  const emitted = emitStandaloneZodSchema([...graph.documents], 'example.reference.Caller', { functionInputs: true });
  expect(emitted.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([]);
  const schemas = compileGeneratedTypeScript<Record<string, { parse(value: unknown): Record<string, unknown> }>>([
    { ...outputs[0]!, relativePath: 'caller-inputs.ts', content: emitted.code, funcs: [] }
  ]);
  const validator = schemas[emitted.schemaName!]!;
  return (inputs: Record<string, unknown>) => functions[name.exportName ?? name.name]!(validator.parse(inputs));
}
it('runs the reference caller through local Rune Double and rejects missing required numeric input', async () => {
  const fixture = await runeImplementationProject();
  const caller = await compile(fixture.snapshot, fixture.documents);
  expect(caller({ value: 10 })).toBe(20);
  expect(() => caller({})).toThrow(/requires|required|value/);
  const files = new Map(fixture.files);
  files.set('build-config.yml', JSON.stringify({ ...fixture.snapshot.project.build, overrides: [] }));
  const original = await compile(await createProjectSnapshot('removed', files, () => []), fixture.documents);
  expect(() => original({ value: 10 })).toThrow(/implementation|implemented|unavailable/);
});
it('reopens a copied project with its exact mapping and typed example without private browser state', async () => {
  const fixture = await runeImplementationProject();
  const parent = await mkdtemp(join(tmpdir(), 'rune-first-clone-'));
  try {
    for (const [path, text] of fixture.files) {
      await mkdir(dirname(join(parent, 'clone', path)), { recursive: true });
      await writeFile(join(parent, 'clone', path), text);
    }
    const { snapshot } = await openLocalProject(join(parent, 'clone'), { privateRoot: join(parent, 'private') });
    expect(snapshot.project.build.overrides).toEqual(fixture.snapshot.project.build.overrides);
    expect(readExamples(snapshot).documents[0]!.payload).toEqual({ amount: 10, currency: 'USD' });
    expect(readExamples(snapshot).documents[0]!.descriptor.expected).toBe('fixtures/expected/output.json');
    expect((await compile(snapshot, fixture.documents))({ value: 10 })).toBe(20);
    expect([...snapshot.files.keys()].some((path) => path.startsWith('.studio/'))).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
it('builds the standalone local starter by named targets and retains its intentional expected fixture', async () => {
  const paths = [
    'rune-config.yml',
    'build-config.yml',
    'studio-config.yml',
    'model/quote.rosetta',
    'examples/input.example.json',
    'examples/input.json',
    'fixtures/expected/output.json',
    'workflows/double-quote.workflow.json',
    'layouts/amount.layout.json',
    'layouts/quote.layout.json',
    '.gitignore'
  ];
  const { readFile } = await import('node:fs/promises');
  const files = await Promise.all(
    paths.map(
      async (path) =>
        [
          path,
          await readFile(new URL('../../../examples/workspaces/model-authoring/' + path, import.meta.url), 'utf8')
        ] as const
    )
  );
  const parent = await mkdtemp(join(tmpdir(), 'rune-starter-'));
  try {
    for (const [path, text] of files) {
      await mkdir(dirname(join(parent, 'project', path)), { recursive: true });
      await writeFile(join(parent, 'project', path), text);
    }
    const { snapshot, adapter } = await openLocalProject(join(parent, 'project'), {
      privateRoot: join(parent, 'private')
    });
    const { buildProject } = await import('../src/build-project.js');
    const result = await buildProject(snapshot, { targets: 'all' }, adapter);
    expect(result.status).toBe('success');
    expect(readExamples(snapshot).diagnostics).toEqual([]);
    expect(readWorkflows(snapshot).diagnostics).toEqual([]);
    expect(readPresentations(snapshot).diagnostics).toEqual([]);
    expect(Object.keys(snapshot.project.build.targets)).toEqual(['typescript', 'schema']);
    expect(result.outputs.some((path) => path.endsWith('.ts'))).toBe(true);
    expect(result.outputs.some((path) => path.startsWith('generated/schema/'))).toBe(true);
    expect(JSON.parse(await readFile(join(parent, 'project/fixtures/expected/output.json'), 'utf8'))).toEqual({
      amount: 20,
      currency: 'USD'
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
