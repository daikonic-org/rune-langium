// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isAttribute,
  isChoiceOption,
  type RosettaExpression,
  type Attribute,
  type InlineFunction
} from '@rune-langium/core';
import { expressionIsMany, expressionType, typeFeatures, featureName, featureIsMany } from '../expr/navigation.js';
import { expressionMetadataKind } from '../expr/metadata-type.js';
import { fieldMetadataKind, type FieldMetadataKind } from '../expr/metadata-runtime.js';
import { expressionFitsCardinality } from '../expr/cardinality.js';
import { collectionDepth, collectionShape } from '../expr/collection-shape.js';
import { expressionIsPresent } from '../expr/scalar-operators.js';
import type { PythonProjectionContext } from './context.js';
import { PYTHON_RUNTIME_SOURCE } from './python-runtime.js';

export interface PythonRenderContext extends PythonProjectionContext {
  state: { next: number };
}
export type PythonRender = (expression: RosettaExpression, context: PythonRenderContext) => string;
export const pyString = (value: string) => JSON.stringify(value);
export const pyBool = (value: boolean) => (value ? 'True' : 'False');
export function pythonRootFields(context: PythonProjectionContext): ReturnType<typeof typeFeatures> {
  return context.implicit?.type
    ? typeFeatures(context.implicit.type)
    : [...context.locals.keys()].filter((node) => isAttribute(node) || isChoiceOption(node));
}
export function pythonFresh(context: PythonRenderContext, label: string): string {
  return `_rune_${label}_${context.state.next++}`;
}
export function pythonBind(value: string, name: string, body: string): string {
  return `(lambda ${name}: ${body})(${value})`;
}
export function pythonRead(value: string, names: readonly string[], many = false): string {
  for (const name of names) {
    value = many
      ? `[child for parent in ${pythonCollection(value)} for child in ${pythonCollection(`None if parent is None else parent.get(${pyString(name)})`)}]`
      : value === 'input' || value === 'data'
        ? `${value}.get(${pyString(name)})`
        : pythonBind(value, '_rune_parent', `None if _rune_parent is None else _rune_parent.get(${pyString(name)})`);
  }
  return value;
}
export function pythonUnwrap(value: string, kind: FieldMetadataKind | undefined, many?: boolean): string {
  if (!kind) return value;
  const collection = (input: string) =>
    `[payload for field in ${pythonCollection(input)} for payload in [field.get("value")] if payload is not None]`;
  if (many) return collection(value);
  if (many === undefined)
    return pythonBind(
      value,
      '_rune_field',
      `${collection('_rune_field')} if isinstance(_rune_field, list) else ${pythonRead('_rune_field', ['value'])}`
    );
  return pythonRead(value, ['value']);
}

/** Flatten extraction groups only when handing a value to a declared array boundary. */
export function pythonArrayBoundary(value: string, expression: RosettaExpression | undefined): string {
  for (let depth = collectionDepth(expression); depth > 1; depth--) {
    value = `[child for group in (${value} or []) for child in ${pythonCollection('group')}]`;
  }
  return value;
}

/** Native materialization; mixed cardinality is an authored expression shape. */
export function pythonCollection(value: string, expression?: RosettaExpression, implicitMany?: boolean): string {
  const shape = expression
    ? collectionShape(expression)
    : implicitMany === undefined
      ? 'unknown'
      : implicitMany
        ? 'array'
        : 'scalar';
  if (shape === 'array') return `(${value} or [])`;
  if (shape === 'scalar' && expressionIsPresent(expression)) return `[${value}]`;
  return pythonBind(
    value,
    '_rune_value',
    shape === 'scalar'
      ? '[] if _rune_value is None else [_rune_value]'
      : '[] if _rune_value is None else _rune_value if isinstance(_rune_value, list) else [_rune_value]'
  );
}

export function pythonPresence(value: string, many?: boolean, absent = false): string {
  const presence =
    many === true
      ? `bool(${value})`
      : many === false
        ? `(${value} is not None)`
        : pythonBind(
            value,
            '_rune_value',
            '_rune_value is not None and (not isinstance(_rune_value, list) or bool(_rune_value))'
          );
  return absent ? `(not ${presence})` : presence;
}

export function pythonCoalesce(values: readonly string[]): string {
  return `next((value for value in [${values.join(', ')}] if value is not None), None)`;
}

