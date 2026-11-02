// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const inheritedArraySource = `namespace test.inheritedArray
type TradeIdentifier extends Identifier:
type Identifier:
 assignedIdentifier AssignedIdentifier (1..*)
 parent Identifier (0..1)
type AssignedIdentifier:
 identifier string (1..1)
type Trade:
 tradeIdentifier TradeIdentifier (1..*)
`;

export const inheritedArrayValue = {
  tradeIdentifier: [{ assignedIdentifier: [{ identifier: 'gas-trade' }] }]
};
