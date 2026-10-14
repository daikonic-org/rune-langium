// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratorOutput } from '../../src/types.js';

/** Corpus cases store named input records; execute the positional API in declared order. */
export function recordFunctionExports<T extends Record<string, unknown>>(
  exports: T,
  outputs: readonly GeneratorOutput[]
): T {
  const adapted: Record<string, unknown> = { ...exports };
  for (const func of outputs.flatMap((output) => output.funcs)) {
    const name = func.exportName ?? func.name;
    const callable = exports[name];
    if (typeof callable === 'function')
      adapted[name] = (inputs: Record<string, unknown>) =>
        callable(...func.parameterNames.map((parameter) => inputs[parameter]));
  }
  return adapted as T;
}
