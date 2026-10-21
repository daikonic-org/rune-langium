// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Normalizes OpenAPI 3.0/3.1 JSON or YAML into a $defs document, then delegates
 * schema translation to readJsonSchema. Constraint translation, enums, allOf,
 * and oneOf handling remain shared with the JSON Schema reader.
 *
 * Normalization:
 * - OAS 3.0 nullable properties are removed from required to make them optional.
 * - Discriminator mapping keys define branch identities. Referenced schemas'
 *   properties/required fields are inlined into oneOf branches for the shared
 *   reader's branch-merging logic.
 * - allOf inheritance and boolean exclusiveMinimum/exclusiveMaximum use the
 *   shared reader unchanged. OAS 3.1 type arrays also use its existing handling.
 *
 * Synonyms use the source name OpenApi. Namespace precedence is an explicit
 * option, sanitized info.title, then the first server URL's host/path through
 * the shared JSON Schema namespace convention.
 */

import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type { SourceFunc, SourceFuncParam, SourceModel } from '../source-model.js';
import { sanitizeIdentifier } from '../identifiers.js';
import { pushDiagnostic, type ImportDiagnostic } from '../diagnostics.js';
import { readJsonSchema } from './json-schema-reader.js';
import type { OpenApiImportOptionsSchema } from '../../options/openapi-import-options.js';

/** See json-schema-reader.ts's `JsonSchemaImportOptions` for why this extends `z.input`, not `z.infer`. */
export interface OpenApiImportOptions extends z.input<typeof OpenApiImportOptionsSchema> {
  /** Overrides namespace derivation (spec.md CLI `--namespace`). */
  namespace?: string;
}

/** A loosely-typed schema-or-reference object, matching this reader's normalization output shape (fed to `readJsonSchema` via the same `as never` boundary convention `import/index.ts`/its own tests already use). */
type LooseSchema = Record<string, unknown>;

/**
 * Parses a `.json`/`.yaml`/`.yml` OpenAPI document (auto-detected: valid
 * JSON parses as JSON, otherwise treated as YAML — the `yaml` package
 * parses plain JSON too, since JSON is a YAML subset, but attempting
 * `JSON.parse` first avoids YAML's more permissive scalar coercion rules
 * on documents that are already strict JSON).
 */
export function parseOpenApiDocument(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return parseYaml(source);
  }
}

/**
 * Reads a parsed OpenAPI 3.0.x or 3.1 document into a `SourceModel`,
 * delegating the entire structural + constraint translation to
 * `readJsonSchema` after normalizing `components.schemas` into a
 * `{ $defs: {...} }` JSON-Schema-shaped document.
 */
export function readOpenApi(
  doc: unknown,
  options: OpenApiImportOptions = {}
): { model: SourceModel; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  // A YAML/JSON parse can legally yield null (empty document, literal
  // `null`) or a non-object scalar — fail with a clear import error rather
  // than a TypeError on the property accesses below.
  if (doc === null || doc === undefined || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(
      `not an OpenAPI document: expected a top-level object, got ${doc === null ? 'null' : Array.isArray(doc) ? 'an array' : typeof doc}`
    );
  }
  const document = doc as Partial<OpenAPIV3.Document> & Partial<OpenAPIV3_1.Document>;

  const is31 = typeof document.openapi === 'string' && document.openapi.startsWith('3.1');
  const rawSchemas = document.components?.schemas ?? {};

  const defs: Record<string, LooseSchema> = {};
  for (const [name, rawSchema] of Object.entries(rawSchemas)) {
    defs[name] = normalizeSchema(rawSchema as LooseSchema, name, rawSchemas, is31, diagnostics);
  }

  const namespace = options.namespace ?? deriveNamespaceFromDocument(document, diagnostics);

  const shimmed: LooseSchema = { $defs: defs };
  const { model, diagnostics: readerDiagnostics } = readJsonSchema(shimmed, {
    namespace,
    ...(options.skipConditions !== undefined && { skipConditions: options.skipConditions }),
    ...(options.includeUnreferencedDefs !== undefined && { includeUnreferencedDefs: options.includeUnreferencedDefs })
  });

  const funcs =
    options.includeOperations === false
      ? []
      : readOperations((document.paths ?? {}) as unknown as Record<string, LooseSchema>, diagnostics);

  // readJsonSchema always stamps sourceName: 'JsonSchema' (it has no
  // awareness this document originated from OpenAPI) — corrected here to
  // the source-specific synonym-source name spec.md requires ('OpenApi'),
  // exactly as `import/index.ts` already does for the JSON Schema path's
  // own `sourceName` field (a plain object property, not re-derived logic).
  const openApiModel: SourceModel = { ...model, sourceName: 'OpenApi', funcs };

  return { model: openApiModel, diagnostics: [...diagnostics, ...readerDiagnostics] };
}

const BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'string',
  integer: 'int',
  number: 'number',
  boolean: 'boolean'
};

/**
 * Resolves a func-parameter schema's Rune type name — the same
 * builtin/$ref-to-components-schema shapes `json-schema-reader.ts`'s own
 * (private) `resolveTypeName` handles, reimplemented locally and scoped to
 * what an OpenAPI operation's requestBody/response schema can reference
 * (no inline-object promotion, no enum/oneOf handling — a func parameter
 * schema this reader builds is always either a builtin scalar or a `$ref`
 * to a named `components.schemas` entry, since T3's own emitter never
 * emits anything richer for a func input/output). `$ref` here is ALREADY
 * `#/components/schemas/X` form (this reader's own `rewriteComponentRefs`
 * only runs over `components.schemas` entries, not `paths` — so a `$ref`
 * inside a path operation's schema is read directly, not rewritten first).
 */
function resolveParamTypeName(schema: LooseSchema, diagnostics: ImportDiagnostic[], where: string): string {
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref);
    if (match) return match[1]!;
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'external-ref',
      message: `${where}: $ref '${ref}' is not an internal components/schemas reference — using 'string'`
    });
    return 'string';
  }
  const type = schema['type'];
  const resolvedType = Array.isArray(type) ? (type[0] as string | undefined) : (type as string | undefined);
  return (resolvedType && BUILTIN_TYPE_MAP[resolvedType]) ?? 'string';
}

/** Builds `SourceFuncParam[]` from a requestBody's `application/json` object schema (each property → one input). */
function readInputsFromRequestBody(
  requestBody: LooseSchema | undefined,
  operationLabel: string,
  diagnostics: ImportDiagnostic[]
): SourceFuncParam[] {
  const schema = (requestBody?.['content'] as Record<string, LooseSchema> | undefined)?.['application/json']?.[
    'schema'
  ] as LooseSchema | undefined;
  if (!schema || typeof schema !== 'object') return [];
  const properties = (schema['properties'] as Record<string, LooseSchema> | undefined) ?? {};
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    typeName: resolveParamTypeName(propSchema, diagnostics, `${operationLabel} input '${name}'`),
    cardinality: required.has(name) ? { inf: 1, sup: 1 } : { inf: 0, sup: 1 }
  }));
}

