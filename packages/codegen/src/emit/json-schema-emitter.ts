// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * JSON Schema 2020-12 target emitter for the Rune code generator.
 *
 * Entry point: emitNamespace(model, options) → GeneratorOutput
 *
 * FR-019: Emit JSON Schema 2020-12 documents encoding cardinality,
 * enums, and inheritance equivalent to the Zod target.
 *
 * ─── CONDITION LIMITATIONS ───────────────────────────────────────────────────
 * JSON Schema cannot fully express Rune's condition forms. Specifically:
 *
 *   - `one-of` / `choice` over optional siblings: In simple cases these can be
 *     modelled with `"oneOf": [...]`, but Rune's semantics (exactly one of a set
 *     of optional attributes is present) don't map cleanly to `oneOf` because JSON
 *     Schema's `oneOf` validates the entire document against each subschema — not
 *     just attribute presence. We emit these as `"x-rune-conditions"` metadata.
 *
 *   - `exists` on a single required attr: We mark the attr in `"required"`. This
 *     is the one condition form we CAN faithfully express in JSON Schema.
 *
 *   - `is absent` / `only exists` / all arithmetic, comparison, boolean, set,
 *     aggregation, higher-order, and conditional expression predicates: Not
 *     expressible in JSON Schema. Emitted as opaque `"x-rune-conditions"` entries
 *     (using the conventional `x-` prefix for non-standard extensions) so
 *     downstream consumers know the conditions exist.
 *
 * FR-019 only requires "cardinality and enums encoded" in JSON Schema; conditions
 * are not promised in JSON Schema output. This design is intentional and consistent
 * with the spec.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveProjectTypeCall, projectJsonCodeList } from './project-resource-binding.js';
import { projectCodeListForAlias } from '../runtime/project-bindings.js';
import {
  isChoice,
  isData,
  type Choice,
  type Data,
  type Attribute,
  type RosettaEnumeration,
  type RosettaCardinality,
  type RosettaTypeAlias,
  type RosettaRule,
  type RosettaReport,
  type Annotation,
  type RosettaExternalFunction
} from '@rune-langium/core';
import type { GeneratorOptions, GeneratorOutput, SourceMapEntry, GeneratorDiagnostic } from '../types.js';
import { emitNamespaceWithContract } from './namespace-emitter.js';
import type { NamespaceEmitterOptions } from './namespace-emitter.js';
import {
  BaseNamespaceEmitter,
  mergeProfileTypeMaps,
  decodeCardinality,
  choiceOptionFieldName
} from './base-namespace-emitter.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import { getTargetRelativePath, type NamespaceWalkResult } from './namespace-walker.js';
import { jsonSchemaProfile } from './json-schema-profile.js';
import { toTypeIndexLookup, type TypeIndexLookup } from './type-ref-resolver.js';
import { debug } from '../instrument.js';

/** JSON Schema 2020-12 meta-schema URI. */
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Internal emission context for one namespace.
 */
interface EmissionContext {
  /** The namespace string (e.g., "test.cardinality"). */
  namespace: string;
  /** The relative output path (e.g., "test/cardinality.schema.json"). */
  relativePath: string;
  /** All Data nodes keyed by name. */
  dataByName: ReadonlyMap<string, Data>;
  /** All Choice nodes keyed by name (W2/item-1 mirror of ts/zod emitters). */
  choiceByName: ReadonlyMap<string, Choice>;
  /** All Enumeration nodes keyed by name. */
  enumByName: ReadonlyMap<string, RosettaEnumeration>;
  typeAliasByName: ReadonlyMap<string, RosettaTypeAlias>;
  rulesByName: ReadonlyMap<string, RosettaRule>;
  reportsByName: ReadonlyMap<string, RosettaReport>;
  annotationsByName: ReadonlyMap<string, Annotation>;
  libraryFuncsByName: ReadonlyMap<string, RosettaExternalFunction>;
  /** Types in emission order (topo-sorted). */
  emitOrder: readonly string[];
  /** Source-map entries collected during emission. */
  sourceMap: SourceMapEntry[];
  /** Generator-time diagnostics accumulated during emission. */
  diagnostics: GeneratorDiagnostic[];
  registry: NamespaceRegistry;
  /** Merged builtin type map from the JSON Schema profile (basicTypeMap ∪ recordTypeMap ∪ typeAliasMap). */
  builtinTypeMap: Readonly<Record<string, object>>;
}

