// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { getElementNamespace, type RosettaFunction } from '@rune-langium/core';
import { FunctionImplementationSchema, type FunctionImplementationTarget } from '@rune-langium/core/project-contract';
import { matchesNativeFunction } from './signature.js';
export { nativeFunctionShape, matchesNativeFunction, describeNativeFunction } from './signature.js';
export type { NativeFunctionShape, NativeParameterShape } from './signature.js';
export type ImplementationLanguage = 'typescript' | 'python';
export type ImplementationLocation = Pick<FunctionImplementationTarget, 'path' | 'entrypoint'>;
export type NativeImplementationBody = Pick<FunctionImplementationTarget, 'expression' | 'call' | 'dependencies'>;
export type NativeImplementationResolution =
  | { status: 'available'; id: string; body: NativeImplementationBody; location: ImplementationLocation }
  | { status: 'unsupported'; reason: string };
/** Read a publication-selected binding. No model-specific catalog is consulted during generation. */
export function resolveNativeImplementation(
  func: RosettaFunction,
  language: string
): NativeImplementationResolution | undefined {
  if (
    func.operations.length ||
    !func.annotations.some(
      (entry) =>
        entry.annotation.ref?.name === 'codeImplementation' &&
        getElementNamespace(entry.annotation.ref) === 'com.rosetta.model'
    )
  )
    return undefined;
  const parsed = FunctionImplementationSchema.safeParse(Reflect.get(func, '$implementation'));
  if (!parsed.success || parsed.data.kind !== 'language-specific')
    return {
      status: 'unsupported',
      reason: `No installed ${language} implementation for ${getElementNamespace(func)}.${func.name}. Load its curated implementation bundle.`
    };
  const entry = parsed.data;
  if (
    entry.namespace !== getElementNamespace(func) ||
    entry.name !== func.name ||
    !matchesNativeFunction(func, entry.signature)
  )
    return {
      status: 'unsupported',
      reason: `Installed implementation ${entry.id} does not match the linked function signature.`
    };
  const body = language === 'typescript' || language === 'python' ? entry.targets[language] : undefined;
  return body
    ? { status: 'available', id: entry.id, body, location: { path: body.path, entrypoint: body.entrypoint } }
    : { status: 'unsupported', reason: `Installed implementation ${entry.id} does not support ${language}.` };
}
/** Bind a supplied expression to allocated parameter names without textual substitution. */
export function nativeImplementationExpression(body: NativeImplementationBody, args: readonly string[]): string {
  return body.call ? `(${body.expression})(${args.join(', ')})` : body.expression;
}
