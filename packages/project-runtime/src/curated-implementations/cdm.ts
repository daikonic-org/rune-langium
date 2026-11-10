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
import * as typescriptRounding from './typescript/rounding.js';
import * as pythonRounding from './python/rounding.js';
import * as typescriptVectors from './typescript/vectors.js';
import * as pythonVectors from './python/vectors.js';
import { today as typescriptToday } from './typescript/today.js';
import { today as pythonToday } from './python/today.js';
import { commodityCalculationPeriods as typescriptCommodityPeriods } from './typescript/commodity-periods.js';
import { commodityCalculationPeriods as pythonCommodityPeriods } from './python/commodity-periods.js';
import { loadCodeList as typescriptLoadCodeList } from './typescript/load-code-list.js';
import { loadCodeList as pythonLoadCodeList } from './python/load-code-list.js';
import type { CdmCodeListCatalog } from './code-list-resources.js';
import { FunctionImplementationSchema, type FunctionImplementation } from '@rune-langium/core/project-contract';

type NativeTarget = ImplementationLocation &
  (NativeImplementationBody | { bindCodeLists: (catalog: CdmCodeListCatalog) => NativeImplementationBody });

export interface NativeImplementation {
  readonly kind: 'language-specific';
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly signature: NativeFunctionShape;
  readonly targets: Readonly<Partial<Record<ImplementationLanguage, NativeTarget>>>;
}
interface RuneImplementation {
  readonly kind: 'rune';
  readonly namespace: string;
  readonly name: string;
  readonly signature: NativeFunctionShape;
  readonly path: string;
  readonly files: readonly string[];
}

const calculationPeriodDates = {
  name: 'calculationPeriodDates',
  type: 'cdm.product.common.schedule.CalculationPeriodDates',
  kind: 'Data',
  card: [1, 1],
  plain: true
} as const;
const calculationPeriodResult = {
  name: 'result',
  type: 'cdm.product.common.schedule.CalculationPeriodData',
  kind: 'Data',
  card: [1, 1],
  plain: true
} as const;
const strataFrequencySources = [
  'strata-frequency.rosetta',
  'cdm-strata-frequency.rosetta',
  'strata-LICENSE.txt',
  'strata-NOTICE.txt'
];

