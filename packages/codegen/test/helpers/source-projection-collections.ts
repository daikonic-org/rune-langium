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
 set result: [groups extract [values], amount]
func Three:
 inputs: values int (3..3)
 output: result int (1..1)
 set result: values sum
func CheckedGroups:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: Three(groups extract [values])
func MixedGroups:
 inputs: groups Group (0..*) flag boolean (1..1)
 output: result int (1..1)
 set result: Three(if flag then groups extract [values] else 1)
func SwitchGroups:
 inputs: groups Group (0..*) selector int (1..1)
 output: result int (1..1)
 set result: Three(selector switch 0 then [4, 5, 6], 1 then (groups extract [values]), default empty)
func SwitchValues:
 inputs: groups Group (0..*) selector int (1..1)
 output: result int (0..*)
 set result: selector switch 0 then [4, 5, 6], 1 then (groups extract [values]), default empty
func CopyValues:
 inputs: values int (0..*)
 output: result int (0..*)
 set result: values
func MixedValues:
 inputs: groups Group (0..*) flag boolean (1..1) amount int (0..1)
 output: result int (0..*)
 set result: if flag then groups extract [values] else amount
func MixedArguments:
 inputs: groups Group (0..*) flag boolean (1..1) amount int (0..1)
 output: result int (0..*)
 set result: CopyValues(if flag then groups extract [values] else amount)
func PipeGroups:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: Three((groups extract [values]) then item)
func PipeValues:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) then item
func NestedPipeValues:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) then (item then item)
func BarePipeValues:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) then
func MixedPipeValues:
 inputs: groups Group (0..*) flag boolean (1..1) amount int (0..1)
 output: result int (0..*)
 set result: (if flag then groups extract [values] else amount) then item`;

export const sourceProjectionBoundaries = `namespace test.projectionBoundaries
type Group:
 values int (0..*)
func Scalar:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value
func ScalarArgument:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: Scalar(groups extract [values])
func ScalarAssignment:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: groups extract [values]
func OptionalAssignment:
 inputs: groups Group (0..*)
 output: result int (0..1)
 set result: groups extract [values]
func Identity:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) extract [item]
func NamedIdentity:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) extract group [group]
func BareIdentity:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) extract
func IdentityCount:
 inputs: groups Group (0..*)
 output: result int (1..1)
 set result: ((groups extract [values]) extract [item]) count
func Constant:
 inputs: groups Group (0..*)
 output: result int (0..*)
 set result: (groups extract [values]) extract [1]`;