/** Builds the single `SourceFuncParam` output from the FIRST 2xx response's `application/json` schema. */
function readOutputFromResponses(
  responses: Record<string, LooseSchema> | undefined,
  operationLabel: string,
  diagnostics: ImportDiagnostic[]
): SourceFuncParam {
  const twoXxKey = Object.keys(responses ?? {}).find((code) => /^2\d\d$/.test(code));
  const schema = twoXxKey
    ? ((responses![twoXxKey]!['content'] as Record<string, LooseSchema> | undefined)?.['application/json']?.[
        'schema'
      ] as LooseSchema | undefined)
    : undefined;

  if (!schema) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'func-no-2xx-response',
      message: `${operationLabel}: no 2xx response with an 'application/json' schema — output typed 'unknown'`
    });
    return { name: 'result', typeName: 'unknown', cardinality: { inf: 1, sup: 1 } };
  }
  return {
    name: 'result',
    typeName: resolveParamTypeName(schema, diagnostics, `${operationLabel} output`),
    cardinality: { inf: 1, sup: 1 }
  };
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Reads every `paths.*.{method}` operation into a `SourceFunc` (spec.md
 * Phase 2b Implementation Addendum decision 4's inbound half):
 * `operationId` → sanitized func name; `requestBody` → inputs;
 * the first 2xx response → output; `summary`/`description` → definition;
 * `x-rune-operation` (T3's own emitter-attached carrier field) → the
 * operation string when present, else derived from `METHOD /path`
 * (so a HAND-WRITTEN OpenAPI document — one that never went through T3's
 * emitter — still round-trips: the operation string is always
 * independently reconstructible from the path+method alone, matching
 * `operationStringForFunc`'s own `POST /functions/{name}` convention for
 * an RPC-style path, and falling back to the literal `METHOD /path` for
 * any other path shape).
 */
function readOperations(paths: Record<string, Record<string, unknown>>, diagnostics: ImportDiagnostic[]): SourceFunc[] {
  const funcs: SourceFunc[] = [];
  // OpenAPI guarantees `operationId` uniqueness on the RAW string; two
  // distinct ids that sanitize to the same Rune name (e.g. `get-trade` and
  // `get.trade`, both -> `get_trade`) are deduped with a numeric suffix —
  // the same collision-handling convention `json-schema-reader.ts`'s own
  // `dedupeIdentifier` applies to sanitized `$defs` keys.
  const usedNames = new Set<string>();
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = methods[method] as LooseSchema | undefined;
      if (!op || typeof op !== 'object') continue;

      const operationId = op['operationId'];
      if (typeof operationId !== 'string' || operationId.length === 0) {
        pushDiagnostic(diagnostics, {
          severity: 'warning',
          code: 'operation-no-id',
          message: `${method.toUpperCase()} ${path}: no 'operationId' — operation skipped (a func needs a name)`
        });
        continue;
      }

      const operationLabel = `${method.toUpperCase()} ${path}`;
      const explicitOperation = op['x-rune-operation'];
      const operation = typeof explicitOperation === 'string' ? explicitOperation : operationLabel;

      const description =
        (typeof op['summary'] === 'string' && op['summary']) ||
        (typeof op['description'] === 'string' && op['description']) ||
        undefined;

      let name = sanitizeIdentifier(operationId, 'Operation');
      if (usedNames.has(name)) {
        let suffix = 2;
        while (usedNames.has(`${name}_${suffix}`)) suffix += 1;
        name = `${name}_${suffix}`;
      }
      usedNames.add(name);

      funcs.push({
        name,
        inputs: readInputsFromRequestBody(op['requestBody'] as LooseSchema | undefined, operationLabel, diagnostics),
        output: readOutputFromResponses(
          op['responses'] as Record<string, LooseSchema> | undefined,
          operationLabel,
          diagnostics
        ),
        description,
        operation
      });
    }
  }
  return funcs;
}

/**
 * Normalizes ONE `components.schemas` entry for the OAS 3.0 dialect
 * (no-op pass-through for 3.1, modulo the `oneOf`+`discriminator.mapping`
 * inlining, which applies identically to both versions since `discriminator`
 * is unchanged between 3.0 and 3.1).
 */
function normalizeSchema(
  schema: LooseSchema,
  ownName: string,
  allSchemas: Record<string, unknown>,
  is31: boolean,
  diagnostics: ImportDiagnostic[]
): LooseSchema {
  if (schema === undefined || schema === null || typeof schema !== 'object') return schema ?? {};

  let result: LooseSchema = schema;

  if (!is31 && result['properties'] !== undefined) {
    result = normalizeNullableProperties(result, ownName, diagnostics);
  }

  if (Array.isArray(result['oneOf']) && result['discriminator'] !== undefined) {
    result = inlineDiscriminatedOneOfBranches(result, ownName, allSchemas, diagnostics);
    // IMPORTANT FIX (review finding): the dominant real-world OpenAPI
    // discriminated-union idiom writes the union schema as BARE `{ oneOf:
    // [...], discriminator: {...} }` — no `type: 'object'` of its own (the
    // actual Petstore polymorphism example in the OpenAPI spec does exactly
    // this). `readJsonSchema`'s own type-vs-enum classification gate
    // (`readJsonSchema`'s top-level loop: `def.type === 'object' ||
    // def.properties !== undefined || def.allOf !== undefined`) never
    // matches such a schema, so the ENTIRE union type — attributes, choice
    // condition, everything — was silently dropped (fell through to the
    // generic 'unrecognized-def' diagnostic; every committed fixture/test
    // masked this by always adding an explicit `type: 'object'`). Stamping
    // `type: 'object'` here (only when the schema doesn't already declare
    // one of the three gate-satisfying shapes) is the normalization-layer
    // fix: it makes the ALREADY-CORRECT downstream machinery (readTypeDef's
    // discriminated-oneOf branch, which this reader's inlining feeds)
    // actually run, without touching the shared, untouched json-schema-reader.ts.
    if (result['type'] === undefined && result['properties'] === undefined && result['allOf'] === undefined) {
      result = { ...result, type: 'object' };
    }
  }

  // allOf composition needs no OAS-specific normalization for the
  // composition ITSELF (readAllOfType handles $ref-base + inline-properties
  // composition identically to the plain JSON Schema path) — recurse into
  // each branch so a NESTED oneOf/nullable inside an allOf's own
  // (inline-properties) branch is normalized too, the same combination
  // json-schema-reader.ts's own readAllOfType already merges for the plain
  // path.
  if (Array.isArray(result['allOf'])) {
    result = {
      ...result,
      allOf: (result['allOf'] as unknown[]).map((branch) =>
        typeof branch === 'object' && branch !== null
          ? normalizeSchema(branch as LooseSchema, ownName, allSchemas, is31, diagnostics)
          : branch
      )
    };
  }

  return rewriteComponentRefs(result) as LooseSchema;
}