interface PendingSourceMapEntry {
  name: string;
  sourceUri: string;
  sourceLine: number;
  sourceChar: number;
}

const JSON_BUILTIN_TYPE_MAP: Readonly<Record<string, object>> = mergeProfileTypeMaps(jsonSchemaProfile) as Record<
  string,
  object
>;

function buildEmissionContext(
  model: NamespaceWalkResult,
  registry: NamespaceRegistry,
  diagnostics: GeneratorDiagnostic[]
): EmissionContext {
  return {
    namespace: model.namespace,
    relativePath: getTargetRelativePath(model.namespace, 'json-schema'),
    dataByName: model.dataByName,
    choiceByName: model.choiceByName,
    enumByName: model.enumByName,
    typeAliasByName: model.typeAliasByName,
    rulesByName: model.rulesByName,
    reportsByName: model.reportsByName,
    annotationsByName: model.annotationsByName,
    libraryFuncsByName: model.libraryFuncsByName,
    emitOrder: model.emitOrder,
    sourceMap: [],
    diagnostics,
    registry,
    builtinTypeMap: JSON_BUILTIN_TYPE_MAP
  };
}

/**
 * Emit one namespace as a single .schema.json file.
 *
 * Entry point for the JSON Schema emitter.
 * T093, T096, T097.
 *
 * Source-map convention for JSON Schema (FR-018, studio-preview.md §Source-map coverage):
 *   - Each type ($defs/<TypeName>) → maps to the `type TypeName:` Rune source line
 *
 * Source-map entries point at the concrete `$defs/<TypeName>` key lines in the emitted
 * JSON so Studio line-click navigation can resolve back to the defining Rune node.
 */
export function emitNamespace(
  model: NamespaceWalkResult,
  options: GeneratorOptions,
  registry: NamespaceRegistry = { namespaces: new Map() }
): GeneratorOutput {
  return emitNamespaceWithContract(model, options, registry, JsonSchemaNamespaceEmitter);
}

export class JsonSchemaNamespaceEmitter extends BaseNamespaceEmitter {
  private readonly ctx: EmissionContext;
  private readonly typeIndex: TypeIndexLookup;
  private readonly $defs: Record<string, object> = {};
  private readonly pendingSourceMapEntries: PendingSourceMapEntry[] = [];
  private readonly fallbackSourceUri: string;
  private readonly rulesMetadata: Record<string, { kind: string; inputType: string }> = {};

  constructor(
    model: NamespaceWalkResult,
    options: NamespaceEmitterOptions,
    registry: NamespaceRegistry = { namespaces: new Map() }
  ) {
    super(model, options, registry);
    this.ctx = buildEmissionContext(model, registry, this.diagnostics);
    this.fallbackSourceUri = model.docs[0]?.uri?.toString() ?? '';
    this.typeIndex = toTypeIndexLookup(this.ctx, this.fallbackSourceUri);
    this.typesWithLocalSubtype = JsonSchemaNamespaceEmitter.computeTypesWithLocalSubtype(
      model.dataByName,
      model.choiceByName
    );
  }

  /**
   * Names of Data AND Choice types that have at least one Data subtype IN
   * THIS NAMESPACE's `dataByName` (i.e. some other Data in this namespace's
   * `superType` resolves to them). Computed once per emitter instance.
   * Shared by both `emitTypeDef` (Data-extends-Data) and `emitChoiceDef`
   * (Data-extends-Choice) — a Choice being extended has the identical
   * "own branches must not self-close" requirement as an extended Data,
   * for the identical ajv-verified reason (see both methods' doc
   * comments).
   *
   * Item 1 adjacent-suspect fix (docs/superpowers/specs/2026-07-02-emitter-
   * crossns-hardening-design.md): a type that is SOMEONE's supertype must
   * never self-close its own `$defs` entry with `additionalProperties:
   * false` — see `emitTypeDef`'s doc comment for the full ajv-verified
   * rationale. This index limits detection to same-namespace subtypes; a
   * type extended ONLY from another namespace (this namespace has no
   * visibility into foreign `dataByName` maps) is not detected and keeps
   * `additionalProperties: false` on its own def — the same latent gap the
   * emitter's existing cross-namespace `$ref` strategy already has
   * elsewhere (non-goal: "JSON Schema cross-namespace $ref STRATEGY...
   * stays whatever it is today").
   */
  private readonly typesWithLocalSubtype: ReadonlySet<string>;

