// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * SourceModel + ConstraintIR — the source-agnostic intermediate
 * representation inbound generation normalizes every source format onto.
 *
 * Per specs/021-codegen-inbound/spec.md "The SourceModel IR" / "The
 * ConstraintIR — MVP Core". Deliberately close to the Rune AST shape but
 * without any Langium machinery — every `sources/*-reader.ts` importer's
 * only job is `source → SourceModel`; `ast-builder.ts` and
 * `constraint-translator.ts` are shared across all four (eventual) sources.
 *
 * Types only — no logic in this module.
 */

/** Sources normalized by the common model builder, including prepared resource lists. */
export type SourceKind = 'JsonSchema' | 'OpenApi' | 'TypeScript' | 'Sql' | 'Pydantic' | 'Xsd' | 'CodeList';

/** A Rune cardinality, pre-rendered form: `(inf..sup)` or `(inf..*)` when `sup` is undefined. */
export interface SourceCardinality {
  inf: number;
  /** Upper bound; absent means unbounded (`*`). */
  sup?: number;
}

/** A JSON/source literal value usable as the RHS of a `comparison` constraint. */
export type Literal = string | number | boolean;

/**
 * The normalized constraint vocabulary every source's validation syntax
 * reduces to. `constraint-translator.ts` is the single place that knows how
 * to render each kind as a Rune `condition` AST node.
 *
 * `path` / `paths` are attribute-local: a bare attribute name resolvable as
 * a sibling `Attribute` on the same `SourceType` (or, for a top-level
 * condition, an attribute of the type the condition is attached to) — NOT
 * an arbitrary JSON-pointer-style path. This follows from the grammar: the
 * `oneOf`/`choice` Rune surface (`ChoiceOperation`) references attributes by
 * `[Attribute:ValidID]`, a simple in-scope identifier, so a multi-segment
 * path is not representable and must be rejected to a `custom` stub by the
 * reader before it ever reaches the translator.
 */
export type ConstraintIR =
  | { kind: 'comparison'; op: '=' | '<>' | '<' | '<=' | '>' | '>='; path: string; value: Literal }
  | { kind: 'range'; path: string; min?: number; max?: number; exclusive?: boolean }
  | { kind: 'length'; path: string; min?: number; max?: number }
  /** AMENDED (spec.md open question 3): always emits a stub + diagnostic — the
   * Rune grammar has no expression-level regex operator. */
  | { kind: 'pattern'; path: string; regex: string }
  /** Exactly one of `paths` present — renders as `required choice p1, p2, ...`. */
  | { kind: 'oneOf'; paths: string[] }
  /** At most one of `paths` present — renders as `optional choice p1, p2, ...`. */
  | { kind: 'choice'; paths: string[] }
  | { kind: 'exists'; path: string }
  | { kind: 'absent'; path: string }
  | { kind: 'conditional'; if: ConstraintIR; then: ConstraintIR }
  /** Untranslatable source construct — always emits a stub + diagnostic. */
  | { kind: 'custom'; expressionText: string; translatable: false };

export interface SourceAttribute {
  /** Rune-safe camelCase identifier (escaped with `^` if it collides with a Rune keyword). */
  name: string;
  /** Resolved Rune type / enum / builtin name (`$refText` target). */
  typeName: string;
  cardinality: SourceCardinality;
  description?: string;
  /** Original property/column/field name, for the synonym annotation. */
  sourceKey: string;
  /** Attribute-level constraints → conditions (or synonym mapping logic, in a later phase). */
  constraints: ConstraintIR[];
}

export interface SourceType {
  name: string;
  /** Parent type name, if this type extends another (`allOf` composition). */
  extends?: string;
  description?: string;
  attributes: SourceAttribute[];
  /** Type-level invariants → conditions (e.g. a `oneOf`/`discriminator` union). */
  constraints: ConstraintIR[];
  /** Original name in the source, for the type-level synonym annotation. */
  sourceKey: string;
}

export interface SourceEnumValue {
  /** Rune-safe identifier (sanitized + deduped when the source value isn't ValidID-safe). */
  name: string;
  /**
   * The ORIGINAL source enum literal (e.g. `"ACT/360"`, or `"Active"` when a
   * display map maps it to a human-readable string) — used for the
   * per-value `[synonym <Source> value "..."]` annotation, which must
   * record the round-trippable source value, NOT a display label.
   * Always populated by every reader; distinct from `displayName`, which
   * is purely presentational and may differ from both `name` and `sourceKey`.
   */
  sourceKey: string;
  /** Human-readable display label (e.g. from the outbound emitter's own `x-rune-enum-display`, or the original literal when sanitization changed `name` and no display map entry exists). Rendered as Rune's `displayName "..."`. */
  displayName?: string;
  description?: string;
}

export interface SourceEnum {
  name: string;
  values: SourceEnumValue[];
  /** Original name in the source, for the enum-level synonym annotation. */
  sourceKey: string;
}

/** One input or output parameter of a source-format operation (spec.md Phase 2b Implementation Addendum decision 4's inbound half). */
export interface SourceFuncParam {
  /** Rune-safe camelCase identifier. */
  name: string;
  /** Resolved Rune type / enum / builtin name. */
  typeName: string;
  cardinality: SourceCardinality;
}

/**
 * A source-format operation, normalized toward a Rune `func` (`RosettaFunction`).
 * Currently populated only by the OpenAPI reader's `paths` consumption
 * (T4) — the other (follow-up) sources have no operation concept.
 */
export interface SourceFunc {
  /** Rune-safe func name (from `operationId`, sanitized). */
  name: string;
  inputs: SourceFuncParam[];
  output: SourceFuncParam;
  /** `summary`/`description` → Rune `func`'s `definition` doc string. */
  description?: string;
  /**
   * The "METHOD /path" operation string this func corresponds to — the
   * SAME string the outbound emitter's `operationStringForFunc` derives
   * and T2's `operation-carrier.ts` attaches via
   * `[openApi op "value"="METHOD /path"]`, so the round trip closes.
   */
  operation: string;
}

export interface SourceModel {
  /** Derived (e.g. from a JSON Schema `$id`) or supplied via `--namespace`. */
  namespace: string;
  sourceName: SourceKind;
  types: SourceType[];
  enums: SourceEnum[];
  /** Operations reconstructed as funcs (currently OpenAPI `paths` only — spec.md Phase 2b decision 4). */
  funcs: SourceFunc[];
}
