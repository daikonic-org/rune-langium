// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isAttribute,
  isChoiceOption,
  isData,
  isChoice,
  type Data,
  type Choice,
  type TypeCall
} from '@rune-langium/core';
import { isScalarTypeCall, resolveTypeCallTarget, type TypeIndexLookup } from '../emit/type-ref-resolver.js';
import { featureName, typeFeatures } from './navigation.js';
import { fieldMetadataKind, hasTypeMetadata } from './metadata-runtime.js';

export type MetadataPayloadShape = Readonly<Record<string, 'scalar' | 'object' | 'array'>> | null;

/** Declared payload fields distinguish JSON metadata envelopes from ordinary Data records. */
export function metadataPayloadShape(
  call: TypeCall | Data | Choice | undefined,
  index: TypeIndexLookup
): MetadataPayloadShape {
  if (isData(call) || isChoice(call)) return fields(call);
  return resolveTypeCallTarget(
    call,
    index,
    {
      onPrimitive: () => null,
      onEnum: () => null,
      onData: fields,
      onChoice: fields,
      onUnresolved: (name) => {
        throw new Error(`Cannot resolve metadata input type '${name}'.`);
      }
    },
    ''
  );

  function fields(node: Data | Choice): MetadataPayloadShape {
    const shape: Record<string, 'scalar' | 'object' | 'array'> = Object.fromEntries(
      typeFeatures(node)
        .filter((field) => isAttribute(field) || isChoiceOption(field))
        .map((field) => [
          featureName(field),
          isAttribute(field) && (field.card.unbounded || (field.card.sup ?? 1) > 1)
            ? 'array'
            : fieldMetadataKind(field) || !isScalarTypeCall(field.typeCall, index)
              ? 'object'
              : 'scalar'
        ])
    );
    const seen = new Set<Data | Choice>();
    let current: Data | Choice | undefined = node;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (hasTypeMetadata(current)) shape.meta ??= 'object';
      current = isData(current) ? current.superType?.ref : undefined;
    }
    return shape;
  }
}

const envelopeKeys = new Set(['value', 'meta', 'reference', 'externalReference', 'globalReference']);
const envelopeMarkers = ['value', 'reference', 'externalReference', 'globalReference'];

/** A record matching its declared payload takes precedence when both interpretations are possible. */
export function isMetadataInputEnvelope(value: unknown, shape: MetadataPayloadShape): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!envelopeMarkers.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
  if (shape === null) return true;
  const entries = Object.entries(value);
  if (!entries.every(([key]) => envelopeKeys.has(key))) return false;
  return !entries.every(
    ([key, item]) =>
      Object.prototype.hasOwnProperty.call(shape, key) &&
      (item == null ||
        (shape[key] === 'array'
          ? Array.isArray(item)
          : shape[key] === 'object'
            ? typeof item === 'object' && !Array.isArray(item)
            : typeof item !== 'object'))
  );
}
