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
export const roundingCases: RoundingCase[] = JSON.parse(readFileSync(resolve(roundingDirectory, 'cases.json'), 'utf8'));
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
`
};
export function roundingFiles() {
  return [...referenceFiles(roundingDirectory), roundingCaller];
}
