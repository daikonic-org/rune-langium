// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { choiceOptionFieldName } from '@rune-langium/core';

import type { RosettaCardinality, Data, Choice, Condition, RosettaRule } from '@rune-langium/core';
import { isData, isChoice } from '@rune-langium/core';
import type { NamespaceRegistry } from './namespace-registry.js';
import { resolveImportPath } from './namespace-registry.js';
import type { NamespaceEmitterOptions } from './namespace-emitter.js';
import type { NamespaceWalkResult } from './namespace-walker.js';
import type { GeneratorOutput, GeneratorDiagnostic } from '../types.js';
import type { ExpressionTranspilerContext } from '../expr/transpiler.js';

export abstract class BaseNamespaceEmitter {
  protected readonly model: NamespaceWalkResult;
  protected readonly registry: NamespaceRegistry;
  protected readonly suppressBoilerplate: boolean;
  protected readonly projectResources: NamespaceEmitterOptions['projectResources'];
  protected readonly diagnostics: GeneratorDiagnostic[] = [];

  constructor(model: NamespaceWalkResult, options: NamespaceEmitterOptions, registry: NamespaceRegistry) {
    this.model = model;
    this.registry = registry;
    this.suppressBoilerplate = options.suppressBoilerplate ?? false;
    this.projectResources = options.projectResources;
  }

  /**
   * Push the standard unresolved-type-reference diagnostic. `fallbackDescription`
   * is the one piece that legitimately differs per emitter (what it falls back to
   * emitting — e.g. `'z.unknown()'`, `'unknown'`, `'{}'`, `'xs:string'`), so each
   * emitter's message text is unchanged; only the object-construction and push are shared.
   */
  protected reportUnresolvedReference(
    attrName: string,
    refText: string | undefined,
    fallbackDescription: string
  ): void {
    this.diagnostics.push({
      severity: 'warning',
      code: 'unresolved-ref',
      message: refText
        ? `Attribute '${attrName}': type '${refText}' is not resolved; emitting ${fallbackDescription}`
        : `Attribute '${attrName}' has an unresolved type reference; emitting ${fallbackDescription}`
    });
  }

  abstract finalize(): GeneratorOutput;
}

// ---------------------------------------------------------------------------
// Shared emitter helpers — co-located with the base class; imported by subclasses.
// ---------------------------------------------------------------------------

/**
 * Decode a RosettaCardinality into lower/upper bounds (`upper === null` = unbounded).
 *
 * `card` is typed as required, but a deserialized curated document (built
 * via `hydrateModelDocument`'s JSON round-trip rather than a live Langium
 * parse+link) can carry an attribute whose cardinality field didn't survive
 * that round-trip. One malformed attribute crashing the ENTIRE multi-
 * namespace generation (this ran inside a loop over every Data type in
 * every requested namespace) is strictly worse than degrading that one
 * field to the most permissive cardinality and letting everything else
 * emit correctly — so this defends against `card` being missing rather
 * than throwing (found via the 2026-07 codegen-400/500 investigation).
 */
export function decodeCardinality(card: RosettaCardinality | undefined): { lower: number; upper: number | null } {
  if (!card) {
    console.warn('[codegen] decodeCardinality: attribute had no cardinality — defaulting to (0..*)');
    return { lower: 0, upper: null };
  }
  const lower = card.inf;
  const upper = card.unbounded ? null : (card.sup ?? lower);
  return { lower, upper };
}