/**
 * Rewrites every `$ref: '#/components/schemas/X'` (anywhere in the schema
 * tree — `properties[x].$ref`, `items.$ref`, `allOf[i].$ref`, etc.) to
 * `$ref: '#/$defs/X'`. `readJsonSchema`'s own internal-ref resolution
 * (`resolveInternalRef`) only recognizes the `#/$defs/...` / `#/definitions/
 * ...` JSON Pointer prefixes (its own module's MVP rule); an OpenAPI `$ref`
 * pointing at `#/components/schemas/...` would otherwise be treated as an
 * EXTERNAL reference (diagnosed, falls back to `string`) even though it
 * resolves to an entry this reader already copied into the shimmed
 * document's own `$defs`. A ref to anything OTHER than `#/components/
 * schemas/...` (e.g. `#/components/parameters/...`, or a genuinely external
 * URL) is left untouched — `readJsonSchema` will correctly diagnose it as
 * external, which is accurate (this reader only ever populates `$defs`
 * from `components.schemas`).
 */
function rewriteComponentRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteComponentRefs);
  if (typeof node !== 'object' || node === null) return node;
  const obj = node as LooseSchema;
  const rewritten: LooseSchema = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$ref' && typeof v === 'string') {
      const match = /^#\/components\/schemas\/([^/]+)$/.exec(v);
      rewritten[k] = match ? `#/$defs/${match[1]}` : v;
    } else {
      rewritten[k] = rewriteComponentRefs(v);
    }
  }
  return rewritten;
}

/**
 * OAS 3.0's `nullable: true` → optionality floor.
 *
 * `readJsonSchema` derives `(1..1)` vs `(0..1)` PURELY from `required`
 * membership at the containing type's `properties` iteration site — it has
 * no `nullable` concept at all (that keyword doesn't exist in any JSON
 * Schema draft; OAS 3.0 invented it). A `nullable: true` property that is
 * ALSO in the parent's `required` array is therefore, per OAS 3.0 semantics
 * ("the value MAY be null" — a distinct axis from "the key MUST be
 * present"), NOT equivalent to Rune's `(1..1)`: the source schema tolerates
 * an explicit `null` where Rune's `(1..1)` tolerates no value at all in
 * that slot. The closest achievable floor without teaching the shared
 * `readJsonSchema` a new keyword (out of scope — "reuse, don't duplicate")
 * is to drop the property from `required` before delegating, so it imports
 * as `(0..1)` rather than the stricter, semantically wrong `(1..1)`; the
 * `nullable` keyword itself is then dead weight `readJsonSchema` never
 * reads, so it is stripped from the property schema to avoid leaking
 * OAS-only keyword noise into the shimmed JSON-Schema-shaped document.
 *
 * Operates on the PARENT object schema (not a single nested property in
 * isolation) because both `required` and `properties` must be visible
 * together to compute the corrected `required` array.
 *
 * When the floored property WAS in `required`, an info-level
 * `nullable-required-floored` diagnostic is pushed (review Minor 2): this
 * is the one case where the floor actually ERASES a real distinction the
 * source schema drew (present-and-maybe-null vs. present-and-non-null) —
 * a nullable property that was already optional loses nothing observable
 * (both floor to the identical `(0..1)`), so no diagnostic fires for that
 * case.
 */
