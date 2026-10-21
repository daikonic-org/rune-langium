// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * json-schema-reader — JSON Schema (Draft 7 / 2020-12) → `SourceModel`
 * (spec.md User Story 1, Phase 1's only active importer).
 *
 * Scope (per spec.md's Phase 1 item 5 + acceptance scenarios 1-6):
 *  - `object` + `properties` + `required` → `SourceType` + cardinality
 *  - `array` + `minItems`/`maxItems` → cardinality
 *  - `enum` / `oneOf` of `const` → `SourceEnum`, with `x-rune-enum-display`
 *    (our own outbound emitter's extension) preferred over guessing a
 *    display name from a non-identifier-safe enum literal
 *  - `allOf` composing a base `$ref` + extra `properties` → `extends`
 *  - `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` → `range`
 *  - `minLength`/`maxLength` → `length`
 *  - `pattern` → `pattern` (always stub, per the amended scenario 5)
 *  - `oneOf` + `discriminator` → `oneOf` (sibling-property presence, NOT
 *    the enum/const form above — disambiguated by shape, see `isEnumOneOf`)
 *  - internal `$defs`/`definitions` `$ref` resolution only (hand-rolled,
 *    per spec.md's Source Parser Dependencies table); an external ref
 *    (anything without a `#/$defs/...` or `#/definitions/...` shape)
 *    produces an `external-ref` diagnostic and falls back to `string`
 *    (a property type) or omits `extends` (an `allOf` base) — never
 *    guessed at, but not "skipped" either (the property/type itself is
 *    still emitted, just without the unresolvable reference).
 *  - `$id` → namespace derivation (reverse-DNS-ish host+path), falling back
 *    to the caller-supplied `--namespace` option; an error when neither
 *    yields a valid Rune namespace segment sequence (spec.md open question 2).
 *
 * This module has ZERO Rune-AST awareness — its only job is
 * `JSON Schema document → SourceModel`. `ast-builder.ts` /
 * `constraint-translator.ts` do the Rune-specific work.
 */

import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import type { ConstraintIR, SourceEnum, SourceModel, SourceType, SourceAttribute } from '../source-model.js';
import { sanitizeIdentifier, dedupeIdentifier, sanitizeNamespaceSegment } from '../identifiers.js';
import { pushDiagnostic, type ImportDiagnostic } from '../diagnostics.js';

// --- JSON Schema shape ---------------------------------------------------
//
// T3 retrofit (spec 021 Phase 2 Addendum): replaces this module's own
// hand-rolled `JsonSchemaNode` shape with `@types/json-schema`'s
// `JSONSchema7`, extended LOCALLY (`JsonSchemaNode` below) with the
// keywords the real Draft 7 spec — and therefore `@types/json-schema` —
// does not carry, but this reader legitimately reads:
//
//  - `exclusiveMinimum`/`exclusiveMaximum` as `boolean` — Draft 7's OWN
//    keyword is number-only (the boolean-modifier form is Draft 4/6:
//    `minimum: 5, exclusiveMinimum: true`). This reader intentionally
//    accepts BOTH forms (a real Phase 1 review fix, "Important 1+2" —
//    real-world JSON Schema documents mix drafts loosely, and CDM/hand-
//    authored schemas are not guaranteed to be draft-pure), so the local
//    extension widens these two fields to `number | boolean` rather than
//    narrowing the reader to reject the boolean form as a type error.
//  - `discriminator: { propertyName?: string }` — an OpenAPI-specific
//    keyword (not part of any JSON Schema draft at all; carried here
//    because the SAME reader is reused for the OpenAPI 3.0 dialect
//    normalization layer, spec.md Phase 2 Addendum item 5), used for the
//    sibling-property "discriminated oneOf" shape (scenario 6).
//  - `'x-rune-enum-display'?: Record<string, string>` — this project's own
//    `x-` extension keyword (the outbound JSON Schema emitter's enum
//    display-name side-map), not part of any JSON Schema draft.
//
// Every OTHER field this reader touches (`$id`/`$ref`/`type`/`properties`/
// `required`/`items`/`minItems`/`maxItems`/`enum`/`const`/`allOf`/`oneOf`/
// `minimum`/`maximum`/`minLength`/`maxLength`/`pattern`/`description`/
// `title`/`$defs`/`definitions`) comes from `JSONSchema7` unchanged.
type JsonSchemaNode = Omit<JSONSchema7, 'exclusiveMinimum' | 'exclusiveMaximum'> & {
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  discriminator?: { propertyName?: string };
  'x-rune-enum-display'?: Record<string, string>;
};

/**
 * `JSONSchema7Definition = JSONSchema7 | boolean` — every sub-schema slot
 * (`properties[x]`, `items`, `allOf[i]`, `oneOf[i]`, `$defs[x]`,
 * `definitions[x]`, etc.) is legally a bare `boolean` in real JSON Schema
 * (`true` = "any value valid", `false` = "no value valid"), a shape this
 * reader's pre-retrofit hand-rolled `JsonSchemaNode` type could not
 * express at all (every nested schema field was typed as a bare object).
 * `asNode` normalizes a `JSONSchema7Definition`-shaped value (or this
 * reader's own extended `JsonSchemaNode`) down to a `JsonSchemaNode`,
 * treating a bare `boolean` as the schema-shorthand-equivalent empty
 * object (`{}` for `true`, permits everything this reader can represent;
 * `false` is diagnosed and ALSO treated as `{}` — this reader has no
 * "impossible value" representation to fall back to, so it degrades to
 * "no constraint" rather than silently miscompiling — narrower behavior
 * than a validator would need, but this is a STRUCTURAL importer, not a
 * validator).
 */
function asNode(
  def: JSONSchema7Definition | JsonSchemaNode | undefined,
  diagnostics: ImportDiagnostic[],
  where: string
): JsonSchemaNode {
  if (def === undefined) return {};
  if (typeof def === 'boolean') {
    if (def === false) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'unsupported-boolean-schema',
        message: `${where}: a bare 'false' sub-schema (matches no value) has no Rune equivalent — treated as an unconstrained schema`
      });
    }
    return {};
  }
  return def;
}

const BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'string',
  integer: 'int',
  number: 'number',
  boolean: 'boolean'
};

