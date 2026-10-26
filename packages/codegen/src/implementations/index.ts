// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getElementNamespace,
  getFunctionInputs,
  getFunctionOutput,
  isRosettaRecordType,
  type RosettaFunction
} from '@rune-langium/core';
import { today as typescriptToday } from './typescript/today.js';
import { today as pythonToday } from './python/today.js';

export type ImplementationLanguage = 'typescript' | 'python';

export interface NativeImplementationBody {
  readonly expression: string;
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
export const NATIVE_IMPLEMENTATIONS: readonly NativeImplementation[] = [
  {
    id: 'cdm.utc-today',
    namespace: 'cdm.base.datetime',
    name: 'Today',
    signature: '() -> today com.rosetta.model.date (1..1)',
    matches(func) {
      const output = getFunctionOutput(func);
      const type = output?.typeCall?.type.ref;
      return (
        !func.superFunction &&
        !func.dispatchAttribute &&
        !func.dispatchValue &&
        getFunctionInputs(func).length === 0 &&
        output?.name === 'today' &&
        output.card.inf === 1 &&
        output.card.sup === 1 &&
        !output.card.unbounded &&
        output.annotations.length === 0 &&
        !output.typeCall?.arguments.length &&
        isRosettaRecordType(type) &&
        type.name === 'date' &&
        getElementNamespace(type) === 'com.rosetta.model'
      );
    },
    targets: { typescript: typescriptToday, python: pythonToday }
  }
];

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
