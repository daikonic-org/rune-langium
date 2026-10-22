// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isData,
  isChoice,
  isRosettaEnumeration,
  isRosettaBasicType,
  isRosettaTypeAlias,
  isRosettaRecordType
} from '@rune-langium/core';
import type { Data, Choice, RosettaEnumeration, RosettaTypeAlias, TypeCall } from '@rune-langium/core';

/**
 * Canonical Rosetta built-in scalar type names. Every emitter's own
 * target-specific builtin map (Zod/TS/XSD/JSON-Schema/SQL) uses these same
 * names as keys with different values — this set only recognizes THAT a
 * $refText names a builtin, not what it maps to for any given target.
 */
const ROSETTA_BASIC_TYPE_NAMES = new Set([
  'string',
  'int',
  'number',
  'boolean',
  'date',
  'dateTime',
  'zonedDateTime',
  'time',
  'productType',
  'eventType',
  'pattern',
  'calculation'
]);

export interface TypeResolutionVisitor<T> {
  /** Observe alias identity while terminal resolution remains authoritative. */
  onAlias?(node: RosettaTypeAlias): void;
  onPrimitive(basicTypeName: string): T;
  onEnum(node: RosettaEnumeration, sourceUri: string): T;
  onData(node: Data, sourceUri: string): T;
  onChoice(node: Choice, sourceUri: string): T;
  onUnresolved(refText: string | undefined): T;
}

export interface TypeIndexEntry<N> {
  node: N;
  sourceUri: string;
}

export interface TypeIndexLookup {
  enumByName: ReadonlyMap<string, TypeIndexEntry<RosettaEnumeration>>;
  dataByName: ReadonlyMap<string, TypeIndexEntry<Data>>;
  choiceByName: ReadonlyMap<string, TypeIndexEntry<Choice>>;
  typeAliasByName: ReadonlyMap<string, TypeIndexEntry<RosettaTypeAlias>>;
}

/** Bare namespace maps accepted from emitter contexts and namespace walks. */
interface BareTypeIndex {
  enumByName: ReadonlyMap<string, RosettaEnumeration>;
  dataByName: ReadonlyMap<string, Data>;
  choiceByName: ReadonlyMap<string, Choice>;
  typeAliasByName: ReadonlyMap<string, RosettaTypeAlias>;
}

function wrapTypeIndexEntries<N>(
  map: ReadonlyMap<string, N>,
  sourceUri: string
): ReadonlyMap<string, TypeIndexEntry<N>> {
  const wrapped = new Map<string, TypeIndexEntry<N>>();
  for (const [name, node] of map) wrapped.set(name, { node, sourceUri });
  return wrapped;
}

/** Attach the emitter's fallback source URI without mutating its namespace maps. */
export function toTypeIndexLookup(model: BareTypeIndex, sourceUri: string): TypeIndexLookup {
  return {
    enumByName: wrapTypeIndexEntries(model.enumByName, sourceUri),
    dataByName: wrapTypeIndexEntries(model.dataByName, sourceUri),
    choiceByName: wrapTypeIndexEntries(model.choiceByName, sourceUri),
    typeAliasByName: wrapTypeIndexEntries(model.typeAliasByName, sourceUri)
  };
}

export function nodeSourceUri(node: { $container?: unknown } | undefined, fallback: string): string {
  const withDoc = node as { $container?: { $document?: { uri?: { toString(): string } } } } | undefined;
  return withDoc?.$container?.$document?.uri?.toString() ?? fallback;
}

/**
 * Resolve a `RosettaTypeCall` to its terminal kind — primitive, Enum, Data,
 * or Choice — invoking exactly one `visitor` callback. Transparently chases
 * `RosettaTypeAlias` chains (an alias to another alias to ... a primitive or
 * Data type) so callers never see a `'typeAlias'` case: referencing an alias
 * behaves exactly like referencing whatever it ultimately resolves to.
 *
 * Walks the same precedence every emitter's hand-rolled chain used before
 * migration: direct `typeCall.type.ref` (Langium's own resolution) first,
 * `typeCall.type.$refText`-against-`namespace` fallback second (for a
 * single file parsed without the full workspace — common for fixtures).
 */
