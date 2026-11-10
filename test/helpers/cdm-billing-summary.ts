// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCuratedRuneProject } from './curated-rune-project.js';

export const billingDirectory = resolve(import.meta.dirname, '../fixtures/third-party/cdm-billing-summary');
export const billingDeclaration = {
  namespace: 'cdm.event.common',
  name: 'Create_BillingSummary',
  kind: 'RosettaFunction'
} as const;
type TransferKind = 'scheduledTransfer' | 'unscheduledTransfer' | 'contingentTransfer';
interface BillingPayment {
  amount: number;
  kind?: TransferKind;
  currency?: string;
  date?: string;
  payer?: 'otherScope' | 'empty' | 'embedded';
  receiver?: 'other';
  embeddedReceiver?: boolean;
  incomplete?: boolean;
}
export const billingCases: {
  id: string;
  inputs: BillingPayment[];
  expectedAmount?: number;
  expectedError?: string;
}[] = JSON.parse(readFileSync(resolve(billingDirectory, 'cases.json'), 'utf8'));

export function billingRecords(inputs: readonly BillingPayment[]) {
  return inputs.map(
    (
      {
        amount,
        kind = 'scheduledTransfer',
        currency = 'USD',
        date = '2024-02-02',
        payer,
        receiver,
        embeddedReceiver,
        incomplete
      },
      index
    ) => {
      const asset = {
        cash: {
          assetType: 'Cash',
          identifier: [{ identifier: { value: currency, meta: {} }, identifierType: 'CurrencyCode' }]
        }
      };
      const settlementDate = { adjustedDate: { value: date, meta: {} } };
      const unit = { currency: { value: currency, meta: {} } };
      const payerPartyReference =
        payer === 'embedded'
          ? { value: { partyId: [{ identifier: { value: 'PAYER-LEI', meta: { scheme: 'urn:lei' } } }] } }
          : payer === 'empty'
            ? {}
            : { reference: { scope: payer === 'otherScope' ? 'another-invoice' : 'invoice', reference: 'payer' } };
      const receiverPartyReference = {
        globalReference: receiver === 'other' ? 'other-receiver' : 'receiver',
        ...(embeddedReceiver
          ? { value: { partyId: [{ identifier: { value: 'RECEIVER-LEI', meta: { scheme: 'urn:lei' } } }] } }
          : {})
      };
      const payerReceiver = {
        payerPartyReference,
        receiverPartyReference,
        payerAccountReference: { externalReference: 'payer-account-' + index },
        receiverAccountReference: { externalReference: 'receiver-account-' + index }
      };
      const classification =
        kind === 'scheduledTransfer'
          ? { transferType: 'InterestReturn' }
          : kind === 'unscheduledTransfer'
            ? { transferType: 'BrokerageCommission' }
            : { transferType: 'CorporateAction', corporateActionTransferType: 'Dividend' };
      return {
        tradeState: { globalReference: 'trade-' + index },
        recordStartDate: '2024-01-01',
        recordEndDate: '2024-02-01',
        minimumFee: { value: 50, unit },
        recordTransfer: {
          [kind]: incomplete
            ? { settlementDate }
            : { asset, settlementDate, quantity: { value: amount, unit }, payerReceiver, ...classification }
        }
      };
    }
  );
}

export const billingCaller = {
  uri: 'file:///model/billing.rosetta',
  content: `namespace example.billing
import cdm.event.common.*
import cdm.base.datetime.*
import cdm.base.math.*
import cdm.base.staticdata.asset.common.*
import cdm.base.staticdata.party.*
import cdm.product.common.settlement.*

func ExampleBillingRecord:
    inputs: amount number (1..1)
    output: record BillingRecord (1..1)
    set record: BillingRecord {
        tradeState: empty with-meta { reference: "trade" },
        recordStartDate: date {year: 2024, month: 1, day: 1},
        recordEndDate: date {year: 2024, month: 2, day: 1},
        recordTransfer: Transfer {
            ScheduledTransfer: ScheduledTransfer {
                asset: Asset {
                    Cash: Cash {
                        assetType: AssetTypeEnum -> Cash,
                        identifier: [AssetIdentifier { identifier: "USD", identifierType: AssetIdTypeEnum -> CurrencyCode }]
                    }
                },
                quantity: NonNegativeQuantity { value: amount, unit: UnitType { currency: "USD" } },
                settlementDate: AdjustableOrAdjustedOrRelativeDate { adjustedDate: date {year: 2024, month: 2, day: 2} },
                transferType: ScheduledTransferEnum -> InterestReturn,
                payerReceiver: PartyReferencePayerReceiver {
                    payerPartyReference: empty with-meta { reference: "payer" },
                    receiverPartyReference: empty with-meta { reference: "receiver" }
                }
            }
        }
    }

func SummarizeBilling:
    inputs:
        firstAmount number (1..1)
        secondAmount number (1..1)
    output: summary BillingSummary (1..1)
    set summary: Create_BillingSummary([ExampleBillingRecord(firstAmount), ExampleBillingRecord(secondAmount)])
`
};

export function createCuratedBillingProject() {
  return createCuratedRuneProject(billingDirectory, billingCaller);
}
