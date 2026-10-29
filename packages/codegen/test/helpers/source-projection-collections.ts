// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const sourceProjectionCollections = `namespace test.projectionCollections
type Group:
 values int (0..*)
func Append:
 inputs: values int (0..*)
 output: result int (0..*)
 set result: values
 add result: 9
func GroupCount:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: (groups extract [values]) count
func Flat:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) flatten
func Scalar:
 inputs: amount int (0..1)
 output: result int (0..1)
 set result: amount extract [1]
func ScalarFilter:
 inputs: amount int (0..1)
 output: result int (0..1)
 set result: amount filter [item > 0]
func EmptyCount:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: (groups extract [empty]) count
func ScalarEmpty:
 inputs: amount int (0..1)
 output: result int (0..1)
 set result: amount extract [empty]
func Mix:
 inputs: groups Group (0..*) amount int (1..1)
 output: result int (0..*)
 set result: [groups extract [values], amount]`;
