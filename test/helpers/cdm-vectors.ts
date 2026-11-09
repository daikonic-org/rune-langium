// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceFiles } from '../../packages/codegen/test/helpers/cdm-reference.js';

export const vectorDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-vectors');
export const vectorCallers = { VectorOperation: 'OperateVectors', VectorGrowthOperation: 'GrowVector' } as const;
export type VectorCase = {
  id: string;
  expected: number[];
  referenceValues: string[];
} & (
  | { function: 'VectorOperation'; inputs: { arithmeticOp: string; left: number[]; right: number[] } }
  | { function: 'VectorGrowthOperation'; inputs: { baseValue: number; factor: number[] } }
);
export const vectorCases: VectorCase[] = JSON.parse(readFileSync(resolve(vectorDirectory, 'cases.json'), 'utf8'));
export function vectorArguments(test: VectorCase) {
  return test.function === 'VectorOperation'
    ? [test.inputs.arithmeticOp, test.inputs.left, test.inputs.right]
    : [test.inputs.baseValue, test.inputs.factor];
}
export const vectorCaller = {
  uri: 'file:///model/vector-caller.rosetta',
  content: `namespace example.vectors
import cdm.base.math.*
func OperateVectors:
  inputs:
    arithmeticOp ArithmeticOperationEnum (1..1)
    left number (0..*)
    right number (0..*)
  output: result number (0..*)
  set result: VectorOperation(arithmeticOp, left, right)

func GrowVector:
  inputs:
    baseValue number (1..1)
    factor number (0..*)
  output: result number (0..*)
  set result: VectorGrowthOperation(baseValue, factor)

func VectorExample:
  inputs:
    arithmeticOp ArithmeticOperationEnum (1..1)
    leftValue number (1..1)
    rightValue number (1..1)
  output: result number (0..*)
  set result: VectorOperation(arithmeticOp, [leftValue, 3], [rightValue])

func GrowthExample:
  inputs:
    baseValue number (1..1)
    firstFactor number (1..1)
    secondFactor number (1..1)
  output: result number (0..*)
  set result: VectorGrowthOperation(baseValue, [firstFactor, secondFactor])
`
};
export function vectorFiles() {
  return [...referenceFiles(vectorDirectory), vectorCaller];
}