import type { z } from 'zod';
import type { JsonSchemaImportOptionsSchema } from '../../options/json-schema-import-options.js';

/**
 * `namespace` isn't part of the Zod schema (dedicated dialog field) — extend
 * the schema's INPUT type (not `z.infer`/output) with it here. `z.input`
 * keeps every `.optional().default(...)` field genuinely optional for
 * callers; `z.infer` resolves to the OUTPUT type, where defaulted fields
 * become required — which breaks every existing call site that omits them.
 */
export interface JsonSchemaImportOptions extends z.input<typeof JsonSchemaImportOptionsSchema> {
  /** Overrides namespace derivation from `$id` (spec.md CLI `--namespace`). */
  namespace?: string;
}

function collectRefTargets(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefTargets(item, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(value);
        if (match) out.add(match[1]!);
        continue;
      }
      collectRefTargets(value, out);
    }
  }
}

function filterUnreferencedDefs(
  defs: Record<string, JsonSchemaNode>,
  rawDefs: Record<string, JSONSchema7Definition>
): Record<string, JsonSchemaNode> {
  const referenced = new Set<string>();
  for (const [defName, def] of Object.entries(rawDefs)) {
    const refsInThisDef = new Set<string>();
    collectRefTargets(def, refsInThisDef);
    for (const target of refsInThisDef) {
      if (target !== defName) referenced.add(target);
    }
  }
  const defNames = new Set(Object.keys(defs));
  const referencedByOthers = new Set([...referenced].filter((n) => defNames.has(n)));
  const keep = new Set<string>();

  // Start from unreferenced defs — each is itself a root, regardless of
  // whether it references anything else.
  for (const name of Object.keys(defs)) {
    if (!referencedByOthers.has(name) && !keep.has(name)) {
      keep.add(name);
      const stack = [name];
      while (stack.length > 0) {
        const current = stack.pop()!;
        const refsHere = new Set<string>();
        collectRefTargets(rawDefs[current], refsHere);
        for (const r of refsHere) {
          if (defNames.has(r) && !keep.has(r)) {
            keep.add(r);
            stack.push(r);
          }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(defs).filter(([name]) => keep.has(name)));
}

/**
 * Reads a top-level JSON Schema document (with `$defs`/`definitions`) into a
 * `SourceModel`. Every `$defs`/`definitions` entry becomes either a
 * `SourceType` (object) or a `SourceEnum` (enum/const-union), in declaration
 * order.
 */
export function readJsonSchema(
  schema: JsonSchemaNode,
  options: JsonSchemaImportOptions = {}
): { model: SourceModel; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  const namespace = deriveNamespace(schema, options, diagnostics);
  const rawDefs: Record<string, JSONSchema7Definition> = { ...schema.$defs, ...schema.definitions };
  const defs: Record<string, JsonSchemaNode> = Object.fromEntries(
    Object.entries(rawDefs).map(([k, v]) => [k, asNode(v, diagnostics, `$defs/${k}`)])
  );

  const effectiveDefs = options.includeUnreferencedDefs === false ? filterUnreferencedDefs(defs, rawDefs) : defs;

  const types: SourceType[] = [];
  const enums: SourceEnum[] = [];

  for (const [key, def] of Object.entries(effectiveDefs)) {
    if (isEnumDef(def)) {
      enums.push(readEnumDef(key, def, diagnostics));
      continue;
    }
    if (def.type === 'object' || def.properties !== undefined || def.allOf !== undefined) {
      types.push(readTypeDef(key, def, defs, diagnostics, options.skipConditions ?? false));
      continue;
    }
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unrecognized-def',
      message: `$defs/${key} is neither an object nor an enum/const definition — skipped`
    });
  }

  return {
    // JSON Schema has no operation/paths concept — funcs is always empty
    // for this reader (T4's `paths` consumption is OpenAPI-only; see
    // openapi-reader.ts).
    model: { namespace, sourceName: 'JsonSchema', types, enums, funcs: [] },
    diagnostics
  };
}

// --- namespace derivation (spec.md open question 2) ------------------------

/**
 * Derives a Rune-safe dotted namespace. `options.namespace` (spec.md's CLI
 * `--namespace`) is an explicit OVERRIDE and always wins when supplied;
 * otherwise falls back to `$id` (reverse-DNS-ish:
 * `https://example.com/schemas/trade.json` → `com.example.schemas.trade`).
 * Throws when neither yields at least one valid segment — spec.md: "error
 * if neither yields a valid namespace".
 */
function deriveNamespace(
  schema: JsonSchemaNode,
  options: JsonSchemaImportOptions,
  diagnostics: ImportDiagnostic[]
): string {
  const fromId = schema.$id ? namespaceFromId(schema.$id) : undefined;
  const namespace = options.namespace ?? fromId;
  if (!namespace || !isValidNamespace(namespace)) {
    // The error message must distinguish "an override WAS supplied but was
    // itself invalid" from "no override was supplied at all" — a prior
    // version always blamed the latter even when an invalid --namespace had
    // been given, which is misleading (reviewer finding).
    if (options.namespace !== undefined) {
      throw new Error(
        `Unable to derive a Rune namespace: the supplied --namespace override ('${options.namespace}') is not a ` +
          `valid Rune namespace (expected dot-separated identifiers, e.g. 'com.example.trade').`
      );
    }
    if (fromId === undefined) {
      pushDiagnostic(diagnostics, {
        severity: 'info',
        code: 'namespace-fallback',
        message: `$id '${schema.$id ?? '<absent>'}' did not yield a usable namespace and no --namespace override was supplied`
      });
    }
    throw new Error(
      `Unable to derive a Rune namespace: '$id' ('${schema.$id ?? '<absent>'}') did not yield a valid ` +
        `namespace and no --namespace override was supplied.`
    );
  }
  return namespace;
}

function namespaceFromId(id: string): string | undefined {
  try {
    const url = new URL(id);
    const hostSegments = url.hostname.split('.').filter(Boolean).reverse();
    const pathSegments = url.pathname
      .replace(/\.(json|schema\.json)$/i, '')
      .split('/')
      .filter(Boolean);
    const segments = [...hostSegments, ...pathSegments].map(sanitizeNamespaceSegment).filter(Boolean);
    return segments.length > 0 ? segments.join('.') : undefined;
  } catch {
    // Not a URL — treat the whole $id as a single dotted path candidate.
    const segments = id.split(/[./]/).map(sanitizeNamespaceSegment).filter(Boolean);
    return segments.length > 0 ? segments.join('.') : undefined;
  }
}

const NAMESPACE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isValidNamespace(ns: string): boolean {
  return NAMESPACE_RE.test(ns);
}

// --- enum / const-union detection ------------------------------------------

/** A def is an enum def when it has a bare `enum` array, OR is a `oneOf` of single-`const` branches (no `discriminator` — that shape is the sibling-presence oneOf, handled by `readOneOfConstraint`). A bare `boolean` branch never carries `const`, so it always disqualifies the `oneOf` from being an enum def (correctly falls through to the structural/`oneOf`+`discriminator` path instead). */
function isEnumDef(def: JsonSchemaNode): boolean {
  if (Array.isArray(def.enum)) return true;
  if (Array.isArray(def.oneOf) && def.oneOf.length > 0 && !def.discriminator) {
    return def.oneOf.every((branch) => typeof branch !== 'boolean' && branch.const !== undefined);
  }
  return false;
}

function readEnumDef(key: string, def: JsonSchemaNode, diagnostics: ImportDiagnostic[]): SourceEnum {
  const displayMap = def['x-rune-enum-display'];
  const rawValues: unknown[] = Array.isArray(def.enum)
    ? def.enum
    : (def.oneOf ?? []).map((b) => asNode(b, diagnostics, `$defs/${key}.oneOf`).const);

  const used = new Set<string>();
  const values = rawValues.map((raw) => {
    const original = String(raw);
    const displayName = displayMap?.[original];
    const name = dedupeIdentifier(sanitizeIdentifier(original, 'VALUE'), used);
    return {
      name,
      // sourceKey is ALWAYS the original literal — the enum-value synonym
      // must record the round-trippable source value, not a display label
      // (a prior version conflated the two by emitting `displayName` as the
      // synonym value, which silently recorded the WRONG string whenever
      // x-rune-enum-display was present, since that map's values are
      // human-readable labels, not source literals — reviewer finding).
      sourceKey: original,
      // Prefer the outbound emitter's own x-rune-enum-display map; otherwise
      // fall back to the original literal when sanitization changed it
      // (scenario 3: "ACT/360" → ACT_360 retains the original as displayName).
      ...((displayName ?? (name !== original ? original : undefined)) !== undefined && {
        displayName: displayName ?? original
      })
    };
  });

  // The $defs/definitions KEY is used verbatim as `name` only when it is
  // ALREADY ValidID-safe — `toTypeName` sanitizes it deterministically
  // otherwise (same conversion `readTypeDef`/`readAllOfType` already apply
  // to a Data type's name). A legal JSON Schema key like `"day-count"` is
  // NOT a legal Rune identifier (hyphens aren't in ValidID) — using it
  // verbatim previously emitted `enum day-count:`, an unparseable
  // hard-invariant breach (reviewer finding). The original key survives via
  // `sourceKey` (the enum-level synonym), so nothing is lost by sanitizing.
  return { name: toTypeName(key), sourceKey: key, values };
}

// --- $ref resolution (internal $defs/definitions only) ---------------------

/** Resolves `#/$defs/<Name>` or `#/definitions/<Name>` to the def's key; anything else is an external ref (diagnostic, caller skips). */
function resolveInternalRef(ref: string): string | undefined {
  const match = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(ref);
  return match?.[1];
}

// --- object (type) definitions ----------------------------------------------

function readTypeDef(
  key: string,
  def: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean
): SourceType {
  // allOf composing [{$ref: base}, {own properties}] → extends (spec.md scenario 4).
  if (def.allOf && def.allOf.length > 0) {
    return readAllOfType(key, def, defs, diagnostics, skipConditions);
  }

  const required = new Set(def.required ?? []);
  const attributes: SourceAttribute[] = [];
  for (const [propName, rawPropDef] of Object.entries(def.properties ?? {})) {
    const propDef = asNode(rawPropDef, diagnostics, `$defs/${key}.properties.${propName}`);
    attributes.push(readAttribute(propName, propDef, required.has(propName), defs, diagnostics, skipConditions));
  }

  const constraints: ConstraintIR[] = [];
  const isDiscriminatedOneOf = def.oneOf && def.oneOf.length > 0 && def.discriminator;
  if (isDiscriminatedOneOf) {
    // Scenario 6: a discriminated oneOf's member properties live on the
    // BRANCHES, not on `def.properties` (often absent entirely, as here) —
    // without this merge the emitted type had ZERO attributes yet a
    // `required choice ...` condition referencing property names that don't
    // exist on it (reviewer finding: silent data loss + a dangling
    // reference, parseable only because unresolved `$refText`s don't fail
    // parse). Each branch property becomes an OPTIONAL attribute on the
    // parent type — exactly the shape the `required choice` condition
    // needs to reference real attributes, and matches "exactly one of these
    // optional siblings is present" semantics.
    mergeOneOfBranchAttributes(def, key, attributes, defs, diagnostics, skipConditions);
    if (!skipConditions) constraints.push(readOneOfConstraint(def, diagnostics));
  }

  return { name: toTypeName(key), sourceKey: key, attributes, constraints };
}

/**
 * Merges every `oneOf` branch's own properties into `attributes` as
 * `(0..1)` (optional) attributes, skipping any property already present
 * (from `def.properties` or an earlier branch) and skipping the
 * discriminator property itself. A property name declared with a
 * DIFFERENT type across branches is untranslatable as a single merged
 * attribute — diagnose and skip that property (`--on-untranslatable`
 * still only implements `stub`, per `import/index.ts`; the diagnostic is
 * the visible signal here since there is no per-property condition to stub).
 */
function mergeOneOfBranchAttributes(
  def: JsonSchemaNode,
  key: string,
  attributes: SourceAttribute[],
  defs: Record<string, JsonSchemaNode>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean
): void {
  const discriminatorProp = def.discriminator?.propertyName;
  const existingNames = new Set(attributes.map((a) => a.sourceKey));

  // Group every branch occurrence by property name FIRST (no resolution
  // yet) so each property's type is resolved exactly once — `readAttribute`
  // resolves the type again internally, and calling `resolveTypeName`
  // ourselves too would double any diagnostic it pushes (e.g. an
  // external-ref warning) for the same property.
  const occurrencesByProp = new Map<string, JsonSchemaNode[]>();
  for (const rawBranch of def.oneOf ?? []) {
    const branch = asNode(rawBranch, diagnostics, `$defs/${key}.oneOf`);
    for (const [propName, rawPropDef] of Object.entries(branch.properties ?? {})) {
      if (propName === discriminatorProp || existingNames.has(propName)) continue;
      const propDef = asNode(rawPropDef, diagnostics, `$defs/${key}.oneOf.properties.${propName}`);
      const list = occurrencesByProp.get(propName);
      if (list) list.push(propDef);
      else occurrencesByProp.set(propName, [propDef]);
    }
  }

  for (const [propName, propDefs] of occurrencesByProp) {
    const firstPropDef = propDefs[0]!;
    const firstTypeName = resolveTypeName(firstPropDef, defs, diagnostics, propName);
    const conflicting = propDefs
      .slice(1)
      .some((d) => resolveTypeName(d, defs, diagnostics, propName) !== firstTypeName);
    if (conflicting) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'untranslatable-construct',
        message:
          `$defs/${key}: oneOf branches declare property '${propName}' with conflicting types — ` +
          `property skipped, cannot merge into one attribute`
      });
      continue;
    }
    attributes.push(readAttribute(propName, firstPropDef, false, defs, diagnostics, skipConditions));
  }
}