/**
 * Build a map of attribute name → type name for a Data node, including
 * attributes from the FULL `extends` chain (not just the direct parent) —
 * an attribute declared 2+ levels up (e.g. `QuantitySchedule extends
 * MeasureSchedule extends MeasureBase`, with `unit` declared on
 * `MeasureBase`) must still resolve for `exists`/`is absent` conditions
 * declared on the descendant type. A visited-set guards against a
 * malformed cyclic `extends` chain looping forever.
 *
 * Data-extends-Choice (real corpus case: `BasketConstituent extends
 * Observable`): a Data's `superType` reference is typed `DataOrChoice` —
 * when the walk reaches a `Choice` ancestor (a Choice cannot itself
 * `extends`, so the chain necessarily terminates there), the Choice's
 * option names are contributed as pseudo-attributes (per the design's
 * Semantics: "the child carries the choice's options ... PLUS its own
 * attributes"), keyed by the option's Data-type name (the same name a
 * condition like `Basket is absent` references) — mapped to that same
 * name as its "type" (an option has no attribute name of its own, only a
 * typeCall; the option's type name IS the pseudo-attribute name here,
 * mirroring how transpileCondition's `extractAttrName` resolves a bare
 * `RosettaSymbolReference` to `expr.symbol.$refText`).
 */
export function buildAttributeTypesMap(data: Data): Map<string, string> {
  const map = new Map<string, string>();
  const visited = new Set<string>();
  let current: Data | undefined = data;
  while (current && !visited.has(current.name)) {
    visited.add(current.name);
    for (const attr of current.attributes) {
      if (!map.has(attr.name)) map.set(attr.name, attr.typeCall?.type?.$refText ?? 'unknown');
    }
    const parent: unknown = current.superType?.ref;
    if (parent && isChoice(parent)) {
      contributeChoiceOptionsAsAttributes(parent, map, visited);
      current = undefined;
      break;
    }
    current = parent && isData(parent) ? parent : undefined;
  }
  return map;
}

/**
 * Contribute a Choice's option names as pseudo-attributes into `map`.
 * A Choice cannot `extends` anything (it has no `superType`), so this is
 * a leaf contribution — no further chain walk from here. `visited` is
 * threaded through for symmetry with the Data walk's cycle guard, though
 * a Choice can't itself be revisited via `extends` (only via nested option
 * types, which are NOT walked here — pseudo-attributes are the option
 * NAMES themselves, not their own attribute sets).
 */
function contributeChoiceOptionsAsAttributes(choice: Choice, map: Map<string, string>, visited: Set<string>): void {
  if (visited.has(choice.name)) return;
  visited.add(choice.name);
  for (const option of choice.attributes) {
    const optionTypeName = option.typeCall?.type?.ref?.name ?? option.typeCall?.type?.$refText;
    if (!optionTypeName) continue;
    if (!map.has(optionTypeName)) map.set(optionTypeName, optionTypeName);
  }
}

/**
 * Derive a ChoiceOption's emitted field name from its type name:
 * camelCase-first-letter (`Cash` -> `cash`). The established W2
 * option-key naming convention (FIELD-NAMING DECISION, no CDM JSON
 * data-instance fixture exists to verify a Choice's wire encoding against
 * — verified empirically, only build-tooling JSON is present in the
 * corpus) — used identically by ts-emitter's Choice union member keys
 * (`{ cash: Cash }`) and zod-emitter's Choice arm object keys
 * (`z.strictObject({ cash: CashSchema })`). Centralized here (was
 * duplicated privately in both emitters) so `buildAttrAccessorNamesMap`
 * can share the exact same mapping.
 */
export { choiceOptionFieldName } from '@rune-langium/core';

/**
 * Build a map of pseudo-attribute name (the bare option TYPE name, e.g.
 * `Cash` — matching `buildAttributeTypesMap`'s keys AND the literal text a
 * Rune condition references, e.g. `Cash is absent`) → the REAL emitted
 * property-access suffix for that same option (`cash`, per
 * `choiceOptionFieldName`).
 *
 * Only Data-extends-Choice pseudo-attributes need this remap — ordinary
 * Data attributes are emitted verbatim under `attr.name` (their author-
 * given name IS their emitted field name; see emitAttribute/emitInterface),
 * so this map only ever contains entries contributed by a Choice ancestor
 * walk (mirrors `buildAttributeTypesMap`'s own Choice-ancestor branch —
 * same chain walk, same cycle guard, kept as a SEPARATE function rather
 * than folded into `buildAttributeTypesMap` itself so ordinary callers that
 * only need type-checking, not accessor remapping, don't pay for it).
 *
 * Consumed via `ExpressionTranspilerContext.attrAccessorNames` (see
 * expr/transpiler.ts's `attrAccessExpr`) so a transpiled condition like
 * `Cash is absent` emits `data.cash` (the real field), not `data.Cash`
 * (undefined at runtime — a silent false-negative).
 */