  private static computeTypesWithLocalSubtype(
    dataByName: ReadonlyMap<string, Data>,
    choiceByName: ReadonlyMap<string, Choice>
  ): Set<string> {
    const result = new Set<string>();
    for (const data of dataByName.values()) {
      const parentRef = data.superType?.ref;
      if (!parentRef) continue;
      // Identity compare, not name-presence: a cross-namespace parent whose
      // name collides with an unrelated LOCAL type must not open the local
      // type. (Unreachable via `extends <name>` today — Rune scoping
      // resolves a shadowed name to the local declaration, probe-verified —
      // but identity keeps this correct independent of that scoping
      // invariant.)
      if (isData(parentRef) && dataByName.get(parentRef.name) === parentRef) {
        result.add(parentRef.name);
      } else if (isChoice(parentRef) && choiceByName.get(parentRef.name) === parentRef) {
        result.add(parentRef.name);
      }
    }
    return result;
  }

  /*
   * NOTE: unlike ts-emitter's and zod-emitter's `findChoiceAncestor` walk,
   * this emitter does NOT need an equivalent multi-level lookahead. JSON
   * Schema's `$ref` composes recursively for free: `BasketConstituent`
   * references `#/$defs/ObservableItem`, whose OWN def already derives
   * from `#/$defs/Asset` — a validator resolves the whole chain by
   * following `$ref`s, so `emitTypeDef`'s single-level `$ref` to the
   * IMMEDIATE `superType` (Data or Choice, same code path) is sufficient
   * at every depth. Verified with a real 3-level ajv probe (Data extends
   * Data extends Choice) during design — see item 1's design doc "Multi-
   * level ... resolves through the chain".
   */

  private trackDefinitionSourceMap(node: Data | Choice | RosettaEnumeration | RosettaTypeAlias): void {
    const start = node.$cstNode?.range?.start;
    const sourceUri = node.$container?.$document?.uri?.toString() ?? this.fallbackSourceUri;
    if (!sourceUri || !start) {
      return;
    }
    this.pendingSourceMapEntries.push({
      name: node.name,
      sourceUri,
      sourceLine: start.line + 1,
      sourceChar: start.character + 1
    });
  }

  private flushSourceMap(content: string): void {
    const lines = content.split('\n');
    for (const entry of this.pendingSourceMapEntries) {
      const marker = `    ${JSON.stringify(entry.name)}: {`;
      const outputLine = lines.findIndex((line) => line === marker);
      if (outputLine === -1) {
        continue;
      }
      this.ctx.sourceMap.push({
        outputLine,
        sourceUri: entry.sourceUri,
        sourceLine: entry.sourceLine,
        sourceChar: entry.sourceChar
      });
    }
  }

  @debug()
  emitEnumeration(enumNode: RosettaEnumeration): void {
    this.$defs[enumNode.name] = JsonSchemaNamespaceEmitter.emitEnumDef(enumNode);
    this.trackDefinitionSourceMap(enumNode);
  }

  @debug()
  emitTypeAlias(typeAlias: RosettaTypeAlias): void {
    const base = this.emitTypeAliasDef(typeAlias);
    const codes = projectCodeListForAlias(typeAlias, this.projectResources);
    this.$defs[typeAlias.name] = codes ? projectJsonCodeList(base, codes) : base;
    this.trackDefinitionSourceMap(typeAlias);
  }

  @debug()
  emitData(data: Data): void {
    this.$defs[data.name] = this.emitTypeDef(data);
    this.trackDefinitionSourceMap(data);
  }

  /**
   * Item 1: emit a `$defs/<Choice>` entry expressing the key-presence
   * discriminated union — same semantics as ts/zod's Choice surfaces
   * (exactly one option key present). The natural JSON Schema encoding is a
   * `oneOf` of single-required-key objects with `additionalProperties:
   * false`: each option's branch requires exactly its own key and forbids
   * every other property, so `oneOf` (which JSON Schema validates as
   * "matches EXACTLY one branch") naturally enforces "exactly one option
   * key present" — verified with real ajv (json-schema-choice.test.ts):
   * `{cash:...}` matches only the Cash branch (valid); `{cash:...,
   * commodity:...}` matches neither branch on its own since each branch's
   * `additionalProperties: false` rejects the OTHER option's key (invalid);
   * `{}` matches no branch, since each branch requires its own key
   * (invalid).
   */
  @debug()
  emitChoice(choice: Choice): void {
    this.$defs[choice.name] = this.emitChoiceDef(choice);
    this.trackDefinitionSourceMap(choice);
  }