function normalizeNullableProperties(
  schema: LooseSchema,
  ownName: string,
  diagnostics: ImportDiagnostic[]
): LooseSchema {
  const properties = schema['properties'] as Record<string, unknown> | undefined;
  if (properties === undefined) return schema;

  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  let changed = false;
  const newProperties: Record<string, unknown> = {};

  for (const [propName, propSchema] of Object.entries(properties)) {
    if (typeof propSchema === 'object' && propSchema !== null && (propSchema as LooseSchema)['nullable'] === true) {
      changed = true;
      const wasRequired = required.delete(propName);
      if (wasRequired) {
        pushDiagnostic(diagnostics, {
          severity: 'info',
          code: 'nullable-required-floored',
          message: `components/schemas/${ownName}.${propName}: 'nullable: true' on a required property floors the imported cardinality to (0..1) — the source schema's "present, possibly null" distinction from Rune's (1..1) "present, never absent" is not representable and is lost on import`
        });
      }
      const { nullable: _nullable, ...rest } = propSchema as LooseSchema;
      newProperties[propName] = rest;
    } else {
      newProperties[propName] = propSchema;
    }
  }

  if (!changed) return schema;
  return { ...schema, properties: newProperties, required: [...required] };
}

/**
 * Resolves `$ref: '#/components/schemas/Name'` to `Name`; anything else
 * (an external ref) returns `undefined` — same internal-ref-only MVP rule
 * `json-schema-reader.ts`'s `resolveInternalRef` applies to `$defs`/
 * `definitions` refs.
 */
function resolveComponentRef(ref: string): string | undefined {
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref);
  return match?.[1];
}

/**
 * Inlines each `oneOf` branch's referenced component schema's own
 * `properties`/`required` directly into the branch object, so
 * `readJsonSchema`'s existing `mergeOneOfBranchAttributes` (built for
 * INLINE oneOf branches, Phase 1 scenario 6) can merge them without any
 * change to that shared machinery. When `discriminator.mapping` is
 * present, its keys are the AUTHORITATIVE branch identity — a mapping
 * entry's `$ref` value wins over merely appearing in the `oneOf` array in
 * the same position, and a `oneOf` branch with no corresponding mapping
 * entry is diagnosed (mapping is optional in the OpenAPI spec itself, but
 * once present, an unmapped `oneOf` member is a real ambiguity: the spec
 * defines `mapping` as "MUST be used to determine which of the schemas in
 * oneOf ... is expected to satisfy the payload", so an unmapped member has
 * no defined selection rule — this reader retains it in the merge for
 * structural completeness but flags it).
 */
