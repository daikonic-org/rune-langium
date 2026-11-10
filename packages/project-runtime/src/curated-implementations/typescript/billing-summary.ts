// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { billingAssetUnits, billingFailures, billingTransferKinds, billingUnits } from '../billing-summary.js';
import { decimalSupport } from './decimal.js';

const variants = billingTransferKinds
  .map(
    (kind) =>
      `...('${kind}' in choice && choice.${kind} != null ? [{ kind: '${kind}' as const, transfer: choice.${kind} }] : [])`
  )
  .join(',\n        ');

export const createBillingSummary = {
  call: true,
  dependencies: [],
  expression: `(records) => {
    ${decimalSupport('BillingSummary')}
    const errors = ${JSON.stringify(billingFailures)};
    const isObject = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const object = (value: unknown) => isObject(value) ? value : {};
    const string = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;
    const scalar = (value: unknown) => isObject(value) && 'value' in value ? value.value : value;
    const partyKeys = (reference: unknown): string[] => {
      const ref = object(reference);
      const party = object(ref.value ?? reference);
      const meta = object(party.meta);
      const scoped = object(ref.reference);
      const global = string(ref.globalReference) ?? string(meta.globalKey);
      const external = string(ref.externalReference) ?? string(meta.externalKey);
      const keys: string[] = [];
      if (global !== undefined) keys.push(rune.valueKey(['global', global]));
      if (external !== undefined) keys.push(rune.valueKey(['external', external]));
      if (string(scoped.reference) !== undefined) keys.push(rune.valueKey(['scoped', scoped]));
      for (const entry of rune.list(party.partyId)) {
        const { identifier, identifierType } = object(entry);
        const id = string(scalar(identifier));
        if (id !== undefined) keys.push(rune.valueKey(['identifier', identifierType, object(identifier).meta, id]));
      }
      return keys;
    };
    const assetUnits = ${JSON.stringify(billingAssetUnits)};
    const rows = records.map(({ recordTransfer: choice }) => {
      if (!choice) throw new TypeError(errors.choice);
      const branches = [
        ${variants}
      ];
      const [branch] = branches;
      if (!branch || branches.length !== 1) throw new TypeError(errors.choice);
      const { transfer, kind } = branch;
      const { asset, quantity, settlementDate, payerReceiver, transferType } = transfer;
      const corporateAction = branch.kind === 'contingentTransfer' ? branch.transfer.corporateActionTransferType : undefined;
      const assets = (${JSON.stringify(Object.keys(billingAssetUnits))} as const).filter((key) => object(asset)[key] != null);
      const units = ${JSON.stringify(billingUnits)}.filter((key) => scalar(object(quantity?.unit)[key]) != null);
      const requiredUnit = assets[0] === undefined ? undefined : assetUnits[assets[0]];
      if (!quantity?.unit || !asset || assets.length !== 1 || units.length !== 1
          || (requiredUnit != null && requiredUnit !== units[0])
          || !settlementDate || !(settlementDate.adjustedDate || settlementDate.unadjustedDate || settlementDate.relativeDate)
          || (kind === 'scheduledTransfer' && transferType == null)
          || (kind === 'contingentTransfer' && transferType === 'CorporateAction' && corporateAction == null)) {
        throw new TypeError(errors.terms);
      }
      if (typeof quantity.value !== 'number' || !Number.isFinite(quantity.value) || quantity.value < 0) {
        throw new TypeError(errors.amount);
      }
      const payer = payerReceiver?.payerPartyReference;
      const receiver = payerReceiver?.receiverPartyReference;
      if (!payer || !receiver) throw new TypeError(errors.parents);
      return {
        branch, asset, unit: quantity.unit, settlementDate, payer, receiver,
        amount: decimal(quantity.value),
        terms: rune.valueKey([kind, transferType, corporateAction, asset, quantity.unit, settlementDate]),
        payerKeys: new Set(partyKeys(payer)), receiverKeys: new Set(partyKeys(receiver))
      };
    });
    const [first] = rows;
    if (!first) throw new TypeError(errors.choice);
    if (rows.some((row) => row.terms !== first.terms)) throw new TypeError(errors.group);
    const sameParents = (side: 'payerKeys' | 'receiverKeys') =>
      [...first[side]].some((key) => rows.every((row) => row[side].has(key)));
    if (!sameParents('payerKeys') || !sameParents('receiverKeys')) throw new TypeError(errors.parents);

    const scale = rows.reduce((max, row) => Math.max(max, row.amount.scale), first.amount.scale);
    const coefficient = rows.reduce(
      (sum, row) => sum + row.amount.coefficient * 10n ** BigInt(scale - row.amount.scale),
      0n
    );
    const common = {
      asset: first.asset,
      settlementDate: first.settlementDate,
      quantity: { unit: first.unit, value: result({ coefficient, scale, negative: false }) },
      payerReceiver: { payerPartyReference: first.payer, receiverPartyReference: first.receiver }
    };
    const { branch } = first;
    const summaryAmountType = 'ParentTotal' as const;
    switch (branch.kind) {
      case 'scheduledTransfer':
        return { summaryAmountType, summaryTransfer: { scheduledTransfer: { ...common, transferType: branch.transfer.transferType } } };
      case 'unscheduledTransfer':
        return { summaryAmountType, summaryTransfer: { unscheduledTransfer: { ...common, transferType: branch.transfer.transferType } } };
      case 'contingentTransfer':
        return { summaryAmountType, summaryTransfer: { contingentTransfer: {
          ...common,
          transferType: branch.transfer.transferType,
          corporateActionTransferType: branch.transfer.corporateActionTransferType
        } } };
    }
  }`
} as const;
