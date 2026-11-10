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

const fixtures = resolve(import.meta.dirname, '../fixtures/third-party');
const directory = resolve(fixtures, 'cdm-valuation-times');
export const valuationTimeDeclarations = [
  { namespace: 'cdm.base.datetime', name: 'TimeZoneFromBusinessCenterTime', kind: 'RosettaFunction' },
  { namespace: 'cdm.observable.common', name: 'ResolveTimeZoneFromTimeType', kind: 'RosettaFunction' },
  { namespace: 'cdm.event.common', name: 'ResolvePerformanceValuationTime', kind: 'RosettaFunction' },
  { namespace: 'example.valuation', name: 'PublishedBusinessCenterTime', kind: 'RosettaFunction' }
] as const;

export interface ValuationTimeCase {
  id: string;
  function: (typeof valuationTimeDeclarations)[number]['name'];
  center?: string;
  wallTime?: string;
  centerScheme?: string;
  identifier?: string;
  identifierType?: string;
  identifierScheme?: string;
  timeType?: string;
  determinationMethod?: string;
  expectedTime?: string;
  expectedLocation?: string;
  error?: string;
}

export const valuationTimeCases: ValuationTimeCase[] = JSON.parse(
  readFileSync(resolve(directory, 'cases.json'), 'utf8')
);
export const zoneScheme = 'urn:fixture:zone';

export const valuationTimeCaller = {
  uri: 'file:///model/valuation-times.rosetta',
  content: `namespace example.valuation
import cdm.base.datetime.*
import cdm.base.staticdata.asset.common.*
import cdm.observable.common.*
import impl.cdm.time.*
import rune.resources.cdm.BusinessCenter

func FixtureZone:
    inputs:
        center string (1..1)
        centerScheme string (0..1)
        location string (1..1)
    output:
        zone BusinessCenterZone (1..1)
    set zone: BusinessCenterZone {
        businessCenter: center with-meta { scheme: centerScheme },
        location: location with-meta { scheme: "${zoneScheme}" }
    }

func FixtureBusinessCenterZones:
    inputs: time BusinessCenterTime (1..1)
    output: zones BusinessCenterZone (0..*)
    set zones: [
        FixtureZone("GBLO", empty, "Europe/London"),
        FixtureZone("USNY", empty, "America/New_York"),
        FixtureZone("GBLO", "urn:fixture:alternate", "Europe/Paris"),
        FixtureZone("GBLO", "urn:fixture:duplicate", "Europe/London"),
        FixtureZone("GBLO", "urn:fixture:duplicate", "Europe/Paris")
    ]

func FixtureAsset:
    inputs:
        value string (1..1)
        identifierType AssetIdTypeEnum (1..1)
        identifierScheme string (0..1)
    output:
        asset AssetIdentifier (1..1)
    set asset: AssetIdentifier {
        identifier: value with-meta { scheme: identifierScheme },
        identifierType: identifierType
    }

func FixtureClock:
    inputs:
        hour int (1..1)
        minute int (1..1)
        location string (0..1)
    output:
        clock TimeZone (1..1)
    set clock: TimeZone {
        time: ToTime(hour, minute, 0),
        location: if location exists then location with-meta { scheme: "${zoneScheme}" }
    }

func FixtureSlot:
    inputs:
        asset AssetIdentifier (1..1)
        timeType TimeTypeEnum (1..1)
        determinationMethod DeterminationMethodEnum (1..1)
        clock TimeZone (1..1)
    output:
        slot AssetValuationTime (1..1)
    set slot: AssetValuationTime {
        assetIdentifier: asset, timeType: timeType, determinationMethod: determinationMethod, valuationTime: clock
    }

func FixtureAssetValuationTimes:
    inputs:
        assetIdentifier AssetIdentifier (1..1)
        timeType TimeTypeEnum (1..1)
        determinationMethod DeterminationMethodEnum (1..1)
    output:
        valuationTimes AssetValuationTime (0..*)
    alias london: FixtureAsset("SAMPLE", AssetIdTypeEnum -> Name, "urn:fixture:london")
    alias newYork: FixtureAsset("SAMPLE", AssetIdTypeEnum -> Name, "urn:fixture:new-york")
    alias isin: FixtureAsset("SAMPLE", AssetIdTypeEnum -> ISIN, "urn:fixture:london")
    alias duplicate: FixtureAsset("DUP", AssetIdTypeEnum -> Name, empty)
    alias close: TimeTypeEnum -> Close
    alias official: DeterminationMethodEnum -> ClosingPrice
    alias agent: DeterminationMethodEnum -> CalculationAgent
    set valuationTimes: [
        FixtureSlot(london, close, official, FixtureClock(16, 30, "Europe/London")),
        FixtureSlot(newYork, close, official, FixtureClock(16, 0, "America/New_York")),
        FixtureSlot(isin, close, official, FixtureClock(17, 30, "Europe/Paris")),
        FixtureSlot(london, close, agent, FixtureClock(16, 15, "Europe/London")),
        FixtureSlot(london, TimeTypeEnum -> Open, DeterminationMethodEnum -> OpenPrice, FixtureClock(8, 0, "Europe/London")),
        FixtureSlot(london, TimeTypeEnum -> SpecificTime, agent, FixtureClock(9, 30, empty)),
        FixtureSlot(duplicate, close, official, FixtureClock(15, 0, "Europe/London")),
        FixtureSlot(duplicate, close, official, FixtureClock(16, 0, "Europe/London"))
    ]

func PublishedBusinessCenterTime:
    inputs: center BusinessCenter (1..1)
    output: result TimeZone (1..1)
    set result: TimeZoneFromBusinessCenterTime(
        BusinessCenterTime { hourMinuteTime: ToTime(11, 0, 0), businessCenter: center to-string }
    )

func PublishedAssetCloseTime:
    inputs: identifier string (1..1)
    output: result TimeZone (1..1)
    set result: ResolvePerformanceValuationTime(
        empty,
        TimeTypeEnum -> Close,
        FixtureAsset(identifier, AssetIdTypeEnum -> Name, "urn:fixture:london"),
        DeterminationMethodEnum -> ClosingPrice
    )
`
};

export async function createCuratedValuationTimeProject(withProviders = true) {
  // Use the same pinned business-center codelist as the calendar fixture.
  const resources = curatedFixtureResources(resolve(fixtures, 'cdm-business-calendars'));
  const project = await createCuratedRuneProject(
    directory,
    valuationTimeCaller,
    prepareCdmCodeLists([...resources.values()])
  );
  if (!withProviders) return project;
  return withCuratedFixtureOverride(
    project,
    {
      kind: 'declaration',
      source: { model: 'local', namespace: 'impl.cdm.time', kind: 'RosettaFunction', name: 'ReadBusinessCenterZones' },
      replacement: {
        model: 'local',
        namespace: 'example.valuation',
        kind: 'RosettaFunction',
        name: 'FixtureBusinessCenterZones'
      }
    },
    {
      kind: 'declaration',
      source: { model: 'local', namespace: 'impl.cdm.time', kind: 'RosettaFunction', name: 'ReadAssetValuationTimes' },
      replacement: {
        model: 'local',
        namespace: 'example.valuation',
        kind: 'RosettaFunction',
        name: 'FixtureAssetValuationTimes'
      }
    }
  );
}
