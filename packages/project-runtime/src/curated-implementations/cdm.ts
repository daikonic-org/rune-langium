// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { getElementNamespace, isRosettaFunction, type RosettaFunction, type RosettaModel } from '@rune-langium/core';
import {
  nativeFunctionShape,
  matchesNativeFunction,
  type NativeFunctionShape,
  type NativeImplementationBody,
  type ImplementationLanguage,
  type ImplementationLocation
} from '@rune-langium/codegen/export';
import { utilities as typescriptUtilities } from './typescript/utilities.js';
import { utilities as pythonUtilities } from './python/utilities.js';
import { today as typescriptToday } from './typescript/today.js';
import { today as pythonToday } from './python/today.js';
import { FunctionImplementationSchema, type FunctionImplementation } from '@rune-langium/core/project-contract';

export interface NativeImplementation {
  readonly kind: 'language-specific';
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly signature: NativeFunctionShape;
  readonly targets: Readonly<
    Partial<Record<ImplementationLanguage, NativeImplementationBody & ImplementationLocation>>
  >;
}
interface RuneImplementation {
  readonly kind: 'rune';
  readonly namespace: string;
  readonly name: string;
  readonly signature: NativeFunctionShape;
  readonly path: string;
  readonly files: readonly string[];
}

/** Audited publication signatures; selection never occurs in a generator. */
const signatures: Readonly<Record<string, NativeFunctionShape>> = {
  EmptyExecutionDetails: {
    inputs: [],
    output: {
      name: 'executionDetails',
      type: 'cdm.event.common.ExecutionDetails',
      kind: 'Data',
      card: [0, 1],
      plain: true
    }
  },
  EmptyTransferHistory: {
    inputs: [],
    output: {
      name: 'emptyTransferHistory',
      type: 'cdm.event.common.TransferState',
      kind: 'Data',
      card: [0, '*'],
      plain: true
    }
  },
  ToTime: {
    inputs: [
      {
        name: 'hours',
        type: 'com.rosetta.model.int',
        kind: 'RosettaTypeAlias',
        card: [1, 1],
        plain: true
      },
      {
        name: 'minutes',
        type: 'com.rosetta.model.int',
        kind: 'RosettaTypeAlias',
        card: [1, 1],
        plain: true
      },
      {
        name: 'seconds',
        type: 'com.rosetta.model.int',
        kind: 'RosettaTypeAlias',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'time',
      type: 'com.rosetta.model.time',
      kind: 'RosettaBasicType',
      card: [1, 1],
      plain: true
    }
  },
  Now: {
    inputs: [],
    output: {
      name: 'now',
      type: 'com.rosetta.model.zonedDateTime',
      kind: 'RosettaRecordType',
      card: [1, 1],
      plain: true
    }
  },
  Today: {
    inputs: [],
    output: {
      name: 'today',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [1, 1],
      plain: true
    }
  },
  DayOfWeek: {
    inputs: [
      {
        name: 'date',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'dayOfWeek',
      type: 'cdm.base.datetime.DayOfWeekEnum',
      kind: 'RosettaEnumeration',
      card: [1, 1],
      plain: true,
      enumValues: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
    }
  },
  AddDays: {
    inputs: [
      {
        name: 'inputDate',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'numDays',
        type: 'com.rosetta.model.int',
        kind: 'RosettaTypeAlias',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'resultDate',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [1, 1],
      plain: true
    }
  },
  DateDifference: {
    inputs: [
      {
        name: 'firstDate',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'secondDate',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'difference',
      type: 'com.rosetta.model.int',
      kind: 'RosettaTypeAlias',
      card: [1, 1],
      plain: true
    }
  },
  LeapYearDateDifference: {
    inputs: [
      {
        name: 'firstDate',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'secondDate',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'difference',
      type: 'com.rosetta.model.int',
      kind: 'RosettaTypeAlias',
      card: [1, 1],
      plain: true
    }
  },
  PopOffDateList: {
    inputs: [
      {
        name: 'dates',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [0, '*'],
        plain: true
      }
    ],
    output: {
      name: 'newList',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [0, '*'],
      plain: true
    }
  },
  PeriodsInYear: {
    inputs: [
      {
        name: 'frequency',
        type: 'cdm.base.datetime.CalculationPeriodFrequency',
        kind: 'Data',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'numberOfPeriods',
      type: 'com.rosetta.model.int',
      kind: 'RosettaTypeAlias',
      card: [1, 1],
      plain: true
    }
  },
  StringContains: {
    inputs: [
      {
        name: 'input',
        type: 'com.rosetta.model.string',
        kind: 'RosettaBasicType',
        card: [0, 1],
        plain: true
      },
      {
        name: 'str',
        type: 'com.rosetta.model.string',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'result',
      type: 'com.rosetta.model.boolean',
      kind: 'RosettaBasicType',
      card: [1, 1],
      plain: true
    }
  }
};
const utility = (name: keyof typeof typescriptUtilities, namespace = 'cdm.base.datetime'): NativeImplementation => ({
  kind: 'language-specific',
  id: `cdm.${name}`,
  namespace,
  name,
  signature: signatures[name]!,
  targets: {
    typescript: {
      ...typescriptUtilities[name],
      path: 'packages/project-runtime/src/curated-implementations/typescript/utilities.ts',
      entrypoint: `utilities.${name}`
    },
    python: {
      ...pythonUtilities[name],
      path: 'packages/project-runtime/src/curated-implementations/python/utilities.ts',
      entrypoint: `utilities.${name}`
    }
  }
});
export const CDM_IMPLEMENTATIONS: readonly (NativeImplementation | RuneImplementation)[] = [
  {
    kind: 'language-specific',
    id: 'cdm.utc-today',
    namespace: 'cdm.base.datetime',
    name: 'Today',
    signature: signatures.Today!,
    targets: {
      typescript: {
        ...typescriptToday,
        path: 'packages/project-runtime/src/curated-implementations/typescript/today.ts',
        entrypoint: 'today'
      },
      python: {
        ...pythonToday,
        path: 'packages/project-runtime/src/curated-implementations/python/today.ts',
        entrypoint: 'today'
      }
    }
  },
  utility('AddDays'),
  utility('DateDifference'),
  utility('LeapYearDateDifference'),
  utility('DayOfWeek'),
  utility('ToTime'),
  utility('Now'),
  utility('StringContains', 'cdm.ingest.fpml.confirmation.common'),
  {
    kind: 'rune',
    namespace: 'cdm.event.common',
    name: 'EmptyExecutionDetails',
    signature: signatures.EmptyExecutionDetails!,
    path: 'event-common.rosetta',
    files: ['event-common.rosetta']
  },
  {
    kind: 'rune',
    namespace: 'cdm.event.common',
    name: 'EmptyTransferHistory',
    signature: signatures.EmptyTransferHistory!,
    path: 'event-common.rosetta',
    files: ['event-common.rosetta']
  },
  {
    kind: 'rune',
    namespace: 'cdm.base.datetime',
    name: 'PopOffDateList',
    signature: signatures.PopOffDateList!,
    path: 'date-list.rosetta',
    files: ['date-list-state.rosetta', 'date-list.rosetta']
  },
  {
    kind: 'rune',
    namespace: 'cdm.product.common.schedule',
    name: 'PeriodsInYear',
    signature: signatures.PeriodsInYear!,
    path: 'frequency.rosetta',
    files: ['strata-frequency.rosetta', 'frequency.rosetta', 'strata-LICENSE.txt', 'strata-NOTICE.txt']
  }
];
if (new Set(CDM_IMPLEMENTATIONS.map((entry) => `${entry.namespace}.${entry.name}`)).size !== CDM_IMPLEMENTATIONS.length)
  throw new Error('Each curated function must have exactly one implementation kind.');
export const NATIVE_IMPLEMENTATIONS = CDM_IMPLEMENTATIONS.filter((entry) => entry.kind === 'language-specific');
export const RUNE_IMPLEMENTATIONS = CDM_IMPLEMENTATIONS.filter((entry) => entry.kind === 'rune');
/** Pure publication selection, shared with the audit and generator fixtures without storage dependencies. */
export function curatedModelImplementations(model: RosettaModel): ReadonlyMap<number, FunctionImplementation> {
  const result = new Map<number, FunctionImplementation>();
  for (const [index, node] of model.elements.entries()) {
    if (!isRosettaFunction(node)) continue;
    const selected = selectCdmImplementation(node);
    if (selected) result.set(index, selected);
  }
  return result;
}
/** Called by curated publication and its audit, never by a generator. */
export function selectCdmImplementation(func: RosettaFunction): FunctionImplementation | undefined {
  if (
    func.operations.length ||
    !func.annotations.some(
      (ref) =>
        ref.annotation.ref?.name === 'codeImplementation' &&
        getElementNamespace(ref.annotation.ref) === 'com.rosetta.model'
    )
  )
    return undefined;
  const namespace = getElementNamespace(func);
  const entry = CDM_IMPLEMENTATIONS.find((entry) => entry.namespace === namespace && entry.name === func.name);
  if (!entry || !matchesNativeFunction(func, entry.signature)) return undefined;
  if (entry.kind === 'rune')
    return FunctionImplementationSchema.parse({
      kind: 'rune',
      namespace,
      name: func.name,
      signature: nativeFunctionShape(func),
      path: entry.path
    });
  return FunctionImplementationSchema.parse({
    kind: 'language-specific',
    namespace: entry.namespace,
    name: entry.name,
    id: entry.id,
    signature: nativeFunctionShape(func),
    targets: Object.fromEntries(
      (['typescript', 'python'] as const).flatMap((language) => {
        const body = entry.targets[language];
        return body ? [[language, { ...body, dependencies: [...body.dependencies] }]] : [];
      })
    )
  });
}