function inlineDiscriminatedOneOfBranches(
  schema: LooseSchema,
  ownName: string,
  allSchemas: Record<string, unknown>,
  diagnostics: ImportDiagnostic[]
): LooseSchema {
  const discriminator = schema['discriminator'] as
    | { propertyName?: string; mapping?: Record<string, string> }
    | undefined;
  const mapping = discriminator?.mapping;
  const oneOf = schema['oneOf'] as unknown[];

  const mappedRefs = new Set(Object.values(mapping ?? {}));

  const inlinedBranches = oneOf.map((rawBranch) => {
    if (typeof rawBranch !== 'object' || rawBranch === null) return rawBranch;
    const branch = rawBranch as LooseSchema;
    const ref = branch['$ref'];
    if (typeof ref !== 'string') return branch;

    const refKey = resolveComponentRef(ref);
    if (refKey === undefined) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'external-ref',
        message: `components/schemas/${ownName}: oneOf branch $ref '${ref}' is not an internal components/schemas reference — branch skipped`
      });
      return {};
    }
    // `discriminator.mapping` values are legal in TWO forms per the OpenAPI
    // spec: a full `$ref`-style path (`#/components/schemas/Dog`) OR a bare
    // schema NAME (`Dog`) — "an internal or external schema, or a name of
    // an internal schema". A prior version only checked the full-`$ref`
    // form (plus the reconstructed `#/components/schemas/<refKey>` form),
    // so a bare-name mapping value produced a FALSE `unmapped-discriminator-
    // branch` diagnostic even though the mapping correctly identifies the
    // branch (review finding) — `mappedRefs.has(refKey)` closes the gap.
    if (
      mapping !== undefined &&
      !mappedRefs.has(ref) &&
      !mappedRefs.has(`#/components/schemas/${refKey}`) &&
      !mappedRefs.has(refKey)
    ) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unmapped-discriminator-branch',
        message: `components/schemas/${ownName}: oneOf branch '$ref: ${ref}' has no entry in discriminator.mapping — included anyway (no defined selection rule per the OpenAPI spec)`
      });
    }

    const referenced = allSchemas[refKey] as LooseSchema | undefined;
    if (referenced === undefined) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'external-ref',
        message: `components/schemas/${ownName}: oneOf branch $ref '${ref}' does not resolve to a components/schemas entry — branch skipped`
      });
      return {};
    }
    // Inline the referenced schema's properties/required directly — this
    // is exactly the "inline object with properties" branch shape
    // json-schema-reader.ts's mergeOneOfBranchAttributes already merges;
    // no new branch shape is introduced.
    return {
      type: 'object',
      ...(referenced['properties'] !== undefined && { properties: referenced['properties'] }),
      ...(referenced['required'] !== undefined && { required: referenced['required'] })
    };
  });

  return { ...schema, oneOf: inlinedBranches };
}

const NAMESPACE_SEGMENT_RE = /[^A-Za-z0-9_]/g;

function sanitizeNamespaceSegment(s: string): string {
  const cleaned = s.replace(NAMESPACE_SEGMENT_RE, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : cleaned.length > 0 ? `_${cleaned}` : '';
}

const NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Derives a Rune namespace from `info.title` (sanitized, preferred) or the
 * first `servers[]` entry's URL (reverse-DNS-ish host+path, the same
 * convention `json-schema-reader.ts`'s `namespaceFromId` already applies to
 * a JSON Schema `$id` — reimplemented locally rather than importing that
 * function, since it is not exported and this reader's fallback source is
 * a `servers[].url`, not a `$id`, a distinct enough input that duplicating
 * the small URL→segments transform is clearer than exporting an internal
 * for one caller). Throws when neither yields a valid namespace, matching
 * `deriveNamespace`'s error contract in the JSON Schema reader.
 */
function deriveNamespaceFromDocument(
  document: Partial<OpenAPIV3.Document> & Partial<OpenAPIV3_1.Document>,
  diagnostics: ImportDiagnostic[]
): string {
  const fromTitle = document.info?.title ? sanitizeTitleToNamespace(document.info.title) : undefined;
  const fromServers = document.servers?.[0]?.url ? namespaceFromUrl(document.servers[0].url) : undefined;
  const namespace = fromTitle ?? fromServers;

  if (namespace === undefined || !NAMESPACE_RE.test(namespace)) {
    pushDiagnostic(diagnostics, {
      severity: 'info',
      code: 'namespace-fallback',
      message: `info.title ('${document.info?.title ?? '<absent>'}') and servers[0].url ('${document.servers?.[0]?.url ?? '<absent>'}') did not yield a usable namespace and no --namespace override was supplied`
    });
    throw new Error(
      `Unable to derive a Rune namespace: neither 'info.title' nor 'servers[0].url' yielded a valid namespace ` +
        `and no --namespace override was supplied.`
    );
  }
  return namespace;
}

function sanitizeTitleToNamespace(title: string): string | undefined {
  const segments = title
    .split(/[\s._-]+/)
    .map(sanitizeNamespaceSegment)
    .filter(Boolean);
  return segments.length > 0 ? segments.join('.') : undefined;
}

function namespaceFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const hostSegments = parsed.hostname.split('.').filter(Boolean).reverse();
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const segments = [...hostSegments, ...pathSegments].map(sanitizeNamespaceSegment).filter(Boolean);
    return segments.length > 0 ? segments.join('.') : undefined;
  } catch {
    return undefined;
  }
}