  emitRule(rule: RosettaRule): void {
    const kind = rule.eligibility ? 'eligibility' : 'reporting';
    const inputRef = rule.input?.type?.ref;
    this.rulesMetadata[rule.name] = { kind, inputType: inputRef ? inputRef.name : 'unknown' };
  }

  finalize(): GeneratorOutput {
    const schema: Record<string, unknown> = {
      $schema: DRAFT_2020_12,
      $id: this.ctx.relativePath,
      title: this.model.namespace,
      $defs: this.$defs
    };
    if (Object.keys(this.rulesMetadata).length > 0) {
      schema['x-rune-rules'] = this.rulesMetadata;
    }
    const content = JsonSchemaNamespaceEmitter.serializeJson(schema) + '\n';
    this.flushSourceMap(content);
    return {
      relativePath: this.ctx.relativePath,
      content,
      sourceMap: this.ctx.sourceMap,
      diagnostics: this.ctx.diagnostics,
      funcs: []
    };
  }

  // ---------------------------------------------------------------------------
  // Private instance methods (ctx-taking helpers)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the item schema for a scalar type reference.
   * Returns a JSON Schema object for the base (non-array) type.
   *
   * Delegates to the shared `resolveTypeCallTarget` resolver (Task 1,
   * type-ref-resolver.ts), which transparently chases `RosettaTypeAlias`
   * chains — the hand-rolled chain this replaced had no `isRosettaTypeAlias`
   * branch, so a type-alias-typed attribute fell through every isRosettaBasicType/
   * isRosettaEnumeration/isData/isChoice check and landed on the generic
   * "Unknown type reference kind" diagnostic below instead of resolving.
   *
   * Diagnostic wording is preserved verbatim for every previously-working
   * case: `onPrimitive`'s "mapped is falsy" branch keeps the distinct
   * `'unmapped-builtin'` code (not routed through `reportUnresolvedReference`,
   * which is `'unresolved-ref'`-only); `onUnresolved` reproduces the two
   * distinct pre-migration wordings (truthy vs. falsy `refText`) exactly —
   * the falsy-refText branch deliberately does NOT go through
   * `reportUnresolvedReference`, since that helper always appends an
   * `; emitting …` suffix this case never had. The old "Unknown type
   * reference kind" message collapses into the truthy-refText `onUnresolved`
   * branch (case 1's wording) — untested pre-migration (no existing fixture
   * had a live-linked non-Basic/Enum/Data/Choice `typeCall.type.ref`), and
   * that scenario is now exactly the type-alias case this migration fixes.
   */
  private resolveItemSchema(attr: Attribute): object {
    return resolveProjectTypeCall(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (mapped) return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no JSON Schema mapping; emitting {}`
          });
          return {};
        },
        onEnum: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onData: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onChoice: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onUnresolved: (refText) => {
          if (refText) {
            this.reportUnresolvedReference(attr.name, refText, '{}');
          } else {
            this.ctx.diagnostics.push({
              severity: 'warning',
              code: 'unresolved-ref',
              message: `Attribute '${attr.name}' has an unresolved type reference`
            });
          }
          return {};
        }
      },
      this.fallbackSourceUri,
      this.projectResources,
      projectJsonCodeList
    );
  }

  /**
   * Emit the JSON Schema definition for a single Data type.
   * T094, T095.
   *
   * Item 1 adjacent-suspect fix (docs/superpowers/specs/2026-07-02-emitter-
   * crossns-hardening-design.md): the PRE-FIX composition for Data-extends-
   * Data was `allOf: [{$ref: parent}, {..., additionalProperties: false}]`,
   * with the PARENT's own `$defs` entry also self-closed via
   * `additionalProperties: false`. Under JSON Schema `allOf` semantics each
   * branch is evaluated against the FULL instance independently — so both
   * the parent branch (`$ref`'d, carrying the parent's own
   * `additionalProperties: false`) and the child's own branch reject any
   * property outside their OWN `properties`, including properties
   * contributed by the OTHER branch. A real parent+child instance (e.g.
   * `{name, breed}` for `Dog extends Animal`) was rejected on BOTH branches
   * — verified against real ajv in json-schema-data-extends-data-ajv-
   * probe.test.ts, confirming this was a real, pre-existing bug (not
   * speculative).
   *
   * Fix: branch-level schemas (both the parent's own def, when — and only
   * when — it has a local subtype, and the child's own-attributes branch)
   * never carry `additionalProperties: false`. Strictness is instead
   * enforced ONCE, at the composed level: `unevaluatedProperties: false`
   * sits alongside the `allOf`, which draft 2020-12 evaluates against
   * whatever properties were ALREADY evaluated by any branch (`$ref`'d or
   * inline) — exactly the semantics needed for "reject anything not
   * declared anywhere in the chain." A plain (non-extended) Data keeps
   * `additionalProperties: false` on its own def, UNLESS it is itself a
   * local supertype (`typesWithLocalSubtype`), in which case it too must
   * drop the closing keyword — the SAME `$defs` entry is `$ref`'d into
   * every subtype's `allOf`, and `additionalProperties: false` on a
   * `$ref`'d branch rejects the child's own properties the identical way
   * (verified: dropping only the immediate own-branch keyword while
   * leaving the parent's def self-closed still fails ajv).
   *
   * Multi-level chains (`Poodle extends Dog extends Animal`): ONLY the
   * outermost (leaf, no further local subtype) composed node may carry
   * `unevaluatedProperties: false` — verified with real ajv that a
   * `$ref`'d schema which ITSELF already closes with its own
   * `unevaluatedProperties: false` does not let that annotation propagate
   * through to an outer `allOf`'s `unevaluatedProperties` evaluation
   * (`Dog`'s own `unevaluatedProperties: false`, evaluated in isolation
   * against the full `Poodle` instance, rejects `Poodle`'s own `size`
   * property the same way the pre-fix `additionalProperties: false` did).
   * So `Dog` (itself extended by `Poodle`) must NOT self-close even in the
   * `allOf` branch; only `Poodle` (the leaf) does — same
   * `typesWithLocalSubtype` check as the plain-Data branch above.
   *
   * Same-namespace subtype detection only (see `typesWithLocalSubtype`'s
   * doc comment) — a supertype extended solely from another namespace is
   * not detected here and keeps its own closing keyword; this mirrors the
   * emitter's pre-existing cross-namespace `$ref` limitation and is out of
   * scope per the design doc's non-goals.
   */
  private emitTypeDef(data: Data): object {
    const required: string[] = [];
    const properties: Record<string, object> = {};

    for (const attr of data.attributes) {
      const card = attr.card;
      const { lower, upper } = decodeCardinality(card);

      const itemSchema = this.resolveItemSchema(attr);
      const attrSchema = JsonSchemaNamespaceEmitter.applyCardinality(card, itemSchema);

      properties[attr.name] = attrSchema;

      if (lower === 1 && upper === 1) {
        required.push(attr.name);
      }
    }

    // Collect condition metadata (x-rune-conditions extension).
    const conditions = data.conditions ?? [];
    const conditionMeta = conditions
      .filter((c) => c.name != null)
      .map((c) => ({
        name: c.name,
        kind: 'condition'
      }));

    if (data.superType?.ref) {
      const parentName = data.superType.ref.name;
      const parentRef: object = { $ref: `#/$defs/${parentName}` };

      const ownSchema: Record<string, unknown> = {
        type: 'object',
        properties
      };
      if (required.length > 0) ownSchema['required'] = required;
      if (conditionMeta.length > 0) ownSchema['x-rune-conditions'] = conditionMeta;

      const composed: Record<string, unknown> = { allOf: [parentRef, ownSchema] };
      if (!this.typesWithLocalSubtype.has(data.name)) {
        composed['unevaluatedProperties'] = false;
      }
      return composed;
    }

    const def: Record<string, unknown> = {
      type: 'object',
      properties
    };
    if (!this.typesWithLocalSubtype.has(data.name)) {
      def['additionalProperties'] = false;
    }

    if (required.length > 0) def['required'] = required;
    if (conditionMeta.length > 0) def['x-rune-conditions'] = conditionMeta;

    return def;
  }

