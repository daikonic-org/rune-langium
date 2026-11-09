// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';

export const roundingDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-rounding');
export const roundingIdentity = 'cdm.base.math.RoundToPrecision';
export interface RoundingCase {
  id: string;
  inputs: { value: number; precision: number; roundingMode: 'Up' | 'Down' | 'Nearest'; removeTrailingZeros: boolean };
  expected: number;
  referenceScale: number;
}
export type AdditionalRoundingCase = {
  id: string;
} & (
  | { function: 'RoundToNearest'; inputs: { value: number; nearest: number; roundingMode: 'Up' | 'Down' } }
  | {
      function: 'RoundToSignificantFigures';
      inputs: { value: number; significantFigures: number; roundingMode: 'Up' | 'Down' | 'Nearest' };
    }
) &
  (
    | { expected: number; referenceValue: string; referenceScale: number; error?: never }
    | { error: 'ArithmeticException'; expected?: never; referenceValue?: never; referenceScale?: never }
  );
const cases: ((RoundingCase & { function: 'RoundToPrecision' }) | AdditionalRoundingCase)[] = JSON.parse(
  readFileSync(resolve(roundingDirectory, 'cases.json'), 'utf8')
);
export const roundingCases = cases.filter(
  (test): test is RoundingCase & { function: 'RoundToPrecision' } => test.function === 'RoundToPrecision'
);
export const additionalRoundingCases = cases.filter(
  (test): test is AdditionalRoundingCase => test.function !== 'RoundToPrecision'
);
export const additionalRoundingCallers = {
  RoundToNearest: 'RoundQuoteToNearest',
  RoundToSignificantFigures: 'RoundQuoteToSignificantFigures'
} as const;

export function additionalRoundingArguments(test: AdditionalRoundingCase) {
  return test.function === 'RoundToNearest'
    ? [test.inputs.value, test.inputs.nearest, test.inputs.roundingMode]
    : [test.inputs.value, test.inputs.significantFigures, test.inputs.roundingMode];
}
export const roundingCaller = {
  uri: 'file:///model/rounding-caller.rosetta',
  content: `namespace example.rounding
import cdm.base.math.*
func RoundQuote:
    inputs:
        value number (1..1)
        precision int (1..1)
        roundingMode RoundingDirectionEnum (1..1)
        removeTrailingZeros boolean (1..1)
    output:
        result number (1..1)
    set result: RoundToPrecision(value, precision, roundingMode, removeTrailingZeros)

func RoundQuoteToNearest:
    inputs:
        value number (1..1)
        nearest number (1..1)
        roundingMode RoundingModeEnum (1..1)
    output:
        result number (1..1)
    set result: RoundToNearest(value, nearest, roundingMode)

func RoundQuoteToSignificantFigures:
    inputs:
        value number (1..1)
        significantFigures int (1..1)
        roundingMode RoundingDirectionEnum (1..1)
    output:
        result number (1..1)
    set result: RoundToSignificantFigures(value, significantFigures, roundingMode)
`
};
export function roundingFiles() {
  return [...referenceFiles(roundingDirectory), roundingCaller];
}
