// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { getElementNamespace, isRosettaBasicType, type RosettaExternalFunction } from '@rune-langium/core';

function hasNumberSignature(func: RosettaExternalFunction, arity: number): boolean {
  const output = func.typeCall.type.ref;
  return (
    func.parameters.length === arity &&
    isRosettaBasicType(output) &&
    output.name === 'number' &&
    getElementNamespace(output) === 'com.rosetta.model' &&
    func.parameters.every((parameter) => !parameter.isArray && parameter.typeCall.type.ref === output)
  );
}

/** Shared signature check for the portable Rune math library. */
export function mathLibraryFunction(func: RosettaExternalFunction): 'log' | 'exp' | undefined {
  if (getElementNamespace(func) !== 'rune.math' || !hasNumberSignature(func, 1)) return undefined;
  if (func.name === 'Log') return 'log';
  if (func.name === 'Exp') return 'exp';
  return undefined;
}

/** Only the two scalar numeric primitives from Rune's standard library. */
export function minMaxLibraryFunction(func: RosettaExternalFunction): 'min' | 'max' | undefined {
  if (getElementNamespace(func) !== 'com.rosetta.model' || !hasNumberSignature(func, 2)) return undefined;
  if (func.name === 'Min') return 'min';
  if (func.name === 'Max') return 'max';
  return undefined;
}