function readAllOfType(
  key: string,
  def: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean
): SourceType {
  const branches = (def.allOf ?? []).map((b) => asNode(b, diagnostics, `$defs/${key}.allOf`));
  const baseBranch = branches.find((b) => b.$ref !== undefined);
  const ownBranch = branches.find((b) => b.properties !== undefined) ?? branches.find((b) => b !== baseBranch);

  let extendsName: string | undefined;
  if (baseBranch?.$ref) {
    const refKey = resolveInternalRef(baseBranch.$ref);
    if (refKey) {
      extendsName = toTypeName(refKey);
    } else {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'external-ref',
        message: `$defs/${key}: allOf base $ref '${baseBranch.$ref}' is not an internal $defs/definitions reference — extends omitted`
      });
    }
  }

  const required = new Set(ownBranch?.required ?? []);
  const attributes: SourceAttribute[] = [];
  for (const [propName, rawPropDef] of Object.entries(ownBranch?.properties ?? {})) {
    const propDef = asNode(rawPropDef, diagnostics, `$defs/${key}.allOf.properties.${propName}`);
    attributes.push(readAttribute(propName, propDef, required.has(propName), defs, diagnostics, skipConditions));
  }

  // A def can carry `allOf` (composing a base type) AND its own top-level
  // `oneOf`+`discriminator` (a discriminated union ALSO extending a base
  // type) — `readTypeDef` dispatches `allOf` defs here before ever checking
  // `oneOf`, so without this the combination silently dropped the choice
  // condition entirely (reviewer Minor finding). Same merge as the
  // non-allOf path in `readTypeDef`.
  const constraints: ConstraintIR[] = [];
  if (def.oneOf && def.oneOf.length > 0 && def.discriminator) {
    mergeOneOfBranchAttributes(def, key, attributes, defs, diagnostics, skipConditions);
    if (!skipConditions) constraints.push(readOneOfConstraint(def, diagnostics));
  }

  return {
    name: toTypeName(key),
    sourceKey: key,
    ...(extendsName !== undefined && { extends: extendsName }),
    attributes,
    constraints
  };
}

