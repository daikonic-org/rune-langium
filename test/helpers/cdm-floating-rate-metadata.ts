// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareCdmCodeLists } from '../../packages/project-runtime/src/curated-implementations/code-list-resources.js';
import {
  createCuratedRuneProject,
  curatedFixtureResources,
  withCuratedFixtureOverride
} from './curated-rune-project.js';

const directory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-floating-rate-metadata');
const definitionsNamespace = 'cdm.observable.asset.fro';
export const froDeclarations = [
  { namespace: definitionsNamespace, name: 'FloatingRateIndexMetadata', kind: 'RosettaFunction' },
  {
    namespace: 'cdm.event.instructioncomposition.reset',
    name: 'ExtractFloatingRateOptionData',
    kind: 'RosettaFunction'
  },
  { namespace: definitionsNamespace, name: 'ValidateFloatingRateIndexName', kind: 'RosettaFunction' },
  { namespace: 'example.fro', name: 'CatalogIndexCode', kind: 'RosettaFunction' }
] as const;

export interface FroCase {
  id: string;
  function: (typeof froDeclarations)[number]['name'];
  index: string;
  tradeDate?: string;
  contractualDefs?: string;
  expected?: string | boolean | null;
  error?: string;
}

export const froCases: FroCase[] = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8'));

export const froCaller = {
  uri: 'file:///model/fro.rosetta',
  content: `namespace example.fro
import cdm.base.staticdata.asset.rates.FloatingRateIndexEnum
import cdm.legaldocumentation.common.ContractualDefinitionsEnum
import cdm.observable.asset.fro.*
import cdm.event.instructioncomposition.reset.ExtractFloatingRateOptionData
import impl.cdm.fro.*
import rune.resources.cdm.FloatingRateIndex

func FixtureDefinition:
    inputs:
        index FloatingRateIndexEnum (1..1)
        sourceName string (1..1)
        contract ContractualDefinitionsEnum (1..1)
    output:
        definition FloatingRateIndexDefinition (1..1)
    set definition: FloatingRateIndexDefinition {
        fro: FloatingRateIndexIdentification { floatingRateIndex: index },
        definitionalSource: sourceName,
        supportedDefinition: [ContractualDefinition {
            contractualDefinitionIdentifier: ContractualDefinitionIdentifier { contractualDefinitionType: contract }
        }]
    }

func FixtureMarketMatrix:
    inputs:
        index FloatingRateIndexEnum (1..1)
    output:
        matrix FloatingRateIndexMatrix (1..1)

    alias startDate: date { year: 2024, month: 1, day: 1 }
    alias revisionDate: date { year: 2024, month: 7, day: 1 }
    alias previous: FixtureDefinition(index, "fixture-v1", ContractualDefinitionsEnum -> ISDA2006)
    alias current: FixtureDefinition(index, "fixture-v2", ContractualDefinitionsEnum -> ISDA2021InterestRateDerivatives)
    alias previousVersion: FloatingRateIndexMatrixVersion {
        effectiveFrom: startDate, effectiveUntil: revisionDate, definitions: [previous]
    }
    alias currentVersion: FloatingRateIndexMatrixVersion {
        effectiveFrom: revisionDate, definitions: [current]
    }
    alias versions:
        if index = FloatingRateIndexEnum -> EUR_EURIBOR_Act_365
        then [currentVersion, previousVersion]
        else if index = FloatingRateIndexEnum -> USD_SOFR
        then [previousVersion, FloatingRateIndexMatrixVersion {
            effectiveFrom: revisionDate, definitions: empty
        }]
        else if index = FloatingRateIndexEnum -> GBP_SONIA
        then [currentVersion, FloatingRateIndexMatrixVersion {
            effectiveFrom: startDate, definitions: [previous]
        }]
        else if index = FloatingRateIndexEnum -> USD_LIBOR_BBA
        then [FloatingRateIndexMatrixVersion {
            effectiveFrom: revisionDate, effectiveUntil: startDate, definitions: [current]
        }]
        else if index = FloatingRateIndexEnum -> AUD_BBR_BBSW
        then [FloatingRateIndexMatrixVersion {
            effectiveFrom: revisionDate, definitions: [previous, current]
        }]
        else empty
    set matrix: FloatingRateIndexMatrix {
        metadataDate: date { year: 2025, month: 1, day: 1 },
        versions: versions
    }

func CatalogIndexCode:
    inputs: index FloatingRateIndex (1..1)
    output: code string (1..1)
    set code: index to-string

func DescribeTradeDate:
    inputs: tradeDate date (1..1)
    output: definition FloatingRateIndexDefinition (1..1)
    set definition: ExtractFloatingRateOptionData(tradeDate, FloatingRateIndexEnum -> EUR_EURIBOR_Act_365)
`
};

export async function createCuratedFroProject(withProvider = true) {
  const resources = curatedFixtureResources(directory);
  const project = await createCuratedRuneProject(directory, froCaller, prepareCdmCodeLists([...resources.values()]));
  if (!withProvider) return project;
  return withCuratedFixtureOverride(project, {
    kind: 'declaration',
    source: { model: 'local', namespace: 'impl.cdm.fro', kind: 'RosettaFunction', name: 'ReadFloatingRateIndexMatrix' },
    replacement: { model: 'local', namespace: 'example.fro', kind: 'RosettaFunction', name: 'FixtureMarketMatrix' }
  });
}
