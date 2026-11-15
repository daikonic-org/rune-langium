// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  createRuneDslServices,
  hydrateModelDocuments,
  isRosettaModel,
  serializeRuneModel,
  type RosettaModel
} from '@rune-langium/core';
import { EmptyFileSystem } from 'langium';
import type { InspectNamespaceRequest } from '../workers/parser-worker.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Isolated declaration snapshots; never mutate the authoritative parser's documents or references. */
export const readCuratedDeclarationModels = withInstrumentation(
  async function readCuratedDeclarationModels(
    documents: InspectNamespaceRequest['documents']
  ): Promise<RosettaModel[]> {
    const services = createRuneDslServices(EmptyFileSystem);
    const entries = hydrateModelDocuments(
      services,
      documents.map((doc) => ({ uri: doc.uri, json: doc.serializedModel }))
    );
    if (entries.some(({ model }) => !isRosettaModel(model))) throw new Error('Expected a serialized RosettaModel');
    await services.shared.workspace.DocumentBuilder.build(
      entries.map(({ document }) => document),
      { eagerLinking: false, validation: false }
    );
    return entries.map(({ model }) =>
      JSON.parse(serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, model))
    );
  },
  { op: 'readCuratedDeclarationModels', capture: 0 }
);