function readAttribute(
  propName: string,
  propDef: JsonSchemaNode,
  isRequired: boolean,
  defs: Record<string, JsonSchemaNode>,
  diagnostics: ImportDiagnostic[],
  skipConditions: boolean
): SourceAttribute {
  const constraints: ConstraintIR[] = [];
  const isArray = propDef.type === 'array';
  // `items` is `JSONSchema7Definition | JSONSchema7Definition[] | undefined`
  // — the ARRAY form ("tuple typing": a fixed per-position schema list) is a
  // real Draft 7 shape this reader's pre-retrofit hand-rolled type never
  // modeled (it only ever declared `items?: JsonSchemaNode`, a bare single
  // schema). Tuple typing has no single-element-type Rune equivalent to
  // derive a cardinality attribute's `typeName` from — diagnosed and
  // treated as an untyped ('string') single-element array rather than
  // silently reading only the first tuple slot (which would misrepresent
  // the other positions' types).
  let itemDef: JsonSchemaNode;
  if (!isArray) {
    itemDef = propDef;
  } else if (Array.isArray(propDef.items)) {
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-tuple-items',
      message: `property '${propName}': array 'items' is a tuple (fixed per-position schema list) — Rune has no per-position array-element type; using 'string'`
    });
    itemDef = {};
  } else {
    itemDef = asNode(propDef.items, diagnostics, `${propName}.items`);
  }

  const typeName = resolveTypeName(itemDef, defs, diagnostics, propName);

  const cardinality = isArray
    ? { inf: propDef.minItems ?? 0, ...(propDef.maxItems !== undefined && { sup: propDef.maxItems }) }
    : { inf: isRequired ? 1 : 0, sup: 1 };

  if (!skipConditions) {
    const constraintTarget = isArray ? itemDef : propDef;
    pushRangeConstraint(constraintTarget, propName, constraints);
    pushLengthConstraint(propDef, propName, constraints, isArray);
    if (constraintTarget.pattern !== undefined) {
      // Diagnostic intentionally NOT pushed here — constraint-translator.ts's
      // `translateConstraintExpression` already pushes one `untranslatable-
      // construct` warning for every `pattern` IR when it emits the stub;
      // pushing a second one here double-diagnosed the identical constraint
      // (reviewer finding).
      constraints.push({ kind: 'pattern', path: propName, regex: constraintTarget.pattern });
    }
  }

  return {
    name: toAttributeName(propName),
    typeName,
    cardinality,
    ...(propDef.description !== undefined && { description: propDef.description }),
    sourceKey: propName,
    constraints
  };
}

