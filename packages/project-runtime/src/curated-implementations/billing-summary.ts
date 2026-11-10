// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const billingTransferKinds = ['scheduledTransfer', 'unscheduledTransfer', 'contingentTransfer'] as const;
export const billingAssetUnits = {
  cash: 'currency',
  commodity: 'capacityUnit',
  digitalAsset: null,
  instrument: 'financialUnit'
} as const;
export const billingUnits = ['capacityUnit', 'weatherUnit', 'financialUnit', 'currency'] as const;
export const billingFailures = {
  choice: 'BillingSummary requires exactly one record transfer per billing record.',
  terms: 'BillingSummary requires complete asset, quantity unit, settlement date, and transfer classification.',
  amount: 'BillingSummary requires finite non-negative record amounts.',
  group: 'BillingSummary requires one settlement group with the same asset, unit, date, and transfer classification.',
  parents: 'BillingSummary requires the same identifiable payer and receiver across the records.'
} as const;
