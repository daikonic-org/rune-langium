// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { getElementNamespace, isRosettaBasicType, type RosettaExternalFunction } from '@rune-langium/core';

/** Shared signature check for the portable Rune math library. */
export function mathLibraryFunction(func: RosettaExternalFunction): 'log' | 'exp' | undefined {
  if (getElementNamespace(func) !== 'rune.math' || func.parameters.length !== 1) return undefined;
  const [parameter] = func.parameters;
  const input = parameter?.typeCall.type.ref;
  const output = func.typeCall.type.ref;
  if (
    parameter?.isArray ||
    !isRosettaBasicType(input) ||
    input.name !== 'number' ||
    getElementNamespace(input) !== 'com.rosetta.model' ||
    output !== input
  )
    return undefined;
  if (func.name === 'Log') return 'log';
  if (func.name === 'Exp') return 'exp';
  return undefined;
}
