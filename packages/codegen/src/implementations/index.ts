// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { getElementNamespace, type RosettaFunction } from '@rune-langium/core';
import { matchesNativeFunction, describeNativeFunction, type NativeFunctionShape } from './signature.js';
export { nativeFunctionShape, matchesNativeFunction, describeNativeFunction } from './signature.js';
export type { NativeFunctionShape, NativeParameterShape } from './signature.js';
import { utilities as typescriptUtilities } from './typescript/utilities.js';
import { utilities as pythonUtilities } from './python/utilities.js';
import { today as typescriptToday } from './typescript/today.js';
import { today as pythonToday } from './python/today.js';

export type ImplementationLanguage = 'typescript' | 'python';

export interface NativeImplementationBody {
  readonly expression: string;
  readonly call?: boolean;
  readonly dependencies: readonly string[];
}

export interface NativeImplementation {
  readonly id: string;
  readonly namespace: string;
  readonly name: string;
  readonly signature: string;
  readonly matches: (func: RosettaFunction) => boolean;
  readonly targets: Readonly<Partial<Record<ImplementationLanguage, NativeImplementationBody>>>;
}

/** Audited generator-owned bodies; never executable source loaded from a workspace. */
const signatures: Readonly<Record<string, NativeFunctionShape>> = {
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
  id: `cdm.${name}`,
  namespace,
  name,
  signature: describeNativeFunction(signatures[name]!),
  matches: (func) => matchesNativeFunction(func, signatures[name]!),
  targets: { typescript: typescriptUtilities[name], python: pythonUtilities[name] }
});
export const NATIVE_IMPLEMENTATIONS: readonly NativeImplementation[] = [
  {
    id: 'cdm.utc-today',
    namespace: 'cdm.base.datetime',
    name: 'Today',
    signature: describeNativeFunction(signatures.Today!),
    matches: (func) => matchesNativeFunction(func, signatures.Today!),
    targets: { typescript: typescriptToday, python: pythonToday }
  },
  utility('AddDays'),
  utility('DateDifference'),
  utility('LeapYearDateDifference'),
  utility('DayOfWeek'),
  utility('ToTime'),
  utility('Now'),
  utility('PopOffDateList'),
  utility('StringContains', 'cdm.ingest.fpml.confirmation.common')
];
/** Bind generator-owned expression functions to allocated parameter names, without textual substitution. */
export function nativeImplementationExpression(body: NativeImplementationBody, args: readonly string[]): string {
  return body.call ? `(${body.expression})(${args.join(', ')})` : body.expression;
}

export type NativeImplementationResolution =
  | { status: 'available'; id: string; body: NativeImplementationBody }
  | { status: 'unsupported'; reason: string };

/** Authored Rune bodies win. Match identity, annotation and signature before selecting a target body. */
export function resolveNativeImplementation(
  func: RosettaFunction,
  language: string
): NativeImplementationResolution | undefined {
  if (
    func.operations.length ||
    !func.annotations.some(
      (ref) =>
        ref.annotation.ref?.name === 'codeImplementation' &&
        getElementNamespace(ref.annotation.ref) === 'com.rosetta.model'
    )
  )
    return undefined;
  const qualified = `${getElementNamespace(func)}.${func.name}`;
  const entry = NATIVE_IMPLEMENTATIONS.find(
    (candidate) => candidate.namespace === getElementNamespace(func) && candidate.name === func.name
  );
  if (!entry) return { status: 'unsupported', reason: `No bundled ${language} implementation for ${qualified}.` };
  if (!entry.matches(func))
    return { status: 'unsupported', reason: `Bundled implementation ${entry.id} requires ${entry.signature}.` };
  const body = Object.prototype.hasOwnProperty.call(entry.targets, language)
    ? entry.targets[language as ImplementationLanguage]
    : undefined;
  return body
    ? { status: 'available', id: entry.id, body }
    : { status: 'unsupported', reason: `Bundled implementation ${entry.id} does not support ${language}.` };
}