/**
 * Emits ONE `range` IR PER BOUND (never one IR carrying both), so each
 * bound's exclusivity is independent — a single shared `exclusive` flag on
 * one IR would force `exclusiveMinimum` to also make an inclusive `maximum`
 * exclusive (reviewer finding: `{exclusiveMinimum:0, maximum:10}` silently
 * rendered `v < 10` instead of `v <= 10`, rejecting the boundary value the
 * source schema permits).
 *
 * Handles BOTH exclusivity forms the module doc claims ("Draft 7 /
 * 2020-12"): the 2020-12 numeric form (`exclusiveMinimum: 0` — the bound
 * value itself, `minimum` absent) and the Draft-7 boolean-modifier form
 * (`minimum: 5, exclusiveMinimum: true` — `minimum` carries the bound,
 * `exclusiveMinimum` only toggles inclusivity). The reader's own
 * `JsonSchemaNode` type already declares `exclusiveMinimum?: number |
 * boolean`, but only the numeric form was actually read (reviewer finding:
 * `{minimum: 5, exclusiveMinimum: true}` silently imported as `v >= 5`).
 */
function pushRangeConstraint(node: JsonSchemaNode, path: string, constraints: ConstraintIR[]): void {
  const minExclusive = typeof node.exclusiveMinimum === 'number' || node.exclusiveMinimum === true;
  const maxExclusive = typeof node.exclusiveMaximum === 'number' || node.exclusiveMaximum === true;
  const min = typeof node.exclusiveMinimum === 'number' ? node.exclusiveMinimum : node.minimum;
  const max = typeof node.exclusiveMaximum === 'number' ? node.exclusiveMaximum : node.maximum;

  if (min !== undefined) {
    constraints.push({ kind: 'range', path, min, ...(minExclusive && { exclusive: true }) });
  }
  if (max !== undefined) {
    constraints.push({ kind: 'range', path, max, ...(maxExclusive && { exclusive: true }) });
  }
}

