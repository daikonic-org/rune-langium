// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRosettaModel, serializeRuneModel } from '../../packages/core/src/index.js';
import { createProjectSnapshot } from '../../packages/project-config/src/index.js';
import { buildEffectiveProject } from '../../packages/project-runtime/src/effective-project.js';
import { projectReferenceUri } from '../../packages/project-runtime/src/project-uri.js';
import {
  fpmlHashLayout,
  type fpmlKeyRecipes
} from '../../packages/project-runtime/src/curated-implementations/fpml-keys.js';
import { publishCuratedImplementations } from '../../packages/project-runtime/src/curated-implementations/publication.js';
import { referenceModelSources } from '../../packages/codegen/test/helpers/cdm-reference.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-fpml-keys');
export const fpmlKeyNamespace = 'cdm.ingest.fpml.confirmation.pricequantity';

interface KeyCase {
  id: string;
  function: keyof typeof fpmlKeyRecipes;
  prefix: string;
  keyId?: string;
  json: string;
  preserveNumberText?: boolean;
  expected: string;
}

export const fpmlKeyCases: KeyCase[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

export async function publishFpmlKeyFixture() {
  const { sources }: { sources: { model: string; commit: string }[] } = JSON.parse(
    readFileSync(resolve(directory, 'sources.json'), 'utf8')
  );
  const references = Object.entries(referenceModelSources(directory)).flatMap(([model, files]) =>
    files.map(({ path, content }) => ({ model, uri: model + '/' + path, content }))
  );
  const snapshot = await createProjectSnapshot(
    'fpml-keys',
    new Map([
      ['rune-config.yml', 'model: {name: FpmlKeys}'],
      ['build-config.yml', 'schemaVersion: 1']
    ]),
    () => []
  );
  const linked = await buildEffectiveProject(snapshot, references);
  if (linked.diagnostics.length) throw new Error(JSON.stringify(linked.diagnostics));
  const models = linked.documents.map((document) => document.parseResult.value).filter(isRosettaModel);
  const fpml = models.filter((model) => model.name.startsWith('fpml.consolidated.'));
  // This fixture exercises a representative slice of the publication-pinned hash layout.
  const layout = fpmlHashLayout(fpml);
  const byUri = new Map(linked.documents.map((document) => [document.uri.toString(true), document.parseResult.value]));
  const published = await Promise.all(
    references.map(async (reference) => {
      const model = byUri.get(projectReferenceUri(reference.uri));
      if (!isRosettaModel(model)) throw new Error('Missing linked fixture model ' + reference.uri);
      const commit = sources.find((source) => source.model === reference.model)?.commit;
      if (!commit) throw new Error('Missing fixture origin ' + reference.model);
      const serialized = await publishCuratedImplementations(
        model,
        serializeRuneModel(linked.services.serializer.JsonSerializer, model),
        { model: reference.model, commit },
        { fpmlHashLayout: layout }
      );
      return { ...reference, serialized };
    })
  );
  return { snapshot, published, fpml, sources };
}
