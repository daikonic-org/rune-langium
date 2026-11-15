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
import type { InspectNamespaceRequest, InspectNamespaceResponse } from '../workers/parser-worker.js';
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

/** Both worker transports return the same isolated snapshot and contained errors. */
export const handleInspectNamespace = withInstrumentation(
  async function handleInspectNamespace(req: InspectNamespaceRequest): Promise<InspectNamespaceResponse> {
    try {
      return {
        type: 'inspectNamespaceResult',
        id: req.id,
        models: await readCuratedDeclarationModels(req.documents)
      };
    } catch (error) {
      return {
        type: 'inspectNamespaceResult',
        id: req.id,
        models: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },
  { op: 'inspectCuratedDeclaration', capture: 0 }
);