function pushLengthConstraint(node: JsonSchemaNode, path: string, constraints: ConstraintIR[], isArray: boolean): void {
  // For a scalar string, minLength/maxLength map to `length` on the attribute
  // itself; for an array, minItems/maxItems ALREADY encode cardinality (not a
  // condition) — see readAttribute's cardinality derivation — so only the
  // scalar string form emits a length constraint here.
  if (isArray) return;
  if (node.minLength !== undefined || node.maxLength !== undefined) {
    constraints.push({
      kind: 'length',
      path,
      ...(node.minLength !== undefined && { min: node.minLength }),
      ...(node.maxLength !== undefined && { max: node.maxLength })
    });
  }
}

/** `oneOf` + `discriminator` → `oneOf` ConstraintIR over the union member property names (scenario 6). */
function readOneOfConstraint(def: JsonSchemaNode, diagnostics: ImportDiagnostic[]): ConstraintIR {
  const propertyName = def.discriminator?.propertyName;
  const paths = (def.oneOf ?? [])
    .flatMap((branch) => Object.keys(asNode(branch, diagnostics, 'oneOf').properties ?? {}))
    .filter((p) => p !== propertyName);
  return { kind: 'oneOf', paths: [...new Set(paths)] };
}

function resolveTypeName(
  node: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  diagnostics: ImportDiagnostic[],
  propName: string
): string {
  if (node.$ref) {
    const refKey = resolveInternalRef(node.$ref);
    if (refKey && refKey in defs) {
      // Both branches must apply the SAME sanitization `readEnumDef`/
      // `readTypeDef` apply to the declaration itself (`toTypeName`) — a
      // prior version returned the RAW refKey for an enum reference, which
      // both breaks parse (an unsanitized name used as a type reference)
      // AND, even where it happened to be ValidID-safe, could never match a
      // sanitized declaration name for a key that wasn't (reviewer finding).
      return toTypeName(refKey);
    }
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'external-ref',
      message: `property '${propName}': $ref '${node.$ref}' is not an internal $defs/definitions reference — using 'string'`
    });
    return 'string';
  }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === 'object' && node.properties !== undefined) {
    // An INLINE nested object (not a $ref to a $defs/definitions entry) has
    // no named Rune type to reference — MVP rule (spec.md open question 4)
    // only promotes a $ref reused across ≥2 sites to a named type; a single
    // inline object has no such reuse site to hoist to. Falling back to
    // `string` unconditionally is silent, indistinguishable-from-a-real-
    // string data loss (reviewer finding) — diagnose it so the gap is
    // visible rather than swallowed.
    pushDiagnostic(diagnostics, {
      severity: 'warning',
      code: 'unsupported-inline-object',
      message: `property '${propName}': inline nested object schema has no named Rune type to reference — using 'string'; extract it to '$defs'/'definitions' and reference it via '$ref' to import it as a real type`
    });
    return 'string';
  }
  return (type && BUILTIN_TYPE_MAP[type]) ?? 'string';
}

// --- naming -----------------------------------------------------------------

/** JSON Schema def keys are used verbatim as Rune type/enum names when already ValidID-safe (the common case); sanitized otherwise. */
function toTypeName(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : sanitizeIdentifier(key, 'VALUE');
}

/** JSON property names are used verbatim when already ValidID-safe camelCase-ish identifiers; sanitized otherwise. */
function toAttributeName(propName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(propName) ? propName : sanitizeIdentifier(propName, 'VALUE');
}
