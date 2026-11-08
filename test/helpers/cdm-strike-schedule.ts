// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';

export const strikeScheduleDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-strike-schedule');
export const strikeScheduleIdentity =
  'cdm.ingest.fpml.confirmation.pricequantity.MapCommodityOptionStrikePriceSchedule';
export interface StrikeScheduleCase {
  id: string;
  inputs: {
    fpmlStrikePricePerUnitStepList: {
      amount: number;
      currency: { value: string; currencyScheme?: string };
      id?: string;
    }[];
    fpmlCommodityStrikePriceDateList: string[];
  };
  expected: { date?: string; value: number }[];
  missingDateRows?: number[];
}
export const strikeScheduleCases: StrikeScheduleCase[] = JSON.parse(
  readFileSync(resolve(strikeScheduleDirectory, 'cases.json'), 'utf8')
);
export const strikeScheduleImplementationFiles = ['strike-schedule-state.rosetta', 'strike-schedule.rosetta'].map(
  (name) => ({
    uri: `file:///model/implementations/cdm/${name}`,
    content: readFileSync(
      resolve(import.meta.dirname, '../../packages/project-runtime/src/curated-implementations/rune', name),
      'utf8'
    )
  })
);
export const strikeScheduleCaller = {
  uri: 'file:///model/strike-caller.rosetta',
  content: `namespace example.strike
import cdm.ingest.fpml.confirmation.pricequantity.*
import cdm.base.math.*
import fpml.consolidated.shared.* as fpml
func StrikeSchedule:
    inputs:
        prices fpml.NonNegativeMoney (0..*)
        dates date (0..*)
    output:
        result DatedValue (0..*)
    set result: MapCommodityOptionStrikePriceSchedule(prices, dates)
`
};
export function strikeScheduleFiles(withImplementation = true) {
  return [
    ...referenceFiles(strikeScheduleDirectory),
    strikeScheduleCaller,
    ...(withImplementation ? strikeScheduleImplementationFiles : [])
  ];
}
