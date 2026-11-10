// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProjectDraftSnapshot } from '../../packages/project-config/src/index.js';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { createCuratedRuneProject } from './curated-rune-project.js';
import { repository } from './project-reference-artifacts.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-code-list-loader');
const manifest: {
  sources: { model: string; release: string }[];
  declarations: { namespace: string; name: string; kind: 'RosettaFunction' }[];
  references: { name: string; sha256: string; upstream: { path: string } }[];
} = JSON.parse(readFileSync(resolve(directory, 'sources.json'), 'utf8'));
const resources = new Map(
  manifest.references
    .filter(({ name }) => name.startsWith('resources/'))
    .map(({ name, sha256, upstream }) => {
      const content = readFileSync(resolve(directory, name), 'utf8');
      if (createHash('sha256').update(content).digest('hex') !== sha256)
        throw new Error('Pinned code list changed: ' + name);
      return [name, { path: upstream.path, content }];
    })
);
export const codeListDeclarations = manifest.declarations;
export const codeListCases: {
  id: string;
  function: string;
  inputs: { domain: string; code?: string };
  resource?: string;
  expectedVersion?: string;
  expected?: boolean;
  expectedError?: string;
}[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

export function expectedCodeListResult(test: (typeof codeListCases)[number]): unknown {
  if (!test.resource) return test.expected;
  const list = JSON.parse(resources.get('resources/' + test.resource)!.content);
  if (test.expectedVersion) list.identification.version = test.expectedVersion;
  list.codes ??= [];
  return list;
}

export const codeListCaller = {
  uri: 'file:///model/code-lists.rosetta',
  content: `namespace example.codelists
import cdm.base.staticdata.codelist.*

typeAlias OptionType: string

func CheckOptionType:
    inputs: option OptionType (1..1)
    output: valid boolean (1..1)
    set valid: ValidateFpMLCodingSchemeDomain(option to-string, "option-type")
`
};

export async function createCuratedCodeListProject() {
  const project = await createCuratedRuneProject(
    directory,
    codeListCaller,
    prepareCdmCodeLists([...resources.values()])
  );
  const path = 'resources/option-type-1-0.json';
  const snapshot = await createProjectDraftSnapshot(
    project.installed,
    new Map([
      [path, resources.get(path)!.content],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          references: { cdm: { repository: repository('cdm'), release: manifest.sources[0]!.release } },
          overrides: [
            {
              kind: 'resource',
              source: { model: 'local', id: 'example.codelists.OptionType#RosettaTypeAlias' },
              path,
              codeList: {
                format: 'cdm-json',
                canonicalUri: 'http://www.fpml.org/coding-scheme/option-type',
                version: '1-0'
              }
            }
          ]
        })
      ]
    ]),
    () => []
  );
  return { ...project, snapshot };
}
