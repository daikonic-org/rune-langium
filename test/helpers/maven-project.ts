// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inspectMavenProject, refreshMavenPreviewWrites } from '../../packages/project-config/src/index.js';
const fixtureRoot = fileURLToPath(new URL('../fixtures/third-party/project-import/', import.meta.url));
/** Small numeric execution contract only; not an upstream CDM payment/calendar implementation. */
export const paymentScheduleFixtureSource =
  'namespace example\ntype Payment:\n amount number (1..1)\nfunc CreatePaymentSchedule:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value\n';
export async function mavenInitializationFixture(name: 'cdm' | 'fpml') {
  const input = new Map<string, string>();
  for (const path of ['pom.xml', 'rosetta-source/pom.xml'])
    input.set(path, await readFile(join(fixtureRoot, name, path), 'utf8'));
  const inspected = inspectMavenProject(input, { pomPath: 'pom.xml', profiles: [] });
  // These targets are explicitly authored native settings, never an inferred Java translation.
  const preview = refreshMavenPreviewWrites({
    ...inspected,
    build: {
      ...inspected.build,
      sources: ['model/**/*.rosetta'],
      targets: {
        ...inspected.build.targets,
        types: { generator: 'json-schema', output: 'generated/types', options: {} },
        schedule: { generator: 'typescript', output: 'generated/schedule', options: { layout: 'single-file' } }
      },
      overrides: [
        {
          kind: 'implementation',
          source: { model: 'local', namespace: 'example', kind: 'RosettaFunction', name: 'CreatePaymentSchedule' },
          provider: 'fixture.missing-calendar'
        }
      ]
    }
  });
  const files = new Map([
    ...input,
    ...preview.writes.map((write) => [write.path, write.text] as const),
    ['model/payment.rosetta', paymentScheduleFixtureSource] as const
  ]);
  return { input, files, preview };
}
export function withLocalRuneImplementation(
  files: ReadonlyMap<string, string>,
  preview: Awaited<ReturnType<typeof mavenInitializationFixture>>['preview']
) {
  return new Map([
    ...files,
    ['build-config.yml', JSON.stringify({ ...preview.build, overrides: [] })],
    ['model/payment.rosetta', paymentScheduleFixtureSource.replace('set result: value', 'set result: value + 1')]
  ]);
}
