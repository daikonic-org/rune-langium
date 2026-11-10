// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { billingAssetUnits, billingFailures, billingTransferKinds, billingUnits } from '../billing-summary.js';
import { finiteNumber, finiteResult } from './numbers.js';

const field = '(lambda obj, key: obj.get(key) if isinstance(obj, dict) else None)';
const scalar = "(lambda value: value.get('value') if isinstance(value, dict) and 'value' in value else value)";
const text = '(lambda value: value if isinstance(value, str) and value else None)';
const fail = '(lambda message: (_ for _ in ()).throw(ValueError(message)))';

const partyKeys = `(lambda ref:
    (lambda party, scoped:
        [
            rune.valueKey([kind, key])
            for kind, key in (
                ('global', text(field(ref, 'globalReference')) or text(field(field(party, 'meta'), 'globalKey'))),
                ('external', text(field(ref, 'externalReference')) or text(field(field(party, 'meta'), 'externalKey'))),
                ('scoped', scoped if text(field(scoped, 'reference')) else None)
            )
            if key is not None
        ] + [
            rune.valueKey(['identifier', field(item, 'identifierType'), field(identifier, 'meta'), scalar(identifier)])
            for item in rune.list(field(party, 'partyId'))
            for identifier in [field(item, 'identifier')]
            if text(scalar(identifier)) is not None
        ]
    )(field(ref, 'value') or ref, field(ref, 'reference'))
)`;

const terms = `(lambda kind, transfer, asset, unit, date:
    (lambda assets, units, required_units:
        len(assets) == len(units) == 1
        and (required_units.get(assets[0]) is None or required_units[assets[0]] == units[0])
        and any(field(date, name) is not None for name in ('adjustedDate', 'unadjustedDate', 'relativeDate'))
        and (kind != 'scheduledTransfer' or field(transfer, 'transferType') is not None)
        and (kind != 'contingentTransfer' or field(transfer, 'transferType') != 'CorporateAction'
             or field(transfer, 'corporateActionTransferType') is not None)
    )(
        [key for key in ${JSON.stringify(Object.keys(billingAssetUnits))} if field(asset, key) is not None],
        [key for key in ${JSON.stringify(billingUnits)} if scalar(field(unit, key)) is not None],
        ${JSON.stringify(billingAssetUnits).replace('null', 'None')}
    )
)`;

const prepare = `(lambda kind, transfer:
    (lambda quantity, asset, date, parents:
        (lambda amount, unit:
            {
                'kind': kind,
                'transfer': transfer,
                'amount': amount,
                'terms': rune.valueKey([kind, field(transfer, 'transferType'),
                    field(transfer, 'corporateActionTransferType') if kind == 'contingentTransfer' else None,
                    asset, unit, date]),
                'payerKeys': set(keys(field(parents, 'payerPartyReference'))),
                'receiverKeys': set(keys(field(parents, 'receiverPartyReference')))
            }
            if ${finiteNumber('amount')} and amount >= 0 else fail(errors['amount'])
        )(field(quantity, 'value'), field(quantity, 'unit'))
        if valid_terms(kind, transfer, asset, field(quantity, 'unit'), date) else fail(errors['terms'])
    )(field(transfer, 'quantity'), field(transfer, 'asset'), field(transfer, 'settlementDate'), field(transfer, 'payerReceiver'))
)`;

const summarize = `(lambda first, total:
    (lambda transfer: {
        'summaryAmountType': 'ParentTotal',
        'summaryTransfer': {first['kind']: {
            'asset': transfer['asset'],
            'settlementDate': transfer['settlementDate'],
            'quantity': {'unit': transfer['quantity']['unit'], 'value': total},
            'payerReceiver': {
                'payerPartyReference': transfer['payerReceiver']['payerPartyReference'],
                'receiverPartyReference': transfer['payerReceiver']['receiverPartyReference']
            },
            **{name: transfer[name] for name in ('transferType', 'corporateActionTransferType')
               if field(transfer, name) is not None}
        }}
    })(first['transfer'])
)`;

const decimalSum = `(lambda amounts:
    (lambda Decimal, Fraction, result:
        result(sum(Fraction(Decimal(str(float(amount)))) for amount in amounts))
    )(__import__('decimal').Decimal, __import__('fractions').Fraction, ${finiteResult('BillingSummary')})
)`;

export const createBillingSummary = {
  call: true,
  dependencies: ['decimal', 'fractions'],
  expression: `(lambda records:
    (lambda field, scalar, text, fail, errors, total:
        (lambda keys, valid_terms, summarize:
            (lambda prepare:
                (lambda rows:
                    summarize(rows[0], total([row['amount'] for row in rows]))
                    if all(row['terms'] == rows[0]['terms'] for row in rows)
                       and all(set.intersection(*(row[side] for row in rows)) for side in ('payerKeys', 'receiverKeys'))
                    else fail(errors['parents'] if all(row['terms'] == rows[0]['terms'] for row in rows) else errors['group'])
                )([
                    prepare(*branches[0]) if len(branches) == 1 else fail(errors['choice'])
                    for record in records
                    for choice in [field(record, 'recordTransfer')]
                    for branches in [[(kind, field(choice, kind)) for kind in ${JSON.stringify(billingTransferKinds)}
                                     if field(choice, kind) is not None]]
                ]) if records else fail(errors['choice'])
            )(${prepare})
        )(${partyKeys}, ${terms}, ${summarize})
    )(${field}, ${scalar}, ${text}, ${fail}, ${JSON.stringify(billingFailures)}, ${decimalSum})
)`
} as const;