  /**
   * Emit the JSON Schema definition for a `choice` declaration: a
   * key-presence discriminated union expressed as `oneOf` of
   * single-required-key option branches. Mirrors ts/zod's Choice-union
   * semantics (exactly one option key present) — NOT a literal-tag
   * `discriminator`, since CDM Choice instances have no `$type`-like tag
   * field.
   *
   * Each branch requires exactly its own option key
   * (`choiceOptionFieldName`, the shared camelCase rule — same naming ts's
   * `emitChoiceTypeDeclaration` and zod's `emitChoiceSchema` already use)
   * and, UNLESS this Choice has a local Data subtype
   * (`typesWithLocalSubtype`), forbids every other property via
   * `additionalProperties: false` — `oneOf` validates "matches EXACTLY one
   * branch", so a payload with only its own option key matches ONE branch
   * (valid); a payload with two option keys fails EVERY branch (each
   * branch's own key requirement is met by at most one of them, and the
   * OTHER key is rejected by that branch's `additionalProperties: false`)
   * (invalid); an empty payload fails every branch's `required` (invalid).
   * Verified against real ajv (json-schema-choice.test.ts).
   *
   * When a Data extends this Choice (`emitTypeDef`'s `allOf` composition,
   * derivation not decomposition — same design principle as #365/W2's
   * ts/zod Choice surfaces), the branches must NOT self-close with
   * `additionalProperties: false` — verified with real ajv that a
   * `$ref`'d `oneOf` branch which closes with its own
   * `additionalProperties: false` rejects properties contributed by the
   * EXTENDING Data's own attributes (the identical `allOf`-branch-
   * isolation bug `emitTypeDef`'s doc comment documents for plain
   * Data-extends-Data). The extending Data's own composed node instead
   * carries `unevaluatedProperties: false` once, at the outermost level —
   * so a Choice with a local subtype trades its OWN standalone strictness
   * for correct composition, the same recorded trade-off as an extended
   * Data (`typesWithLocalSubtype`'s doc comment).
   */
  private emitChoiceDef(choice: Choice): object {
    const closeBranches = !this.typesWithLocalSubtype.has(choice.name);
    const branches = choice.attributes.map((option) => {
      const optionTypeRef = option.typeCall?.type;
      const optionTypeName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? 'unknown';
      const fieldName = choiceOptionFieldName(optionTypeName);
      const optionSchema: object = this.ctx.builtinTypeMap[optionTypeName] ?? { $ref: `#/$defs/${optionTypeName}` };

      const branch: Record<string, unknown> = {
        type: 'object',
        properties: { [fieldName]: optionSchema },
        required: [fieldName]
      };
      if (closeBranches) branch['additionalProperties'] = false;
      return branch;
    });

    if (branches.length === 0) {
      return { not: {} };
    }

    return { oneOf: branches };
  }

