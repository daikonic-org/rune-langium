// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { getEnumValueLiteral } from '@rune-langium/core';

import {
  getEnumValues,
  isAttribute,
  isData,
  isChoice,
  isRosettaEnumeration,
  type Attribute,
  type ChoiceOption,
  type Data,
  type Choice,
  type RosettaEnumeration,
  type TypeCall
} from '@rune-langium/core';
import { resolveTypeCallTarget, type TypeIndexLookup } from '../emit/type-ref-resolver.js';
import { typeFeatures, featureName } from '../expr/navigation.js';
import { fieldMetadataKind } from '../expr/metadata-runtime.js';
import { metadataPayloadShape } from '../expr/metadata-input.js';
import type { PythonProjectionContext } from './context.js';
import { pyString, pyBool } from './python-operations.js';

const linkedOnly: TypeIndexLookup = {
  enumByName: new Map(),
  dataByName: new Map(),
  choiceByName: new Map(),
  typeAliasByName: new Map()
};

export interface PythonTypeInfo {
  annotation: string;
  normalize: string;
}

/** Target syntax only; all type dispatch and alias resolution use the canonical resolver. */
export function pythonType(call: TypeCall | undefined, context: PythonProjectionContext): PythonTypeInfo {
  return resolveTypeCallTarget(
    call,
    linkedOnly,
    {
      onPrimitive(name) {
        if (name === 'number' || name === 'int') return { annotation: 'float', normalize: 'float' };
        if (name === 'boolean') return { annotation: 'bool', normalize: 'rune.identity' };
        if (
          [
            'string',
            'date',
            'dateTime',
            'time',
            'zonedDateTime',
            'productType',
            'eventType',
            'pattern',
            'calculation'
          ].includes(name)
        )
          return { annotation: 'str', normalize: 'rune.identity' };
        throw new Error(`Python type binding required: ${name}`);
      },
      onEnum: (node) => ({ annotation: context.name(node), normalize: 'rune.identity' }),
      onData(node) {
        const name = context.name(node);
        return { annotation: name, normalize: `_rune_normalize_${name}` };
      },
      onChoice(node) {
        const name = context.name(node);
        return { annotation: name, normalize: `_rune_normalize_${name}` };
      },
      onUnresolved(name) {
        throw new Error(`Unresolved Python type '${name ?? ''}'`);
      }
    },
    ''
  );
}

export function pythonFieldType(field: Attribute | ChoiceOption, context: PythonProjectionContext): string {
  let type = pythonType(field.typeCall, context).annotation;
  const metadata = fieldMetadataKind(field);
  if (metadata) type = `Rune${metadata === 'field' ? 'Field' : 'Reference'}[${type}]`;
  if (isAttribute(field) && (field.card.unbounded || (field.card.sup ?? 1) > 1)) return `list[${type}]`;
  return isAttribute(field) && field.card.inf === 0 ? `${type} | None` : type;
}

export function pythonFieldNormalizer(field: Attribute | ChoiceOption, context: PythonProjectionContext): string {
  const type = pythonType(field.typeCall, context);
  const many = isAttribute(field) && (field.card.unbounded || (field.card.sup ?? 1) > 1);
  const kind = fieldMetadataKind(field);
  const shape = kind ? metadataPayloadShape(field.typeCall, linkedOnly) : null;
  const payloadShape =
    shape === null
      ? 'None'
      : `{${Object.entries(shape)
          .map(([name, kind]) => `${pyString(name)}: ${pyString(kind)}`)
          .join(', ')}}`;
  return `lambda value: rune.normalizeAttribute(value, ${pyString(kind ?? 'value')}, ${pyBool(many)}, ${type.normalize}, ${payloadShape})`;
}

export function pythonTypedDict(
  name: string,
  fields: readonly (Attribute | ChoiceOption)[],
  context: PythonProjectionContext
): string {
  const entries = fields.map((field) => {
    const optional = !isAttribute(field) || field.card.inf === 0;
    const type = pythonFieldType(field, context);
    return `${pyString(featureName(field))}: ${pyString(optional ? `NotRequired[${type}]` : type)}`;
  });
  return `${name} = TypedDict(${pyString(name)}, {${entries.join(', ')}})`;
}

export function pythonTypeDeclarations(
  types: readonly (Data | Choice | RosettaEnumeration)[],
  context: PythonProjectionContext
): string[] {
  return types.flatMap((node) => {
    if (isRosettaEnumeration(node)) {
      const name = context.name(node);
      return [
        `${name} = Literal[${
          getEnumValues(node)
            .map((value) => pyString(getEnumValueLiteral(value)))
            .join(', ') || 'None'
        }]`
      ];
    }
    if (!isData(node) && !isChoice(node)) return [];
    const name = context.name(node);
    const fields = typeFeatures(node).filter((field) => isAttribute(field) || field.$type === 'ChoiceOption');
    return [
      pythonTypedDict(name, fields, context),
      `def _rune_normalize_${name}(value):\n    return rune.normalizeObject(value, {${fields.map((field) => `${pyString(featureName(field))}: ${pythonFieldNormalizer(field, context)}`).join(', ')}})`
    ];
  });
}