export function buildAttrAccessorNamesMap(data: Data): Map<string, string> {
  const map = new Map<string, string>();
  const visited = new Set<string>();
  let current: Data | undefined = data;
  while (current && !visited.has(current.name)) {
    visited.add(current.name);
    const parent: unknown = current.superType?.ref;
    if (parent && isChoice(parent)) {
      for (const option of parent.attributes) {
        const optionTypeName = option.typeCall?.type?.ref?.name ?? option.typeCall?.type?.$refText;
        if (!optionTypeName) continue;
        if (!map.has(optionTypeName)) map.set(optionTypeName, choiceOptionFieldName(optionTypeName));
      }
      break;
    }
    current = parent && isData(parent) ? parent : undefined;
  }
  return map;
}

/** Return the conditions on a Data node that have a non-null expression. */
export function activeConditions(data: Data): Condition[] {
  return (data.conditions ?? []).filter((c) => c.expression != null);
}

/** Build an ExpressionTranspilerContext for a given Data node and emit mode. */
export function buildConditionTranspilerContext(
  data: Data,
  emitMode: 'zod-refine' | 'zod-superRefine' | 'ts-method',
  conditionName: string,
  diagnostics: GeneratorDiagnostic[]
): ExpressionTranspilerContext {
  return {
    selfName: 'data',
    emitMode,
    conditionName,
    typeName: data.name,
    attributeTypes: buildAttributeTypesMap(data),
    diagnostics,
    attrAccessorNames: buildAttrAccessorNamesMap(data)
  };
}

/** Merge basicTypeMap ∪ recordTypeMap ∪ typeAliasMap from a language profile. */
export function mergeProfileTypeMaps<T>(profile: {
  basicTypeMap: Record<string, T>;
  recordTypeMap: Record<string, T>;
  typeAliasMap: Record<string, T>;
}): Record<string, T> {
  return { ...profile.basicTypeMap, ...profile.recordTypeMap, ...profile.typeAliasMap };
}

/** Build sorted emit lines for a `runeReportRules` const object body. */
export function buildReportRulesLines(
  rulesByName: ReadonlyMap<string, RosettaRule>,
  exportedName = 'runeReportRules'
): string[] {
  const ruleNames = Array.from(rulesByName.keys()).sort();
  if (ruleNames.length === 0) return [];
  const lines = [`export const ${exportedName} = {`];
  for (const name of ruleNames) {
    const rule = rulesByName.get(name)!;
    const kind = rule.eligibility ? 'eligibility' : 'reporting';
    const inputName = rule.input?.type?.ref?.name ?? 'unknown';
    lines.push(`  '${name}': { kind: '${kind}' as const, inputType: '${inputName}' },`);
  }
  lines.push('} as const;');
  return lines;
}

/** Build sorted ES import lines for cross-namespace references. */
export function buildCrossNsImportLines(
  imports: Map<string, Set<string>>,
  fromNs: string,
  registry: NamespaceRegistry,
  suffix: string
): string[] {
  return [...imports.keys()].sort().flatMap((ns) => {
    const symbols = [...(imports.get(ns) ?? [])].sort();
    if (symbols.length === 0) return [];
    const path = resolveImportPath(fromNs, ns, registry);
    return [`import { ${symbols.join(', ')} } from '${path}${suffix}';`];
  });
}
