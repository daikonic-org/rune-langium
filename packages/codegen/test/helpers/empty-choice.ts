// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const emptyChoiceSource = `namespace test.emptyChoices
type Leaf:
 value int (1..1)
choice Selection:
 Leaf
type Empty:
func EmptyList:
 output: result Selection (0..*)
 set result: [Selection { ... }]
func EmptyCount:
 output: result int (1..1)
 set result: [Selection { ... }] count
func MixedList:
 output: result Selection (0..*)
 set result: [Selection { ... }, Selection { leaf: Leaf { value: 7 } }]
func DataCount:
 output: result int (1..1)
 set result: [Empty { ... }] count
func AliasCount:
 output: result int (1..1)
 alias blank: Selection { ... }
 set result: [blank] count
func RequireList:
 output: result Selection (1..*)
 set result: [Selection { ... }]
func ReceiveOne:
 inputs: selection Selection (1..1)
 output: result boolean (1..1)
 set result: True
func RequireArgument:
 output: result boolean (1..1)
 set result: ReceiveOne(Selection { ... })
`;
