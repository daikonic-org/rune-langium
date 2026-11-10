// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import { createCuratedRuneProject, curatedFixtureResources } from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-code-list-loader');
const manifest: {
  declarations: { namespace: string; name: string; kind: 'RosettaFunction' }[];
} = JSON.parse(readFileSync(resolve(directory, 'sources.json'), 'utf8'));
const resources = curatedFixtureResources(directory);
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
import rune.resources.cdm.*

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
  return { ...project, snapshot: project.installed };
}