  /**
   * Emit the JSON Schema definition for a type alias's own right-hand side
   * (`typeAlias A: B` — what does `B` resolve to).
   *
   * Delegates to the shared `resolveTypeCallTarget` resolver (Task 1),
   * mirroring zod-emitter.ts's `emitTypeAliasSchema` migration. Before this
   * fix, this method hand-rolled its own isRosettaBasicType/isRosettaEnumeration/
   * isData/refText chain with no `isRosettaTypeAlias` branch and no
   * alias-to-alias chasing — `typeAlias A: B` where `B` was itself
   * `typeAlias B: C` silently fell through to `{ type: 'string' }`. It also
   * hand-duplicated the same builtin-type-name→schema literal twice (once
   * for the live-linked `typeRef` branch, once for the `refText` fallback
   * branch) — collapsed here into one `TYPE_ALIAS_BUILTIN_MAP` constant,
   * reused by `onPrimitive`.
   *
   * `onUnresolved` preserves the pre-migration silent fallback (no
   * diagnostic push) verbatim — same shape as zod-emitter's
   * `onUnresolved: () => 'z.unknown()'`.
   *
   * `onPrimitive` reuses `this.ctx.builtinTypeMap` (the SAME canonical
   * profile map `resolveItemSchema`'s `onPrimitive` already uses) instead of
   * either of the two hand-duplicated inline literals this replaces — both
   * were missing `pattern`/`productType`/`eventType`/`calculation`, which
   * `builtinTypeMap` already carries.
   */
  private emitTypeAliasDef(alias: RosettaTypeAlias): object {
    return resolveProjectTypeCall(
      alias.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => this.ctx.builtinTypeMap[basicTypeName] ?? { type: 'string' },
        onEnum: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onData: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onChoice: (node) => ({ $ref: `#/$defs/${node.name}` }),
        onUnresolved: () => ({ type: 'string' })
      },
      this.fallbackSourceUri,
      this.projectResources,
      projectJsonCodeList
    );
  }

  // ---------------------------------------------------------------------------
  // Private static helpers (pure utilities, no ctx)
  // ---------------------------------------------------------------------------

  /**
   * Apply cardinality encoding to a base item schema.
   * Returns the JSON Schema representation of the attribute type + cardinality.
   * FR-019 / T095.
   *
   * Cardinality map:
   *   (1..1) → base item schema (no wrapping); field listed in "required"
   *   (0..1) → base item schema (no wrapping); field NOT in "required"
   *   (0..*) → { "type": "array", "items": itemSchema }
   *   (1..*) → { "type": "array", "items": itemSchema, "minItems": 1 }
   *   (n..m) → { "type": "array", "items": itemSchema, "minItems": n, "maxItems": m }
   *   (n..n) n>1 → { "type": "array", "items": itemSchema, "minItems": n, "maxItems": n }
   */
  private static applyCardinality(card: RosettaCardinality, itemSchema: object): object {
    const { lower, upper } = decodeCardinality(card);

    // Scalar forms: (1..1) or (0..1)
    if (upper !== null && upper <= 1) {
      return itemSchema;
    }

    const arraySchema: Record<string, unknown> = {
      type: 'array',
      items: itemSchema
    };

    if (upper === null) {
      if (lower > 0) {
        arraySchema['minItems'] = lower;
      }
    } else {
      if (lower > 0) arraySchema['minItems'] = lower;
      arraySchema['maxItems'] = upper;
    }

    return arraySchema;
  }

  /**
   * Emit the JSON Schema definition for an enumeration.
   * T095.
   *
   * Emits: `{ "type": "string", "enum": ["Val1", "Val2", ...] }`
   *
   * Note: Display-name maps are not standardized in JSON Schema. Enum display names
   * are documented as `x-rune-enum-display` extension entries so consumers know they
   * exist, but they are not added to the `"enum"` array itself.
   */
  private static emitEnumDef(enumNode: RosettaEnumeration): object {
    const memberNames = enumNode.enumValues.map((v) => v.name);

    const def: Record<string, unknown> = {
      type: 'string',
      enum: memberNames
    };

    const hasDisplayNames = enumNode.enumValues.some((v) => v.display != null);
    if (hasDisplayNames) {
      const displayMap: Record<string, string> = {};
      for (const v of enumNode.enumValues) {
        displayMap[v.name] = v.display ?? v.name;
      }
      def['x-rune-enum-display'] = displayMap;
    }

    return def;
  }

  /**
   * oxfmt-compatible JSON serializer.
   *
   * oxfmt collapses short arrays onto a single line when they fit within
   * the print width (100 chars). We replicate this behaviour so that
   * committed `expected.schema.json` fixture files are byte-identical to the
   * formatter's output. Specifically:
   *   - Arrays of primitives (strings, numbers, booleans) that fit on one
   *     line within the given indent level are serialised inline.
   *   - Arrays of objects are always expanded.
   *   - Objects are always expanded (one key per line).
   *
   * @param value - The JSON value to serialise.
   * @param indent - Current indent level (0 = top level).
   * @param printWidth - Maximum column width (default 100, matching oxfmt).
   */
  private static serializeJson(value: unknown, indent: number = 0, printWidth: number = 100): string {
    const spaces = '  '.repeat(indent);
    const innerSpaces = '  '.repeat(indent + 1);

    if (value === null) return 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';

      const allPrimitives = value.every(
        (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
      );
      if (allPrimitives) {
        const compact =
          '[' + value.map((v) => JsonSchemaNamespaceEmitter.serializeJson(v, 0, printWidth)).join(', ') + ']';
        const lineLength = spaces.length + compact.length;
        if (lineLength <= printWidth) {
          return compact;
        }
      }

      const items = value.map((v) => innerSpaces + JsonSchemaNamespaceEmitter.serializeJson(v, indent + 1, printWidth));
      return '[\n' + items.join(',\n') + '\n' + spaces + ']';
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';

      const entries = keys.map(
        (k) =>
          innerSpaces +
          JSON.stringify(k) +
          ': ' +
          JsonSchemaNamespaceEmitter.serializeJson((value as Record<string, unknown>)[k], indent + 1, printWidth)
      );
      return '{\n' + entries.join(',\n') + '\n' + spaces + '}';
    }

    return JSON.stringify(value);
  }
}