/** Audited publication signatures; selection never occurs in a generator. */
const signatures: Readonly<Record<string, NativeFunctionShape>> = {
  CalculationPeriod: {
    inputs: [
      calculationPeriodDates,
      { name: 'date', type: 'com.rosetta.model.date', kind: 'RosettaRecordType', card: [1, 1], plain: true }
    ],
    output: calculationPeriodResult
  },
  CalculationPeriods: {
    inputs: [calculationPeriodDates],
    output: { ...calculationPeriodResult, card: [0, '*'] }
  },
  LoadCodeList: {
    inputs: [{ name: 'domain', type: 'com.rosetta.model.string', kind: 'RosettaBasicType', card: [1, 1], plain: true }],
    output: { name: 'codelist', type: 'cdm.base.staticdata.codelist.CodeList', kind: 'Data', card: [0, 1], plain: true }
  },
  CalculateCommodityCalculationPeriods: {
    inputs: [
      {
        name: 'fpmlCommodityCalculationPeriodsSchedule',
        type: 'fpml.consolidated.com.CommodityCalculationPeriodsSchedule',
        kind: 'Data',
        card: [0, 1],
        plain: true
      },
      { name: 'effectiveDate', type: 'com.rosetta.model.date', kind: 'RosettaRecordType', card: [0, 1], plain: true },
      { name: 'terminationDate', type: 'com.rosetta.model.date', kind: 'RosettaRecordType', card: [0, 1], plain: true }
    ],
    output: {
      name: 'commodityCalculationPeriods',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [0, '*'],
      plain: true
    }
  },
  ResolveAdjustableDates: {
    inputs: [
      {
        name: 'adjustableRelativeOrPeriodicDates',
        type: 'cdm.base.datetime.AdjustableRelativeOrPeriodicDates',
        kind: 'Data',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'adjustedDates',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [0, '*'],
      plain: true
    }
  },
  ResolveAdjustableDate: {
    inputs: [
      {
        name: 'adjustableOrRelativeDate',
        type: 'cdm.base.datetime.AdjustableOrRelativeDate',
        kind: 'Data',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'adjustedDate',
      type: 'com.rosetta.model.date',
      kind: 'RosettaRecordType',
      card: [0, 1],
      plain: true
    }
  },
  CalculationPeriodRange: {
    inputs: [
      { name: 'startDate', type: 'com.rosetta.model.date', kind: 'RosettaRecordType', card: [0, 1], plain: true },
      { name: 'endDate', type: 'com.rosetta.model.date', kind: 'RosettaRecordType', card: [0, 1], plain: true },
      {
        name: 'dateAdjustments',
        type: 'cdm.base.datetime.BusinessDayAdjustments',
        kind: 'Data',
        card: [0, 1],
        plain: true
      }
    ],
    output: {
      name: 'result',
      type: 'cdm.product.common.schedule.CalculationPeriodData',
      kind: 'Data',
      card: [1, 1],
      plain: true
    }
  },
  VectorGrowthOperation: {
    inputs: [
      {
        name: 'baseValue',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'factor',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [0, '*'],
        plain: true
      }
    ],
    output: {
      name: 'result',
      type: 'com.rosetta.model.number',
      kind: 'RosettaBasicType',
      card: [0, '*'],
      plain: true
    }
  },
  VectorOperation: {
    inputs: [
      {
        name: 'arithmeticOp',
        type: 'cdm.base.math.ArithmeticOperationEnum',
        kind: 'RosettaEnumeration',
        card: [1, 1],
        plain: true,
        enumValues: ['Add', 'Subtract', 'Multiply', 'Divide', 'Max', 'Min']
      },
      {
        name: 'left',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [0, '*'],
        plain: true
      },
      {
        name: 'right',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [0, '*'],
        plain: true
      }
    ],
    output: {
      name: 'result',
      type: 'com.rosetta.model.number',
      kind: 'RosettaBasicType',
      card: [0, '*'],
      plain: true
    }
  },
  RoundToNearest: {
    inputs: [
      {
        name: 'value',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'nearest',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'roundingMode',
        type: 'cdm.base.math.RoundingModeEnum',
        kind: 'RosettaEnumeration',
        card: [1, 1],
        plain: true,
        enumValues: ['Down', 'Up']
      }
    ],
    output: {
      name: 'roundedValue',
      type: 'com.rosetta.model.number',
      kind: 'RosettaBasicType',
      card: [1, 1],
      plain: true
    }
  },
  RoundToSignificantFigures: {
    inputs: [
      {
        name: 'value',
        type: 'com.rosetta.model.number',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      },
      {
        name: 'significantFigures',
        type: 'com.rosetta.model.int',
        kind: 'RosettaTypeAlias',
        card: [1, 1],
        plain: true
      },
      {
        name: 'roundingMode',
        type: 'cdm.base.math.RoundingDirectionEnum',
        kind: 'RosettaEnumeration',
        card: [1, 1],
        plain: true,
        enumValues: ['Up', 'Down', 'Nearest']
      }
    ],
    output: {
      name: 'roundedValue',
      type: 'com.rosetta.model.number',
      kind: 'RosettaBasicType',
      card: [1, 1],
      plain: true
    }
  },
  RoundToPrecision: {
    inputs: [
      { name: 'value', type: 'com.rosetta.model.number', kind: 'RosettaBasicType', card: [1, 1], plain: true },
      { name: 'precision', type: 'com.rosetta.model.int', kind: 'RosettaTypeAlias', card: [1, 1], plain: true },
      {
        name: 'roundingMode',
        type: 'cdm.base.math.RoundingDirectionEnum',
        kind: 'RosettaEnumeration',
        card: [1, 1],
        plain: true,
        enumValues: ['Up', 'Down', 'Nearest']
      },
      {
        name: 'removeTrailingZeros',
        type: 'com.rosetta.model.boolean',
        kind: 'RosettaBasicType',
        card: [1, 1],
        plain: true
      }
    ],
    output: {
      name: 'roundedValue',
      type: 'com.rosetta.model.number',
      kind: 'RosettaBasicType',
      card: [1, 1],
      plain: true
    }
  },
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
  MapCommodityOptionStrikePriceSchedule: {
    inputs: [
      {
        name: 'fpmlStrikePricePerUnitStepList',
        type: 'fpml.consolidated.shared.NonNegativeMoney',
        kind: 'Data',
        card: [0, '*'],
        plain: true
      },
      {
        name: 'fpmlCommodityStrikePriceDateList',
        type: 'com.rosetta.model.date',
        kind: 'RosettaRecordType',
        card: [0, '*'],
        plain: true
      }
    ],
    output: {
      name: 'strikePriceSchedule',
      type: 'cdm.base.math.DatedValue',
      kind: 'Data',
      card: [0, '*'],
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
  ...(
    [
      {
        name: 'RoundToPrecision',
        id: 'cdm.round-to-precision',
        module: 'rounding',
        entrypoint: 'roundToPrecision',
        typescript: typescriptRounding.roundToPrecision,
        python: pythonRounding.roundToPrecision
      },
      {
        name: 'RoundToNearest',
        id: 'cdm.round-to-nearest',
        module: 'rounding',
        entrypoint: 'roundToNearest',
        typescript: typescriptRounding.roundToNearest,
        python: pythonRounding.roundToNearest
      },
      {
        name: 'RoundToSignificantFigures',
        id: 'cdm.round-to-significant-figures',
        module: 'rounding',
        entrypoint: 'roundToSignificantFigures',
        typescript: typescriptRounding.roundToSignificantFigures,
        python: pythonRounding.roundToSignificantFigures
      },
      {
        name: 'VectorOperation',
        id: 'cdm.vector-operation',
        module: 'vectors',
        entrypoint: 'vectorOperation',
        typescript: typescriptVectors.vectorOperation,
        python: pythonVectors.vectorOperation
      },
      {
        name: 'VectorGrowthOperation',
        id: 'cdm.vector-growth-operation',
        module: 'vectors',
        entrypoint: 'vectorGrowthOperation',
        typescript: typescriptVectors.vectorGrowthOperation,
        python: pythonVectors.vectorGrowthOperation
      }
    ] as const
  ).map(({ name, id, module, entrypoint, typescript, python }): NativeImplementation => ({
    kind: 'language-specific',
    id,
    namespace: 'cdm.base.math',
    name,
    signature: signatures[name]!,
    targets: {
      typescript: {
        ...typescript,
        path: `packages/project-runtime/src/curated-implementations/typescript/${module}.ts`,
        entrypoint
      },
      python: {
        ...python,
        path: `packages/project-runtime/src/curated-implementations/python/${module}.ts`,
        entrypoint
      }
    }
  })),
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
  utility('ToTime'),
  utility('Now'),
  utility('StringContains', 'cdm.ingest.fpml.confirmation.common'),
  {
    kind: 'language-specific',
    id: 'cdm.load-code-list',
    namespace: 'cdm.base.staticdata.codelist',
    name: 'LoadCodeList',
    signature: signatures.LoadCodeList!,
    targets: {
      typescript: {
        bindCodeLists: typescriptLoadCodeList,
        path: 'packages/project-runtime/src/curated-implementations/typescript/load-code-list.ts',
        entrypoint: 'loadCodeList'
      },
      python: {
        bindCodeLists: pythonLoadCodeList,
        path: 'packages/project-runtime/src/curated-implementations/python/load-code-list.ts',
        entrypoint: 'loadCodeList'
      }
    }
  },
  {
    kind: 'language-specific',
    id: 'cdm.commodity-calculation-periods',
    namespace: 'cdm.ingest.fpml.confirmation.product.commodityoption',
    name: 'CalculateCommodityCalculationPeriods',
    signature: signatures.CalculateCommodityCalculationPeriods!,
    targets: {
      typescript: {
        ...typescriptCommodityPeriods,
        path: 'packages/project-runtime/src/curated-implementations/typescript/commodity-periods.ts',
        entrypoint: 'commodityCalculationPeriods'
      },
      python: {
        ...pythonCommodityPeriods,
        path: 'packages/project-runtime/src/curated-implementations/python/commodity-periods.ts',
        entrypoint: 'commodityCalculationPeriods'
      }
    }
  },
  ...[
    { name: 'AddDays', path: 'add-days.rosetta', support: ['gregorian.rosetta'] },
    { name: 'DateDifference', path: 'date-difference.rosetta', support: [] },
    { name: 'LeapYearDateDifference', path: 'leap-year-date-difference.rosetta', support: ['gregorian.rosetta'] },
    { name: 'DayOfWeek', path: 'day-of-week.rosetta', support: [] },
    { name: 'ResolveAdjustableDate', path: 'resolve-adjustable-date.rosetta', support: ['weekend-adjustment.rosetta'] },
    {
      name: 'ResolveAdjustableDates',
      path: 'resolve-adjustable-dates.rosetta',
      support: ['weekend-adjustment.rosetta']
    }
  ].map(({ name, path, support }): RuneImplementation => ({
    kind: 'rune',
    namespace: 'cdm.base.datetime',
    name,
    signature: signatures[name]!,
    path,
    files: [...support, path]
  })),
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
    name: 'CalculationPeriodRange',
    signature: signatures.CalculationPeriodRange!,
    path: 'period-range.rosetta',
    files: ['period-range.rosetta']
  },
  {
    kind: 'rune',
    namespace: 'cdm.product.common.schedule',
    name: 'PeriodsInYear',
    signature: signatures.PeriodsInYear!,
    path: 'frequency.rosetta',
    files: [...strataFrequencySources, 'frequency.rosetta']
  },
  ...['CalculationPeriod', 'CalculationPeriods'].map((name): RuneImplementation => ({
    kind: 'rune',
    namespace: 'cdm.product.common.schedule',
    name,
    signature: signatures[name]!,
    path: 'calculation-schedules.rosetta',
    files: [
      ...strataFrequencySources,
      'strata-rolls.rosetta',
      'strata-periodic-schedule.rosetta',
      'cdm-schedule-adapter.rosetta',
      'calculation-schedules.rosetta',
      'period-range.rosetta',
      'date-difference.rosetta',
      'leap-year-date-difference.rosetta',
      'gregorian.rosetta',
      'resolve-adjustable-date.rosetta',
      'weekend-adjustment.rosetta',
      'add-days.rosetta',
      'day-of-week.rosetta'
    ]
  })),
  {
    kind: 'rune',
    namespace: 'cdm.ingest.fpml.confirmation.pricequantity',
    name: 'MapCommodityOptionStrikePriceSchedule',
    signature: signatures.MapCommodityOptionStrikePriceSchedule!,
    path: 'strike-schedule.rosetta',
    files: ['strike-schedule-state.rosetta', 'strike-schedule.rosetta']
  }
];
if (new Set(CDM_IMPLEMENTATIONS.map((entry) => `${entry.namespace}.${entry.name}`)).size !== CDM_IMPLEMENTATIONS.length)
  throw new Error('Each curated function must have exactly one implementation kind.');
export const NATIVE_IMPLEMENTATIONS = CDM_IMPLEMENTATIONS.filter((entry) => entry.kind === 'language-specific');
export const RUNE_IMPLEMENTATIONS = CDM_IMPLEMENTATIONS.filter((entry) => entry.kind === 'rune');
/** Pure publication selection, shared with the audit and generator fixtures without storage dependencies. */
export function curatedModelImplementations(
  model: RosettaModel,
  codeLists?: CdmCodeListCatalog
): ReadonlyMap<number, FunctionImplementation> {
  const result = new Map<number, FunctionImplementation>();
  for (const [index, node] of model.elements.entries()) {
    if (!isRosettaFunction(node)) continue;
    const selected = selectCdmImplementation(node, codeLists);
    if (selected) result.set(index, selected);
  }
  return result;
}
/** Called by curated publication and its audit, never by a generator. */
export function selectCdmImplementation(
  func: RosettaFunction,
  codeLists?: CdmCodeListCatalog
): FunctionImplementation | undefined {
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
  const targets = (['typescript', 'python'] as const).flatMap((language) => {
    const target = entry.targets[language];
    if (!target) return [];
    const { path, entrypoint } = target;
    const body = 'bindCodeLists' in target ? (codeLists?.size ? target.bindCodeLists(codeLists) : undefined) : target;
    return body ? [[language, { path, entrypoint, ...body, dependencies: [...body.dependencies] }]] : [];
  });
  if (!targets.length) return undefined;
  return FunctionImplementationSchema.parse({
    kind: 'language-specific',
    namespace: entry.namespace,
    name: entry.name,
    id: entry.id,
    signature: nativeFunctionShape(func),
    targets: Object.fromEntries(targets)
  });
}