export function resolveTypeCallTarget<T>(
  typeCall: TypeCall | undefined,
  namespace: TypeIndexLookup,
  visitor: TypeResolutionVisitor<T>,
  fallbackSourceUri: string
): T {
  const originalRefText = typeCall?.type?.$refText;
  const visitedAliases = new Set<RosettaTypeAlias>();
  let currentTypeCall: TypeCall | undefined = typeCall;

  // No hop-count bound: `visitedAliases` alone guarantees termination — any
  // cycle is caught the moment a previously-seen alias recurs, in at most
  // `visitedAliases.size + 1` hops — so an explicit cap only risks
  // misreporting a genuinely valid, merely long, non-cyclic chain as
  // unresolved.
  for (;;) {
    const typeRef = currentTypeCall?.type?.ref;
    const refText = currentTypeCall?.type?.$refText;

    if (typeRef) {
      if (isRosettaBasicType(typeRef)) return visitor.onPrimitive(typeRef.name);
      if (isRosettaRecordType(typeRef)) return visitor.onPrimitive(typeRef.name);
      if (isRosettaEnumeration(typeRef)) return visitor.onEnum(typeRef, nodeSourceUri(typeRef, fallbackSourceUri));
      if (isData(typeRef)) return visitor.onData(typeRef, nodeSourceUri(typeRef, fallbackSourceUri));
      if (isChoice(typeRef)) return visitor.onChoice(typeRef, nodeSourceUri(typeRef, fallbackSourceUri));
      if (isRosettaTypeAlias(typeRef)) {
        // Special case: stdlib aliases with names in ROSETTA_BASIC_TYPE_NAMES (int, productType,
        // eventType, calculation) should NOT be chased through. They're named aliases that represent
        // their own distinct type identities for emitters (e.g., int → z.number().int() in Zod,
        // INTEGER in SQL). Return their name directly, not their underlying type.
        if (ROSETTA_BASIC_TYPE_NAMES.has(typeRef.name)) return visitor.onPrimitive(typeRef.name);
        if (visitedAliases.has(typeRef)) return visitor.onUnresolved(originalRefText);
        visitedAliases.add(typeRef);
        visitor.onAlias?.(typeRef);
        currentTypeCall = typeRef.typeCall;
        continue;
      }
      return visitor.onUnresolved(originalRefText);
    }

    if (refText) {
      if (ROSETTA_BASIC_TYPE_NAMES.has(refText)) return visitor.onPrimitive(refText);
      const enumEntry = namespace.enumByName.get(refText);
      if (enumEntry) return visitor.onEnum(enumEntry.node, enumEntry.sourceUri);
      const dataEntry = namespace.dataByName.get(refText);
      if (dataEntry) return visitor.onData(dataEntry.node, dataEntry.sourceUri);
      const choiceEntry = namespace.choiceByName.get(refText);
      if (choiceEntry) return visitor.onChoice(choiceEntry.node, choiceEntry.sourceUri);
      const aliasEntry = namespace.typeAliasByName.get(refText);
      if (aliasEntry) {
        // Short-circuit: stdlib aliases with names in ROSETTA_BASIC_TYPE_NAMES should not be chased
        // (consistency with the typeRef-resolved branch above). In practice, this refText path hits
        // the `ROSETTA_BASIC_TYPE_NAMES.has(refText)` check above first, so this is defense-in-depth.
        if (ROSETTA_BASIC_TYPE_NAMES.has(aliasEntry.node.name)) {
          return visitor.onPrimitive(aliasEntry.node.name);
        }
        if (visitedAliases.has(aliasEntry.node)) return visitor.onUnresolved(originalRefText);
        visitedAliases.add(aliasEntry.node);
        visitor.onAlias?.(aliasEntry.node);
        currentTypeCall = aliasEntry.node.typeCall;
        continue;
      }
    }

    return visitor.onUnresolved(originalRefText);
  }
}

/** Whether an object can unambiguously be a scalar's declared metadata wrapper. */
export function isScalarTypeCall(typeCall: TypeCall | undefined, namespace: TypeIndexLookup): boolean {
  return resolveTypeCallTarget(
    typeCall,
    namespace,
    {
      onPrimitive: () => true,
      onEnum: () => true,
      onData: () => false,
      onChoice: () => false,
      onUnresolved: () => false
    },
    ''
  );
}
