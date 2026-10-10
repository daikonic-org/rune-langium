// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { metadataRuntimeSource } from './expr/metadata-runtime.js';
import { valueEqualitySource } from './expr/value-equality.js';
import { binaryRuntimeSource } from './expr/binary-runtime.js';
import { TEMPORAL_CONVERSION_PATTERNS, matchesTemporalWireFormat } from './expr/temporal-conversions.js';
import { temporalRuntimeSource } from './expr/temporal-runtime.js';
import { functionDataRuntimeSource } from './expr/function-data-runtime.js';
import { collectionRuntimeSource } from './expr/collection-runtime.js';

/** Namespace members reference the authoritative implementations, retaining generic types. */
const RUNTIME_NAMESPACE_MEMBERS = {
  list: 'runeList',
  single: 'runeSingle',
  contains: 'runeContains',
  disjoint: 'runeDisjoint',
  distinct: 'runeDistinct',
  binary: 'runeBinary',
  compare: 'runeCompare',
  order: 'runeOrder',
  parseZonedDateTime: 'runeParseZonedDateTime',
  dateField: 'runeDateField',
  dateConstruct: 'runeDateConstruct',
  dateConstructTemporal: 'runeDateConstructTemporal',
  toFuncData: 'runeToFuncData',
  checkOneOf: 'runeCheckOneOf',
  count: 'runeCount',
  exists: 'runeAttrExists',
  valueKey: 'runeValueKey',
  toDate: 'runeToDate',
  toTime: 'runeToTime',
  toDateTime: 'runeToDateTime',
  toZonedDateTime: 'runeToZonedDateTime'
} as const;
const METADATA_NAMESPACE_MEMBERS = {
  withMeta: 'runeWithMeta',
  asKey: 'runeAsKey',
  toField: 'runeToField',
  toReference: 'runeToReference'
} as const;

/** Compose inline, sidecar and executable runtimes before creating their shared namespace. */
export function runtimeHelperSource(typescript: boolean, exported = false, metadata = false): string {
  const prefix = exported ? 'export ' : '';
  const type = (value: string) => (typescript ? value : '');
  const scalar = [
    `${prefix}const runeCheckOneOf = (values${type(': unknown[]')})${type(': boolean')} =>
  values.filter((v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)).length === 1;`,
    `${prefix}const runeCount = (value${type(': unknown')})${type(': number')} => Array.isArray(value) ? value.length : value == null ? 0 : 1;`,
    `${prefix}const runeAttrExists = ${type('<T>')}(v${type(': T')})${type(': v is NonNullable<T> & (T extends readonly (infer I)[] ? readonly [I, ...I[]] : unknown)')} =>
  v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);`,
    ...Object.entries(TEMPORAL_CONVERSION_PATTERNS).map(
      ([kind, pattern]) =>
        `${prefix}const runeTo${kind[0]!.toUpperCase() + kind.slice(1)} = (v${type(': unknown')})${type(': string | undefined')} =>
  typeof v === 'string' && /${pattern}/.test(v) ? v : undefined;`
    )
  ].join('\n\n');
  return [
    '// --- rune-codegen runtime helpers (inlined) ---',
    temporalRuntimeSource(typescript, exported),
    functionDataRuntimeSource(typescript, exported),
    binaryRuntimeSource(typescript, exported),
    collectionRuntimeSource(typescript, exported),
    scalar,
    ...(metadata ? [metadataRuntimeSource(typescript, exported)] : []),
    valueEqualitySource(typescript, exported, {
      ...RUNTIME_NAMESPACE_MEMBERS,
      ...(metadata ? METADATA_NAMESPACE_MEMBERS : {})
    }),
    '// --- end runtime helpers ---'
  ].join('\n\n');
}

/** Source text inlined in emitted TypeScript and Zod modules. */
export const RUNTIME_HELPER_SOURCE = runtimeHelperSource(true);
/** Annotation-free counterpart used by the Studio execution worker. */
export const RUNTIME_HELPER_JS_SOURCE = runtimeHelperSource(false, false, true);

/**
 * Returns true iff exactly one value in the array is non-null and non-undefined.
 *
 * Parity: matches Python rune_check_one_of(values) semantics.
 * Used for: one-of, choice conditions.
 * FR-021, SC-003.
 */
export const runeCheckOneOf = (values: unknown[]): boolean =>
  values.filter((v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)).length === 1;

/**
 * Counts collection items or a present scalar, treating null/undefined as 0.
 *
 * Parity: matches Python rune_count(collection) semantics.
 * Used for: count expressions, (1..*) condition assertions.
 * FR-021, SC-003.
 */
export const runeCount = (value: unknown): number => (Array.isArray(value) ? value.length : value == null ? 0 : 1);

/**
 * Returns true iff the value is "present" in the Rune sense:
 * not undefined, not null, and not an empty array.
 *
 * Parity: matches Python rune_attr_exists(v) semantics.
 * Used for: exists, is absent conditions.
 * FR-021, SC-003.
 */
export const runeAttrExists = <T>(
  v: T
): v is NonNullable<T> & (T extends readonly (infer I)[] ? readonly [I, ...I[]] : unknown) =>
  v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);

/**
 * Validate-shape-and-passthrough for Rune `to-date`: returns the string
 * unchanged when it matches `YYYY-MM-DD`, else undefined.
 *
 * Runtime representation of `date` is a plain ISO string (see ts-emitter's
 * builtin type map); Tier 3 `ToDateOperation` semantics per the parity spec.
 */
export const runeToDate = (v: unknown): string | undefined => (matchesTemporalWireFormat(v, 'date') ? v : undefined);

/**
 * Validate-shape-and-passthrough for Rune `to-time`: `HH:MM:SS` with an
 * optional fractional-seconds suffix.
 */
export const runeToTime = (v: unknown): string | undefined => (matchesTemporalWireFormat(v, 'time') ? v : undefined);

/**
 * Validate-shape-and-passthrough for Rune `to-date-time`: local ISO-8601
 * `YYYY-MM-DDTHH:MM:SS` with optional fractional seconds, no zone offset.
 */
export const runeToDateTime = (v: unknown): string | undefined =>
  matchesTemporalWireFormat(v, 'dateTime') ? v : undefined;

/**
 * Validate-shape-and-passthrough for Rune `to-zoned-date-time`: ISO-8601
 * datetime with a required zone offset (`Z` or `+HH:MM`), optional IANA
 * zone-id suffix (`[Region/City]`).
 */
export const runeToZonedDateTime = (v: unknown): string | undefined =>
  matchesTemporalWireFormat(v, 'zonedDateTime') ? v : undefined;

/**
 * Core namespace and implementation names reserved during emission.
 * The namespace is first because bundled headers use it to identify
 * the runtime import boundary. Implementation exports remain available
 * for existing runtime consumers.
 */
export const RUNE_HELPER_NAMES = ['rune', ...Object.values(RUNTIME_NAMESPACE_MEMBERS)] as const;

/** Core sidecar declarations; target-specific helpers follow this block. */
export const RUNTIME_SIDECAR_HELPER_LINES: readonly string[] = runtimeHelperSource(true, true).split('\n');

/**
 * Bundled modules import the namespace plus target-specific helpers and types.
 */
export function buildRuntimeHelperImportLine(from: string, extra: readonly string[] = []): string {
  return `import { ${[RUNE_HELPER_NAMES[0], 'type RuneFuncData', ...extra].join(', ')} } from '${from}';`;
}