/** Stable native keys preserve IEEE NaN and JavaScript UTF-16 string identity. */
export function pythonPrimitiveKey(value: string, kind: string): string {
  if (kind === 'boolean') return value;
  const key =
    kind === 'string'
      ? '_rune_key.encode("utf-16-be", "surrogatepass")'
      : '("number:nan",) if math.isnan(_rune_key) else _rune_key';
  return pythonBind(value, '_rune_key', `None if _rune_key is None else ${key}`);
}
export function pythonReadField(
  receiver: string,
  field: ReturnType<typeof typeFeatures>[number],
  binding?: string
): string {
  return pythonUnwrap(
    binding ?? pythonRead(receiver, [featureName(field)]),
    'annotations' in field ? fieldMetadataKind(field) : undefined,
    featureIsMany(field)
  );
}
export function pythonComparison(left: string, right: string, operator: string, strings = false): string {
  const key = (value: string) => (strings ? `(${value}).encode("utf-16-be", "surrogatepass")` : value);
  return `(${key(left)} ${operator} ${key(right)})`;
}
export function pythonNormalize(
  value: string,
  input: FieldMetadataKind | undefined,
  target: FieldMetadataKind | undefined
): string {
  if (input === target) return value;
  if (!target) return pythonUnwrap(value, input);
  return pythonBind(
    value,
    '_rune_value',
    `None if _rune_value is None else rune.to${target === 'reference' ? 'Reference' : 'Field'}(_rune_value, ${pyString(input ?? 'value')})`
  );
}
export function pythonArgument(
  value: string,
  parameter: Attribute,
  argument: RosettaExpression | undefined,
  context: PythonRenderContext
): string {
  value = pythonArrayBoundary(value, argument);
  const target = fieldMetadataKind(parameter),
    input = argument ? expressionMetadataKind(argument) : context.implicit?.metadata;
  if (target) value = pythonNormalize(value, input, target);
  else if (input) value = pythonUnwrap(value, input, argument ? expressionIsMany(argument) : context.implicit?.many);
  const bounds = { lower: parameter.card.inf, upper: parameter.card.unbounded ? null : (parameter.card.sup ?? 1) };
  if (expressionFitsCardinality(argument, bounds))
    return parameter.card.unbounded || (parameter.card.sup ?? 1) > 1 ? pythonCollection(value, argument) : value;
  return `rune.cardinality(${value}, ${parameter.card.inf}, ${parameter.card.unbounded ? 'None' : (parameter.card.sup ?? 1)}, ${pyString(parameter.name)})`;
}
export function pythonInline(
  fn: InlineFunction | undefined,
  context: PythonRenderContext,
  names: readonly string[],
  argument: RosettaExpression | undefined,
  many = false
): PythonRenderContext {
  const locals = new Map(context.locals);
  fn?.parameters.forEach((parameter, index) => locals.set(parameter, names[index] ?? names[0]!));
  const type = expressionType(argument);
  const metadata = expressionMetadataKind(argument);
  if (!fn?.parameters.length)
    for (const feature of typeFeatures(type))
      locals.set(feature, pythonRead(pythonUnwrap(names[0]!, metadata, many), [featureName(feature)], many));
  return {
    ...context,
    locals,
    self: names[0]!,
    implicit: {
      expression: argument,
      name: names[0]!,
      metadata,
      many,
      ...(type ? { type } : {})
    }
  };
}
/** Read helper dependencies from the authoritative runtime rather than a copied name registry. */
export function pythonHelperDependencies(code: string): string[] {
  const bodies = new Map(
    [...PYTHON_RUNTIME_SOURCE.matchAll(/^def (rune_\w+)\([^]*?(?=^(?:def |class )|$(?![^]))/gm)].map((match) => [
      match[1]!,
      match[0]
    ])
  );
  for (const namespace of PYTHON_RUNTIME_SOURCE.matchAll(/^class (\w+):\n([^]*?)(?=^(?:def |class )|$(?![^]))/gm))
    for (const method of namespace[2]!.matchAll(/^    def (\w+)\([^]*?(?=^    (?:@|def |\w+ =)|$(?![^]))/gm))
      bodies.set(`${namespace[1]}.${method[1]}`, method[0]);
  for (const namespace of PYTHON_RUNTIME_SOURCE.matchAll(/^class (\w+):\n([^]*?)(?=^(?:def |class )|$(?![^]))/gm))
    for (const alias of namespace[2]!.matchAll(/^    (\w+) = staticmethod\((rune_\w+)\)/gm))
      bodies.set(`${namespace[1]}.${alias[1]}`, alias[2]!);
  const required = new Set<string>();
  function collect(text: string) {
    for (const name of bodies.keys())
      if (new RegExp(`\\b${name.replace(/\./g, '\\.')}\\b`).test(text) && !required.has(name)) {
        required.add(name);
        collect(bodies.get(name)!);
      }
  }
  collect(code);
  return [...required].sort();
}
export function pythonDeclarationValue(
  value: string,
  context: PythonRenderContext,
  expression: RosettaExpression
): string {
  const target = expression.$type === 'RosettaSymbolReference' ? expression.symbol.ref : undefined;
  const kind =
    target && context.localMetadata?.has(target)
      ? context.localMetadata.get(target)
      : expressionMetadataKind(expression);
  return context.preserveMetadata ? value : pythonUnwrap(value, kind, expressionIsMany(expression));
}
