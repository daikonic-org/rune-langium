// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  getElementNamespace,
  getFunctionInputs,
  getFunctionOutput,
  getEnumValues,
  isRosettaEnumeration,
  type Attribute,
  type RosettaFunction
} from '@rune-langium/core';
export interface NativeParameterShape {
  name: string;
  type: string;
  kind: string;
  card: readonly [number, number | '*'];
  plain: boolean;
  enumValues?: readonly string[];
}
export interface NativeFunctionShape {
  inputs: readonly NativeParameterShape[];
  output?: NativeParameterShape;
}
/** Exact linked signature, shared by catalog guards and the upstream coverage inventory. */
export function nativeFunctionShape(func: RosettaFunction): NativeFunctionShape {
  const param = (attribute: Attribute): NativeParameterShape => {
    const target = attribute.typeCall.type.ref;
    return {
      name: attribute.name,
      type: target ? `${getElementNamespace(target)}.${target.name}` : (attribute.typeCall.type.$refText ?? ''),
      kind: target?.$type ?? 'unresolved',
      card: [attribute.card.inf, attribute.card.unbounded ? '*' : (attribute.card.sup ?? 1)],
      plain: !attribute.annotations.length && !attribute.typeCall.arguments.length,
      ...(isRosettaEnumeration(target) ? { enumValues: getEnumValues(target).map((value) => value.name) } : {})
    };
  };
  const output = getFunctionOutput(func);
  return { inputs: getFunctionInputs(func).map(param), ...(output ? { output: param(output) } : {}) };
}
export function matchesNativeFunction(func: RosettaFunction, shape: NativeFunctionShape): boolean {
  return (
    !func.superFunction &&
    !func.dispatchAttribute &&
    !func.dispatchValue &&
    JSON.stringify(nativeFunctionShape(func)) === JSON.stringify(shape)
  );
}
export function describeNativeFunction(shape: NativeFunctionShape): string {
  const param = (value: NativeParameterShape) => `${value.name} ${value.type} (${value.card[0]}..${value.card[1]})`;
  return `(${shape.inputs.map(param).join(', ')}) -> ${shape.output ? param(shape.output) : 'no output'}`;
}
