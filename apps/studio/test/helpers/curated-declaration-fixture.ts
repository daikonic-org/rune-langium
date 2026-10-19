// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { URI } from 'langium';

export async function declarationDocuments() {
  const { RuneDsl } = createRuneDslServices();
  const sources = [
    ['base', 'namespace example.base\n\ntype Base:\n  inherited string (1..1)\n'],
    ['selected', 'namespace example.selected\nimport example.base.*\n\ntype Selected extends Base:\n  own int (0..1)\n']
  ];
  const documents = sources.map(([name, source]) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source!, URI.parse(`file:///cdm/${name}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents);
  return documents.map((doc, index) => ({
    uri: `cdm/${sources[index]![0]}.rosetta`,
    content: '',
    bundleId: 'cdm',
    namespace: index ? 'example.selected' : 'example.base',
    serializedModel: serializeRuneModel(RuneDsl.serializer.JsonSerializer, doc.parseResult.value),
    exports: [{ type: 'Data', name: index ? 'example.selected.Selected' : 'example.base.Base', path: '/elements@0' }]
  }));
}
