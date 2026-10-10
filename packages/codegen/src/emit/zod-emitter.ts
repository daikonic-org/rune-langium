// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Zod target emitter for the Rune code generator.
 *
 * Entry point: emitNamespace(model, options) → GeneratorOutput
 *
 * FR-002–FR-009, FR-021 (inline helpers), FR-022 (deterministic output).
 */

import { TEMPORAL_CONVERSION_PATTERNS } from '../expr/temporal-conversions.js';
import {
  getEnumValues,
  getElementNamespace,
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
  type RosettaExternalFunction,
  type TypeCall
} from '@rune-langium/core';
import { resolveImportPath, type NamespaceRegistry } from './namespace-registry.js';
import { emitNamespaceWithContract, type NamespaceEmitterOptions } from './namespace-emitter.js';
import {
  BaseNamespaceEmitter,
  decodeCardinality,
  buildConditionTranspilerContext,
  activeConditions,
  mergeProfileTypeMaps,
  buildReportRulesLines,
  buildCrossNsImportLines,
  choiceOptionFieldName
} from './base-namespace-emitter.js';
import { getTargetRelativePath, type NamespaceWalkResult } from './namespace-walker.js';
import { resolveTypeCallTarget, type TypeIndexEntry, type TypeIndexLookup } from './type-ref-resolver.js';
import { fieldMetadataKind, metadataObjectType } from '../expr/metadata-runtime.js';
import { zodProfile } from './zod-profile.js';
import { typescriptProfile } from './typescript-profile.js';
import { debug } from '../instrument.js';
import type { GeneratorOptions, GeneratorOutput, SourceMapEntry, GeneratorDiagnostic } from '../types.js';
import { RUNTIME_HELPER_SOURCE, buildRuntimeHelperImportLine } from '../helpers.js';
import { RUNE_EXTEND_CHOICE_HELPER_SOURCE } from './zod-runtime-helpers.js';
import {
  transpileCondition,
  transpileExpression,
  buildConditionMessage,
  type ExpressionTranspilerContext
} from '../expr/transpiler.js';

/**
 * Internal emission context threaded through the emitter for one namespace.
 * FR-006 (lazy types), FR-007 (topo order), FR-009 (reserved word quoting).
 */
interface EmissionContext {
  /** The target being emitted (always 'zod' for this emitter). */
  target: 'zod';
  /** Sorted emit order for types in this namespace (topo-sorted). */
  emitOrder: readonly string[];
  /** Type names that require z.lazy() wrapping due to cycles. */
  lazyTypes: ReadonlySet<string>;
  /** Source-map entries collected during emission. */
  sourceMap: SourceMapEntry[];
  /** Generator-time diagnostics accumulated during emission. */
  diagnostics: GeneratorDiagnostic[];
  /** The namespace string (e.g., "cdm.base.math"). */
  namespace: string;
  /** All Data nodes keyed by name for lookup. */
  dataByName: ReadonlyMap<string, Data>;
  /** All Choice nodes keyed by name for lookup (W2). */
  choiceByName: ReadonlyMap<string, Choice>;
  /** All Enumeration nodes keyed by name for lookup. */
  enumByName: ReadonlyMap<string, RosettaEnumeration>;
  /** All RosettaTypeAlias nodes keyed by name for lookup. */
  typeAliasByName: ReadonlyMap<string, RosettaTypeAlias>;
  /** All RosettaRule nodes keyed by name for lookup. */
  rulesByName: ReadonlyMap<string, RosettaRule>;
  /** All RosettaReport nodes keyed by name for lookup. */
  reportsByName: ReadonlyMap<string, RosettaReport>;
  /** All Annotation nodes keyed by name for lookup. */
  annotationsByName: ReadonlyMap<string, Annotation>;
  /** All RosettaExternalFunction nodes keyed by name for lookup. */
  libraryFuncsByName: ReadonlyMap<string, RosettaExternalFunction>;
  /** Namespace registry for cross-namespace lookups. */
  registry: NamespaceRegistry;
  /** Merged builtin type map from the profile (basicTypeMap ∪ recordTypeMap ∪ typeAliasMap). */
  builtinTypeMap: Readonly<Record<string, string>>;
}

/**
 * TypeScript/JavaScript reserved words that must be quoted when used as property keys.
 * FR-009.
 */
const _RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

const ZOD_BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = mergeProfileTypeMaps(zodProfile) as Record<
  string,
  string
>;

/**
 * Builtin → TypeScript type map for the interface declarations the Zod
 * emitter emits ALONGSIDE each schema. These must match what the companion
 * Zod schema *infers*, not the pure-TS target's representation.
 *
 * Critical for the temporal builtins: the Zod schemas use `z.iso.date()` /
 * `z.iso.time()` / `z.iso.datetime()`, all of which infer `string`. The
 * pure-TS target (ts-emitter / typescriptProfile) maps those to `Temporal.*`
 * because it has no schema to stay consistent with — but if the Zod emitter
 * used `Temporal.*` here, the emitted `interface` would diverge from
 * `z.infer<typeof Schema>` (and break cyclic `z.lazy()` interface types that
 * annotate the schema). So override the four temporal builtins to `string`.
 * Codex P1 on PR #224.
 */
const ZOD_TS_TYPE_MAP: Readonly<Record<string, string>> = {
  ...typescriptProfile.basicTypeMap,
  ...typescriptProfile.recordTypeMap,
  ...typescriptProfile.typeAliasMap,
  time: 'string',
  date: 'string',
  dateTime: 'string',
  zonedDateTime: 'string'
};

/**
 * Wrap a bare `ReadonlyMap<string, N>` (this emitter's own `EmissionContext`
 * lookup maps) into the `{node, sourceUri}`-entry shape `resolveTypeCallTarget`
 * (Task 1, type-ref-resolver.ts) requires. Every entry shares one fallback
 * `sourceUri` — this emitter never consumes the per-entry `sourceUri` in its
 * own rendering (only `preview-schema.ts`'s later migration needs real
 * per-entry source URIs for recursive structural expansion), so a single
 * shared value for the whole namespace is correct here.
 */
function wrapTypeIndexEntries<N>(
  map: ReadonlyMap<string, N>,
  sourceUri: string
): ReadonlyMap<string, TypeIndexEntry<N>> {
  const wrapped = new Map<string, TypeIndexEntry<N>>();
  for (const [name, node] of map) {
    wrapped.set(name, { node, sourceUri });
  }
  return wrapped;
}

/**
 * Adapt this emitter's `EmissionContext` (bare unwrapped lookup maps) to the
 * `TypeIndexLookup` shape `resolveTypeCallTarget` expects. Built once per
 * namespace emission (the underlying maps are immutable for the lifetime of
 * one `ZodNamespaceEmitter` instance).
 */
function toTypeIndexLookup(ctx: EmissionContext): TypeIndexLookup {
  const sourceUri = ctx.namespace;
  return {
    enumByName: wrapTypeIndexEntries(ctx.enumByName, sourceUri),
    dataByName: wrapTypeIndexEntries(ctx.dataByName, sourceUri),
    choiceByName: wrapTypeIndexEntries(ctx.choiceByName, sourceUri),
    typeAliasByName: wrapTypeIndexEntries(ctx.typeAliasByName, sourceUri)
  };
}

function buildEmissionContext(
  model: NamespaceWalkResult,
  registry: NamespaceRegistry,
  diagnostics: GeneratorDiagnostic[]
): EmissionContext {
  return {
    target: 'zod',
    emitOrder: model.emitOrder,
    lazyTypes: model.cyclicTypes,
    sourceMap: [],
    diagnostics,
    namespace: model.namespace,
    dataByName: model.dataByName,
    choiceByName: model.choiceByName,
    enumByName: model.enumByName,
    typeAliasByName: model.typeAliasByName,
    rulesByName: model.rulesByName,
    reportsByName: model.reportsByName,
    annotationsByName: model.annotationsByName,
    libraryFuncsByName: model.libraryFuncsByName,
    registry,
    builtinTypeMap: ZOD_BUILTIN_TYPE_MAP
  };
}

/**
 * Emit one namespace as a single .zod.ts file.
 *
 * Entry point for the Zod emitter.
 * FR-001 (one file per namespace), FR-022 (deterministic output).
 */
export function emitNamespace(
  model: NamespaceWalkResult,
  options: GeneratorOptions,
  registry: NamespaceRegistry = { namespaces: new Map() }
): GeneratorOutput {
  return emitNamespaceWithContract(model, options, registry, ZodNamespaceEmitter);
}

export class ZodNamespaceEmitter extends BaseNamespaceEmitter {
  private readonly ctx: EmissionContext;
  private readonly typeIndex: TypeIndexLookup;
  private readonly sections: string[] = [];
  private readonly functionInputs: boolean;

  constructor(
    model: NamespaceWalkResult,
    options: NamespaceEmitterOptions,
    registry: NamespaceRegistry = { namespaces: new Map() }
  ) {
    super(model, options, registry);
    this.functionInputs = options.functionInputs ?? false;
    this.ctx = buildEmissionContext(model, registry, this.diagnostics);
    if (this.functionInputs) {
      const builtinTypeMap = { ...this.ctx.builtinTypeMap };
      for (const [kind, temporalType] of Object.entries(typescriptProfile.recordTypeMap).concat([
        ['time', typescriptProfile.basicTypeMap.time!]
      ])) {
        const parse = kind === 'zonedDateTime' ? 'rune.parseZonedDateTime' : `${temporalType}.from`;
        builtinTypeMap[kind] =
          `z.string().regex(new RegExp(${JSON.stringify(TEMPORAL_CONVERSION_PATTERNS[kind as keyof typeof TEMPORAL_CONVERSION_PATTERNS])}))` +
          `.transform((value, ctx) => { try { return ${parse}(value); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid ${kind}' }); return z.NEVER; } })`;
      }
      this.ctx = { ...this.ctx, builtinTypeMap };
    }
    this.typeIndex = toTypeIndexLookup(this.ctx);
  }

  emitHeader(): void {
    this.sections.push(this.buildFileHeader());
  }

  emitCrossNamespaceImports(): void {
    const crossNsImports = this.collectCrossNamespaceImports();
    if (crossNsImports.length > 0) {
      this.sections.push(crossNsImports.join('\n'));
      this.sections.push('');
    }
  }

  @debug()
  emitEnumeration(enumNode: RosettaEnumeration): void {
    this.sections.push(this.emitEnum(enumNode));
    this.sections.push('');
  }

  @debug()
  emitTypeAlias(typeAlias: RosettaTypeAlias): void {
    this.sections.push('');
    this.sections.push(this.emitTypeAliasSchema(typeAlias));
  }

  emitDataPrelude(): void {
    const cyclicDataNames = Array.from(this.ctx.lazyTypes)
      .filter((name) => this.ctx.dataByName.has(name))
      .sort();
    if (cyclicDataNames.length === 0) return;
    for (const typeName of cyclicDataNames) {
      this.sections.push(this.emitCyclicInterface(this.ctx.dataByName.get(typeName)!));
    }
    this.sections.push('');
  }

  @debug()
  emitData(data: Data): void {
    this.sections.push(this.emitTypeSchema(data));
    const alias = this.emitInferAlias(data);
    if (alias) this.sections.push(alias);
    this.sections.push('');
  }

  /**
   * W2: emit a `choice` declaration as `z.union([...])` of per-option
   * `z.object` shapes (key-presence discrimination — `z.discriminatedUnion`
   * doesn't apply, there is no literal tag field), mirroring emitData's
   * schema + z.infer-alias pairing.
   */
  @debug()
  emitChoice(choice: Choice): void {
    this.sections.push(this.emitChoiceSchema(choice));
    this.sections.push(`export type ${choice.name} = z.infer<typeof ${choice.name}Schema>;`);
    this.sections.push('');
  }

  emitRule(rule: RosettaRule): void {
    const result = this.emitRuleValidator(rule);
    if (result) {
      this.sections.push('');
      this.sections.push(result);
    }
  }

  emitReportMetadata(): void {
    const reportMeta = this.buildReportMetadataText();
    if (reportMeta !== '') {
      this.sections.push('');
      this.sections.push(reportMeta);
    }
  }

  finalize(): GeneratorOutput {
    while (this.sections.length > 0 && this.sections[this.sections.length - 1] === '') {
      this.sections.pop();
    }
    return {
      relativePath: getTargetRelativePath(this.model.namespace, 'zod'),
      content: this.sections.join('\n') + '\n',
      sourceMap: this.ctx.sourceMap,
      diagnostics: this.ctx.diagnostics,
      funcs: []
    };
  }

  // ---------------------------------------------------------------------------
  // Private instance methods (ctx-taking helpers moved in)
  // ---------------------------------------------------------------------------

  /**
   * Collect cross-namespace import statements needed for the schemas and type aliases
   * defined in this emission context.
   *
   * Walks all Data superType references and attribute type references, plus
   * TypeAlias type references. Any resolved reference whose namespace differs
   * from `ctx.namespace` is recorded and emitted as an ES import statement
   * importing Schema names (e.g. FooSchema) from the corresponding .zod.js file.
   */
  private collectCrossNamespaceImports(): string[] {
    const imports = new Map<string, Set<string>>(); // namespace -> schema symbol names

    const trackRef = (typeRef: unknown, schemaName: string): void => {
      if (!typeRef || typeof typeRef !== 'object') return;
      const ns = getElementNamespace(typeRef);
      if (!ns || ns === this.ctx.namespace) return;

      let symbols = imports.get(ns);
      if (!symbols) {
        symbols = new Set();
        imports.set(ns, symbols);
      }
      symbols.add(schemaName);
    };

    // Route every import-candidate scan through the same `resolveTypeCallTarget`
    // dispatch the VALUE-emitting code uses (resolveTypeExpr/emitTypeAliasSchema/
    // emitChoiceSchema), so import-tracking can never drift from value-emission
    // again: a `TypeCall` that resolves through a RosettaTypeAlias chain (any
    // number of hops) to a cross-namespace Data/Enum/Choice is tracked against
    // the TERMINAL resolved node, not the immediate (possibly same-namespace
    // alias) reference.
    const trackTypeCallImport = (typeCall: TypeCall | undefined): void => {
      resolveTypeCallTarget(
        typeCall,
        this.typeIndex,
        {
          onPrimitive: () => undefined,
          onEnum: (node) => trackRef(node, `${node.name}Schema`),
          onData: (node) => trackRef(node, `${node.name}Schema`),
          onChoice: (node) => trackRef(node, `${node.name}Schema`),
          onUnresolved: () => undefined
        },
        this.ctx.namespace
      );
    };

    // Check data type inheritance and attribute references
    for (const data of this.ctx.dataByName.values()) {
      // Check superType
      const parentRef = data.superType?.ref;
      if (parentRef) {
        trackRef(parentRef, `${parentRef.name}Schema`);
      }
      // Multi-level Data-extends-Choice (buildSuperTypeSchemaExpr's
      // choice-ancestor branch): the emitted schema is ONE
      // `runeExtendChoice(<ChoiceAncestor>Schema, {...})` call that (a)
      // references the Choice ANCESTOR's schema — which sits 2+ links up
      // the chain, possibly in a namespace the immediate-parent tracking
      // above never sees — and (b) folds the own attributes of the
      // immediate Data parent and every further intermediate INLINE into
      // THIS file (buildRuneExtendChoiceExpr's `[data, superRef,
      // ...intermediates]` fold), so those attributes' schema refs are
      // emitted here too and must be imported relative to THIS namespace,
      // even though the attribute-tracking loop below only ever iterates
      // this namespace's own data. (The DIRECT Data-extends-Choice case
      // needs neither: the immediate parentRef IS the Choice, covered by
      // the unconditional trackRef above, and no foreign attributes are
      // folded.) Reuses findChoiceAncestor — same walk, same cycle guard.
      if (parentRef && isData(parentRef)) {
        const choiceAncestor = ZodNamespaceEmitter.findChoiceAncestor(parentRef);
        if (choiceAncestor) {
          trackRef(choiceAncestor.choice, `${choiceAncestor.choice.name}Schema`);
          // Routed through trackTypeCallImport (not a direct `.typeCall?.type?.ref`
          // check) so an inlined ancestor's alias-typed attribute is tracked
          // against its TERMINAL resolved target too — matches the ordinary
          // attribute-tracking loop below, which already chases alias chains.
          for (const link of [parentRef, ...choiceAncestor.intermediates]) {
            for (const attr of link.attributes) {
              trackTypeCallImport(attr.typeCall);
            }
          }
        }
      }
      // Check attribute types — chases RosettaTypeAlias chains via
      // resolveTypeCallTarget so an attribute typed via an alias that
      // resolves to a cross-namespace Data/Enum/Choice is tracked against
      // the terminal target, matching resolveTypeExpr's value emission.
      for (const attr of data.attributes) {
        trackTypeCallImport(attr.typeCall);
      }
    }

    // Check type alias references — chases the alias's own RHS through any
    // further alias links via resolveTypeCallTarget (a 2+ hop chain), matching
    // emitTypeAliasSchema's value emission, instead of only tracking the
    // alias's immediate direct ref (which for a 2+ hop chain would track the
    // wrong, intermediate alias name).
    for (const alias of this.ctx.typeAliasByName.values()) {
      trackTypeCallImport(alias.typeCall);
    }

    // Check Choice option type references — mirrors the attribute loop above;
    // previously never scanned at all, so a Choice option typed as (or via an
    // alias to) a cross-namespace Data/Enum/Choice produced a correct value
    // reference (emitChoiceSchema) but no import line.
    for (const choice of this.ctx.choiceByName.values()) {
      for (const option of choice.attributes) {
        trackTypeCallImport(option.typeCall);
      }
    }

    return buildCrossNsImportLines(imports, this.ctx.namespace, this.ctx.registry, '.zod.js');
  }

  /**
   * Reference a Data/Choice schema by name from within `ownerName`'s own
   * declaration. When `name` is itself cyclic (`this.ctx.lazyTypes`), a bare
   * `${name}Schema` reference can be emitted BEFORE that `const` is
   * declared — `topoSort` always places cyclic types after every non-cyclic
   * one, regardless of whether a non-cyclic type depends on one of them —
   * throwing a TDZ `ReferenceError` at evaluation time. `z.lazy(() => ...)`
   * defers evaluation past module-initialization time, making the
   * reference safe regardless of emit order.
   *
   * Only wraps when `ownerName` itself is NOT cyclic: a reference from
   * WITHIN a cyclic type's own body (including a genuine self-reference, or
   * a reference between two members of the same mutual cycle — A and B are
   * each individually cyclic) is already safe, since `ownerName`'s own
   * declaration is already inside its own `z.lazy()` closure — confirmed by
   * `test/us1-structural.test.ts`'s byte-identical golden fixture for
   * mutual cycles and self-references, which asserts the ORIGINAL
   * unwrapped form for exactly this case.
   */
  private schemaRefExpr(name: string, ownerName: string): string {
    return this.ctx.lazyTypes.has(name) && !this.ctx.lazyTypes.has(ownerName)
      ? `z.lazy(() => ${name}Schema)`
      : `${name}Schema`;
  }

  /**
   * Resolve the Zod type expression for an attribute's type reference.
   * Handles built-ins (RosettaBasicType), Data (object refs), Enumerations.
   *
   * Falls back to $refText-based lookup for unresolved references (e.g., when
   * only a single file is parsed without the full workspace — common for fixtures).
   */
  private resolveTypeExpr(attr: Attribute, ownerName: string): string {
    return resolveTypeCallTarget(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (typeof mapped === 'string') return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no Zod mapping; emitting z.unknown()`
          });
          return 'z.unknown()';
        },
        onEnum: (node) => `${node.name}Schema`,
        onData: (node) => this.schemaRefExpr(node.name, ownerName),
        onChoice: (node) => this.schemaRefExpr(node.name, ownerName),
        onUnresolved: (refText) => {
          if (refText) {
            // Unknown but named — emit schema reference optimistically
            // (matches the pre-migration wording exactly).
            this.reportUnresolvedReference(attr.name, refText, 'optimistic schema reference');
            return `${refText}Schema`;
          }
          // Truly anonymous unresolved reference
          this.reportUnresolvedReference(attr.name, undefined, 'z.unknown()');
          return 'z.unknown()';
        }
      },
      this.ctx.namespace
    );
  }

  // ---------------------------------------------------------------------------
  // W2: Choice emission
  // ---------------------------------------------------------------------------

  /**
   * Emit `export const <ChoiceName>Schema = z.union([z.object({ opt: OptSchema }), ...]);`
   * — key-presence discrimination via z.union of single-key object shapes,
   * mirroring emitObjectBody's per-attribute z.object conventions.
   */
  private emitChoiceSchema(choice: Choice): string {
    const name = choice.name;
    const schemaName = `${name}Schema`;

    const optionSchemas = choice.attributes.map((option) => {
      // FIELD KEY: derived from the DIRECT/immediate reference's name, never
      // the alias-chased terminal target — established convention (matches
      // preview-schema.ts's buildChoiceOptionField); an option typed via a
      // type alias keeps its author-given key (e.g. `myAlias`), not the
      // alias's resolved target's name (e.g. `someData`).
      const optionTypeRef = option.typeCall?.type;
      const optionTypeName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? 'unknown';
      const fieldName = choiceOptionFieldName(optionTypeName);
      // SCHEMA/TYPE REFERENCE: chases through any RosettaTypeAlias chain via
      // resolveTypeCallTarget, same as resolveTypeExpr resolves an attribute's
      // type reference.
      const optionSchemaExpr = resolveTypeCallTarget(
        option.typeCall,
        this.typeIndex,
        {
          onPrimitive: (basicTypeName) => this.ctx.builtinTypeMap[basicTypeName] ?? `${basicTypeName}Schema`,
          onEnum: (node) => `${node.name}Schema`,
          // '' as owner, NOT `choice.name`: unlike a Data's own declaration
          // (which gets an outer z.lazy() wrap when cyclic, per
          // emitTypeSchema's isLazy branch), a Choice's own declaration
          // (below) is NEVER itself wrapped — so a reference here always
          // needs wrapping when its target is cyclic, with no "already
          // inside my own lazy closure" exemption to apply. '' can never
          // match a real type name in lazyTypes.
          onData: (node) => this.schemaRefExpr(node.name, ''),
          onChoice: (node) => this.schemaRefExpr(node.name, ''),
          // Mirrors resolveTypeExpr's onUnresolved (attribute side): an
          // unresolved Choice-option reference previously fell back to a
          // guessed schema name with no diagnostic at all, unlike the
          // attribute-reference case just above. Label follows
          // xsd-emitter.ts's existing `${choice.name} option` convention for
          // the same non-attribute (ChoiceOption has no `.name`) fallback.
          onUnresolved: (refText) => {
            const label = `${choice.name} option`;
            if (refText) {
              this.reportUnresolvedReference(label, refText, `${refText}Schema`);
              return `${refText}Schema`;
            }
            this.reportUnresolvedReference(label, undefined, 'unknownSchema');
            return 'unknownSchema';
          }
        },
        this.ctx.namespace
      );
      // .strict(): non-strict objects allow unknown keys, so {cash, commodity}
      // would satisfy the first arm — strict arms make multi-option objects
      // fail every arm, enforcing the exactly-one-of Choice semantics.
      return `z.strictObject({ ${fieldName}: ${optionSchemaExpr} })`;
    });

    if (optionSchemas.length === 0) {
      return `export const ${schemaName} = z.never();`;
    }

    return `export const ${schemaName} = z.union([${optionSchemas.join(', ')}]);`;
  }

  /**
   * Emit a single attribute as a Zod object property entry.
   * FR-003 (cardinality), FR-009 (reserved-word quoting).
   */
  private emitAttribute(attr: Attribute, ownerName: string): string {
    let baseTypeExpr = this.resolveTypeExpr(attr, ownerName);
    const kind = this.functionInputs ? fieldMetadataKind(attr) : undefined;
    if (kind) {
      const metadata = 'z.record(z.string(), z.unknown())';
      baseTypeExpr =
        kind === 'field'
          ? `z.object({ value: ${baseTypeExpr}, meta: ${metadata} })`
          : `z.object({ value: ${baseTypeExpr}.optional(), meta: ${metadata}.optional(), reference: z.object({ reference: z.unknown().optional(), scope: z.unknown().optional(), pointsTo: z.unknown().optional() }).optional(), externalReference: z.unknown().optional(), globalReference: z.unknown().optional() })`;
    }
    const card = attr.card;
    let zodExpr = ZodNamespaceEmitter.applyCardinality(card, baseTypeExpr);
    if (this.functionInputs && card.inf === 0 && (card.unbounded || (card.sup ?? 1) > 1)) {
      zodExpr += '.optional()';
    }
    const key = ZodNamespaceEmitter.quoteKey(attr.name);
    return `  ${key}: ${zodExpr}`;
  }

  /**
   * Emit a z.object({...}) body for a data type's own attributes (not inherited).
   * Returns the Zod expression for the body (without the schema name assignment).
   */
  private emitObjectBody(data: Data): string {
    if (data.attributes.length === 0) {
      return 'z.object({})'; // FR-008
    }
    const attrs = data.attributes.map((attr) => this.emitAttribute(attr, data.name));
    // Join with comma+newline between entries; no trailing comma (linter rule: trailingComma: "none")
    return `z.object({\n${attrs.join(',\n')}\n})`;
  }

  /**
   * Walk UP a Data's `extends` chain (NOT including `data` itself) and
   * report whether it bottoms out at a Choice, and if so which Data nodes
   * sit between `data` and that Choice (nearest-first).
   *
   * Needed because a Data parent that is ITSELF Choice-derived emits as
   * `runeExtendChoice(...)`, whose result is a `z.union(...)` — like the
   * Choice itself, a union has no `.extend()` method. So `${parentSchema}
   * .extend({...})` is only safe when the immediate parent's OWN schema is
   * a plain `z.object`/`.extend()` chain, i.e. when the parent's chain does
   * NOT reach a Choice. Multi-level `Data extends Data extends Choice`
   * (spec's Semantics: "extras accumulate down to the Choice ancestor")
   * must instead emit ONE `runeExtendChoice(<ChoiceAncestor>Schema, {...})`
   * call at the point where the chain first reaches the Choice, folding in
   * every intermediate Data's own attributes — not a chain of `.extend()`
   * calls on top of a union result.
   *
   * A visited-set guards a malformed cyclic `extends` chain, mirroring
   * `buildAttributeTypesMap`'s cycle guard (base-namespace-emitter.ts).
   */
  private static findChoiceAncestor(data: Data): { choice: Choice; intermediates: Data[] } | undefined {
    const intermediates: Data[] = [];
    const visited = new Set<string>([data.name]);
    let current: unknown = data.superType?.ref;
    while (current) {
      if (isChoice(current)) {
        return { choice: current, intermediates };
      }
      if (!isData(current) || visited.has(current.name)) {
        return undefined;
      }
      visited.add(current.name);
      intermediates.push(current);
      current = current.superType?.ref;
    }
    return undefined;
  }

  /**
   * Collect `start` plus every further Data ancestor reachable via
   * `extends` (a visited-set guards a malformed cyclic chain, mirroring
   * `findChoiceAncestor`'s own guard just above). Only called once
   * `findChoiceAncestor(start)` has already returned `undefined` for the
   * SAME `start`, so every link in the returned chain is known to be a
   * Data (a Choice ancestor, if one existed, would have short-circuited
   * that earlier check first) — this never needs to special-case a Choice
   * terminator itself.
   */
  private static collectDataAncestryChain(start: Data): Data[] {
    const chain: Data[] = [];
    const visited = new Set<string>();
    let current: Data | undefined = start;
    while (current && !visited.has(current.name)) {
      visited.add(current.name);
      chain.push(current);
      const parent: unknown = current.superType?.ref;
      current = parent && isData(parent) ? parent : undefined;
    }
    return chain;
  }

  /**
   * Build the base (pre-condition, pre-lazy) schema expression for a Data
   * type's superType chain, at a given attribute-line indentation.
   *
   * Cases, in order:
   *  - The `extends` chain (from `data`, inclusive of `data`'s own
   *    superType) reaches a Choice ancestor (Data-extends-Choice, possibly
   *    through intermediate Data links — see docs/superpowers/specs/
   *    2026-07-02-data-extends-choice-design.md): emit ONE
   *    `runeExtendChoice(<ChoiceAncestor>Schema, {...})` call whose shape
   *    is the UNION of every intermediate Data's own attributes plus
   *    `data`'s own attributes (nearest-declared wins on a name collision,
   *    matching `buildAttributeTypesMap`'s own "nearest wins" rule) — NOT a
   *    chain of `.extend()` calls on top of a `runeExtendChoice(...)`
   *    result (a `z.union(...)`  has no `.extend()`; `.extend()` is only
   *    defined on `z.object`/`z.strictObject`, and calling it on a union
   *    throws at MODULE-INIT time — this was the real, previously-
   *    unguarded bug for BOTH the single-level and multi-level cases).
   *  - No Choice ancestor, but `data.superType?.ref` is a Data:
   *    `${ParentSchema}.extend({...})` — the ordinary FR-005 path,
   *    unchanged.
   *  - No superType: a plain `z.object({...})` body (emitObjectBody).
   *
   * `attrIndent` controls the object-body indentation for own attributes,
   * matching the two call sites' existing formatting conventions (2-space
   * for the non-conditions path via emitAttribute's own 2-space prefix,
   * 4-space reindented for the chained conditions path).
   */
  private buildSuperTypeSchemaExpr(data: Data, attrIndent: '' | '  '): string {
    const superRef = data.superType?.ref;

    if (superRef && isChoice(superRef)) {
      return this.buildRuneExtendChoiceExpr(superRef, [data], attrIndent);
    }

    if (superRef && isData(superRef)) {
      // `findChoiceAncestor(superRef)`'s `intermediates` starts its walk
      // from `superRef.superType.ref` — it never includes `superRef` ITSELF
      // (findChoiceAncestor's own contract: "NOT including `data` [here,
      // `superRef`] itself"). `superRef`'s own attributes (e.g.
      // ObservableItem's `identifier`) must still be folded in — prepend
      // `superRef` explicitly alongside `data`.
      const choiceAncestor = ZodNamespaceEmitter.findChoiceAncestor(superRef);
      if (choiceAncestor) {
        // Multi-level: fold `data`'s own attrs on top of every intermediate
        // Data's own attrs (superRef, then each further intermediate up to
        // — but not including — the Choice), nearest-first, and derive
        // ONCE from the Choice ancestor's schema.
        return this.buildRuneExtendChoiceExpr(
          choiceAncestor.choice,
          [data, superRef, ...choiceAncestor.intermediates],
          attrIndent
        );
      }

      // When the parent is cyclic, `.extend()` cannot be used at all — a
      // cyclic type's own declaration is `z.lazy(() => ...)` (per
      // emitTypeSchema's `isLazy` branch above), and `ZodLazy` has no
      // `.extend()` method, at either the type OR runtime level (confirmed:
      // `NodeSchema.extend is not a function` at actual runtime, not just a
      // TS type error — z.lazy() wrapping the WHOLE `.extend(...)` call
      // still fails, since the call itself is illegal regardless of when it
      // runs). Fold the parent's own attributes inline into a flat
      // `z.object({...})` instead — the same technique
      // `buildRuneExtendChoiceExpr` already uses for the Choice-ancestor
      // case — so this never needs `.extend()` on the cyclic parent at all.
      // Each folded attribute still goes through `emitAttribute` →
      // `resolveTypeExpr`, so a folded attribute that itself references the
      // cyclic type (e.g. the parent's own self-referencing field) is still
      // correctly wrapped via `schemaRefExpr`.
      //
      // `superRef` may itself extend a FURTHER Data ancestor (e.g.
      // `Grandparent <- Node <- Special` where `Node` is self-referential)
      // — folding only `superRef`'s own attributes would silently omit
      // `Grandparent`'s. `collectDataAncestryChain(superRef)` walks the
      // full remaining chain (already known Choice-free — `choiceAncestor`
      // above already ruled that out), so every ancestor's own attributes
      // are folded in, nearest-declared-first (`data`, then `superRef`,
      // then each further ancestor) — matching `buildRuneExtendChoiceExpr`'s
      // own documented "nearest-declared wins" convention.
      const parentSchema = `${superRef.name}Schema`;
      if (this.ctx.lazyTypes.has(superRef.name)) {
        const seen = new Set<string>();
        const attrLines: string[] = [];
        for (const attr of [
          ...data.attributes,
          ...ZodNamespaceEmitter.collectDataAncestryChain(superRef).flatMap((ancestor) => ancestor.attributes)
        ]) {
          if (seen.has(attr.name)) continue;
          seen.add(attr.name);
          attrLines.push(this.emitAttribute(attr, data.name));
        }
        if (attrLines.length === 0) {
          return 'z.object({})';
        }
        const reindented =
          attrIndent === '' ? attrLines.join(',\n') : attrLines.map((a) => `${attrIndent}${a}`).join(',\n');
        return `z.object({\n${reindented}\n})`;
      }
      if (data.attributes.length === 0) {
        return `${parentSchema}.extend({})`;
      }
      const attrs = data.attributes.map((attr) => this.emitAttribute(attr, data.name));
      const reindented = attrIndent === '' ? attrs.join(',\n') : attrs.map((a) => `${attrIndent}${a}`).join(',\n');
      return `${parentSchema}.extend({\n${reindented}\n})`;
    }

    return this.emitObjectBody(data);
  }

  /**
   * Build a `runeExtendChoice(<ChoiceName>Schema, {...})` call, folding the
   * own attributes of every Data in `dataChain` (nearest-declared-wins on a
   * name collision) into the shape object.
   */
  private buildRuneExtendChoiceExpr(choice: Choice, dataChain: Data[], attrIndent: '' | '  '): string {
    const choiceSchema = `${choice.name}Schema`;
    // Same reasoning as buildSuperTypeSchemaExpr's `wrap`: `runeExtendChoice`
    // is a plain function CALL (not a chained method), so when `choice` is
    // cyclic the whole call — not just `choiceSchema` — is wrapped in
    // z.lazy() to defer the (otherwise eager) reference past
    // module-initialization time.
    const wrap = (expr: string): string => (this.ctx.lazyTypes.has(choice.name) ? `z.lazy(() => ${expr})` : expr);

    const seen = new Set<string>();
    const attrLines: string[] = [];
    for (const link of dataChain) {
      for (const attr of link.attributes) {
        if (seen.has(attr.name)) continue;
        seen.add(attr.name);
        // `choice.name`, not `link.name`: when `wrap()` fires (choice is
        // cyclic), this whole expression — and every folded attribute in
        // it — ends up inside `wrap()`'s own z.lazy() closure, so a
        // reference back to `choice` from one of these attributes needs no
        // further wrapping, same as any other within-its-own-lazy-closure
        // reference. `link` (the Data instance an attribute happens to be
        // folded from) isn't itself lazy-wrapped here at all.
        attrLines.push(this.emitAttribute(attr, choice.name));
      }
    }

    if (attrLines.length === 0) {
      return wrap(`runeExtendChoice(${choiceSchema}, {})`);
    }
    const reindented =
      attrIndent === '' ? attrLines.join(',\n') : attrLines.map((a) => `${attrIndent}${a}`).join(',\n');
    return wrap(`runeExtendChoice(${choiceSchema}, {\n${reindented}\n})`);
  }

  /**
   * Emit a full schema declaration for a Data type.
   * Handles: plain object, extends, lazy wrapping for cycles, condition blocks.
   * FR-002 (exports), FR-005 (extends), FR-006 (lazy), FR-008 (empty).
   * FR-010, FR-011 (conditions via emitConditionBlock). T056.
   */
  private emitTypeSchema(data: Data): string {
    const name = data.name;
    const schemaName = `${name}Schema`;
    const isLazy = this.ctx.lazyTypes.has(name);
    const hasConditions = activeConditions(data).length > 0;

    const schemaExpr = this.buildSuperTypeSchemaExpr(data, '');

    if (isLazy) {
      // For cyclic types: add explicit ZodType annotation so TS can infer recursive schemas.
      // Conditions inside lazy: wrap the condition inside the lazy callback.
      if (hasConditions) {
        const condBlock = this.emitConditionBlock(data);
        const innerExpr = `${schemaExpr}\n${condBlock}`;
        const indented = innerExpr
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        return `export const ${schemaName}: z.ZodType<${name}> = z.lazy(() =>\n${indented}\n);`;
      }
      const indented = schemaExpr
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      return `export const ${schemaName}: z.ZodType<${name}> = z.lazy(() =>\n${indented}\n);`;
    }

    if (hasConditions) {
      const condBlock = this.emitConditionBlock(data);
      // Format as oxfmt-style method chain:
      //   export const Schema = z
      //     .object({
      //       a: z.string().optional(),
      //       ...
      //     })
      //     .refine(...)
      //
      // Strategy: rebuild the object body with 4-space attr indentation, then chain.
      if (data.superType?.ref) {
        // extend/runeExtendChoice chain: For simplicity, emit as
        // non-chained since .extend()/runeExtendChoice() reads on a schema
        // ref (or the helper call), not the bare `z` namespace.
        const chainedObjectExpr = this.buildSuperTypeSchemaExpr(data, '  ');
        const condIndented = condBlock
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        return `export const ${schemaName} = ${chainedObjectExpr}\n${condIndented};`;
      } else {
        // z.object chain: build chain as `z\n  .object({...})\n  .refine(...)`
        const attrLines =
          data.attributes.length === 0 ? [] : data.attributes.map((attr) => this.emitAttribute(attr, data.name));
        // Build object body with 4-space attribute indentation.
        // emitAttribute returns '  key: val' (2-space prefix), so add 2 more for 4 total.
        const objectBody =
          attrLines.length === 0 ? `.object({})` : `.object({\n${attrLines.map((a) => `  ${a}`).join(',\n')}\n  })`;
        // Condition block indented 2 spaces
        const condIndented = condBlock
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        return `export const ${schemaName} = z\n  ${objectBody}\n${condIndented};`;
      }
    }

    // Append .meta() for type-level annotations (T068, T069).
    // Only supported for non-lazy, non-condition schemas (the common case).
    const metaSuffix = ZodNamespaceEmitter.buildMetaSuffix(data);
    if (metaSuffix) {
      return `export const ${schemaName} = ${schemaExpr}${metaSuffix};`;
    }

    return `export const ${schemaName} = ${schemaExpr};`;
  }

  /**
   * Emit the TypeScript interface for a cyclic type.
   * For cyclic types, we need the interface declared BEFORE the schema
   * because `z.ZodType<NodeA>` references the TS type `NodeA`.
   */
  private emitCyclicInterface(data: Data): string {
    const name = data.name;
    const fields: string[] = [];

    for (const attr of data.attributes) {
      const type = this.resolveTypeExprAsTs(attr);
      const baseTypeExpr = this.functionInputs
        ? metadataObjectType(type, fieldMetadataKind(attr), 'Record<string, unknown>')
        : type;
      const card = attr.card;
      const tsField = ZodNamespaceEmitter.applyCardinalityTs(card, baseTypeExpr, attr.name, this.functionInputs);
      fields.push(`  ${tsField};`);
    }

    if (fields.length === 0) {
      return `export interface ${name} {}`;
    }

    return `export interface ${name} {\n${fields.join('\n')}\n}`;
  }

  /**
   * Resolve the TypeScript type expression for an attribute (for interface declarations).
   */
  private resolveTypeExprAsTs(attr: Attribute): string {
    return resolveTypeCallTarget(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.functionInputs
            ? (typescriptProfile.basicTypeMap[basicTypeName] ??
              typescriptProfile.recordTypeMap[basicTypeName] ??
              typescriptProfile.typeAliasMap[basicTypeName])
            : ZOD_TS_TYPE_MAP[basicTypeName];
          if (typeof mapped === 'string') return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no TypeScript mapping in interface for '${attr.name}'; emitting unknown`
          });
          return 'unknown';
        },
        onEnum: (node) => node.name,
        onData: (node) => node.name,
        onChoice: (node) => node.name,
        onUnresolved: (refText) => {
          // Pre-migration behavior never pushed a diagnostic on this path —
          // it optimistically assumed an unresolved-but-named ref is a
          // data/enum/choice type name used as-is; a genuinely anonymous
          // ref falls back to 'unknown'. No diagnostic here, verbatim.
          if (refText) {
            const builtinTs = ZOD_TS_TYPE_MAP[refText];
            if (builtinTs) return builtinTs;
            return refText;
          }
          return 'unknown';
        }
      },
      this.ctx.namespace
    );
  }

  /**
   * Emit the type alias (z.infer<typeof Schema>).
   * For cyclic types the interface is emitted separately (pre-declaration).
   * FR-002 (z.infer alias for every type).
   * Renamed from emitTypeAlias to avoid collision with the public interface method.
   */
  private emitInferAlias(data: Data): string {
    const name = data.name;
    const schemaName = `${name}Schema`;
    // Cyclic types already have an interface declaration; skip z.infer alias
    // (the schema already uses the declared interface as z.ZodType<TypeName>)
    if (this.ctx.lazyTypes.has(name)) {
      return ''; // interface was already declared; no additional alias needed
    }
    return `export type ${name} = z.infer<typeof ${schemaName}>;`;
  }

  /**
   * Build an ExpressionTranspilerContext for a given Data node and emit mode.
   * T055.
   */
  private buildTranspilerContext(
    data: Data,
    emitMode: 'zod-refine' | 'zod-superRefine',
    conditionName: string
  ): ExpressionTranspilerContext {
    return buildConditionTranspilerContext(data, emitMode, conditionName, this.ctx.diagnostics);
  }

  /**
   * Emit the condition block for a Data type.
   * FR-010 (refine vs superRefine), FR-011 (single superRefine for multi-condition).
   * T055.
   *
   * Returns a string like `.refine(...)` or `.superRefine(...)` to be appended
   * to the schema expression. Returns empty string if no conditions.
   */
  private emitConditionBlock(data: Data): string {
    if (this.functionInputs) return '';
    // Filter out conditions that have no expression or are unsupported
    const activeConds = activeConditions(data);
    if (activeConds.length === 0) return '';

    if (activeConds.length === 1) {
      const cond = activeConds[0]!;
      const condName = cond.name ?? 'Condition';
      const transpilerCtx = this.buildTranspilerContext(data, 'zod-refine', condName);
      const predicate = transpileCondition(cond, transpilerCtx);
      const message = buildConditionMessage(cond, transpilerCtx);
      // Use inline form when the full chained line fits within 100 chars (oxfmt printWidth).
      // The chain is indented 2 spaces in emitTypeSchema, so the full line is:
      //   "  .refine((data) => <pred>, '<msg>');"
      // = 2 + ".refine((data) => ".length + pred.length + ", '".length + msg.length + "');" = ?
      const inlineLine = `  .refine((data) => ${predicate}, '${message}');`;
      if (!predicate.includes('\n') && inlineLine.length <= 100) {
        return `.refine((data) => ${predicate}, '${message}')`;
      }
      return [`.refine(`, `  (data) => ${predicate},`, `  '${message}'`, `)`].join('\n');
    }

    // ≥ 2 conditions → single .superRefine() per FR-011
    const lines: string[] = ['.superRefine((data, ctx) => {'];
    for (const cond of activeConds) {
      const condName = cond.name ?? 'Condition';
      const transpilerCtx = this.buildTranspilerContext(data, 'zod-superRefine', condName);
      const body = transpileCondition(cond, transpilerCtx);
      // Indent each line of the body by 2 spaces.
      // emitTypeSchema will then add 2 more via condIndented = total 4 spaces.
      const indented = body
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      lines.push(indented);
    }
    lines.push('})');
    return lines.join('\n');
  }

  /**
   * Emit a Zod enum schema for a RosettaEnumeration.
   * FR-004 (z.enum + display-name Record).
   */
  private emitEnum(enumNode: RosettaEnumeration): string {
    const name = enumNode.name;
    const schemaName = `${name}Schema`;

    const memberNames = getEnumValues(enumNode).map((v) => v.name);

    if (memberNames.length === 0) {
      this.ctx.diagnostics.push({
        severity: 'warning',
        code: 'empty-enum',
        message: `Enum '${name}' has no values; emitting z.enum([]) which is not valid Zod — treating as z.never()`
      });
      return [`export const ${schemaName} = z.never();`, `export type ${name} = z.infer<typeof ${schemaName}>;`].join(
        '\n'
      );
    }

    const memberLiterals = memberNames.map((m) => `'${m}'`).join(', ');
    const lines: string[] = [
      `export const ${schemaName} = z.enum([${memberLiterals}]);`,
      `export type ${name} = z.infer<typeof ${schemaName}>;`
    ];

    // Emit display-name companion if any member has a display name
    const hasDisplayNames = getEnumValues(enumNode).some((v) => v.display != null);
    if (hasDisplayNames) {
      const displayEntries = getEnumValues(enumNode).map((v) => {
        // Use single-quoted value (oxfmt singleQuote: true); key unquoted (valid ES5+ property key)
        const displayName =
          v.display != null
            ? ZodNamespaceEmitter.escapeDisplayName(v.display)
            : ZodNamespaceEmitter.escapeDisplayName(v.name);
        return `  ${v.name}: '${displayName}'`;
      });
      lines.push('');
      lines.push(`export const ${name}DisplayNames: Record<${name}, string> = {\n${displayEntries.join(',\n')}\n};`);
    }

    return lines.join('\n');
  }

  /**
   * Emit a Zod schema and type alias for a RosettaTypeAlias node.
   * NOTE: not named `emitTypeAlias` — that name is taken by the public interface method.
   *
   * Resolves the alias's own right-hand side (`typeAlias A: B` — what `B`
   * resolves to) via the shared `resolveTypeCallTarget` resolver, same as
   * `resolveTypeExpr` resolves an ATTRIBUTE's type reference. This transparently
   * chases `B` through further `RosettaTypeAlias` links (e.g. `typeAlias A: B`
   * where `B` is itself `typeAlias B: C`) — the hand-rolled chain this replaces
   * had no `isRosettaTypeAlias` branch, so `A` silently degraded to `z.unknown()`
   * whenever its RHS was itself an alias (unified-type-reference-resolution
   * follow-up; the earlier Task 3 migration only covered attribute references).
   */
  private emitTypeAliasSchema(alias: RosettaTypeAlias): string {
    const name = alias.name;
    const schemaName = `${name}Schema`;

    const zodExpr = resolveTypeCallTarget(
      alias.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (typeof mapped === 'string') return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no Zod mapping in type alias '${alias.name}'; emitting z.unknown()`
          });
          return 'z.unknown()';
        },
        onEnum: (node) => `${node.name}Schema`,
        // ALWAYS wrap Data/Choice targets in z.lazy() — unconditionally,
        // not `schemaRefExpr`'s cyclic-only check. `emitNamespaceWithContract`
        // emits every type alias unconditionally BEFORE any Data/Choice
        // declaration (Enums → TypeAliases → Data prelude → Data/Choice via
        // topo-sorted emitOrder), so a type alias's reference to ANY
        // Data/Choice — cyclic or not — is a structural forward reference
        // every single time, not something `lazyTypes` tracks at all
        // (`lazyTypes` only tracks cycles among Data/Choice's OWN
        // topo-sorted emit order, which type aliases sit entirely outside
        // of). Enum targets need no such wrapping: Enums are emitted before
        // type aliases too, so `onEnum` above stays a bare reference.
        onData: (node) => `z.lazy(() => ${node.name}Schema)`,
        onChoice: (node) => `z.lazy(() => ${node.name}Schema)`,
        // Pre-migration behavior: a totally unresolved RHS (not a builtin,
        // not a known Enum/Data/Choice/alias) falls back to `z.unknown()`
        // with no diagnostic — verbatim, no optimistic `${refText}Schema`
        // guess (unlike `resolveTypeExpr`'s attribute-side onUnresolved).
        onUnresolved: () => 'z.unknown()'
      },
      this.ctx.namespace
    );

    const lines: string[] = [
      `export const ${schemaName} = ${zodExpr};`,
      `export type ${name} = z.infer<typeof ${schemaName}>;`
    ];

    return lines.join('\n');
  }

  /**
   * Build the `runeReportRules` const string for all rules in this namespace.
   * Renamed from emitReportMetadata to avoid collision with the public interface method.
   * Returns an empty string when there are no rules in the namespace.
   */
  private buildReportMetadataText(): string {
    const lines = buildReportRulesLines(this.ctx.rulesByName);
    return lines.length === 0 ? '' : lines.join('\n');
  }

  /**
   * Emit a Zod refine validator for a RosettaRule.
   * Only emitted when the rule has a resolvable input type with a known schema.
   */
  private emitRuleValidator(rule: RosettaRule): string {
    const name = rule.name;
    const inputTypeRef = rule.input?.type?.ref;
    const inputTypeName = inputTypeRef ? inputTypeRef.name : undefined;

    if (!inputTypeName) {
      this.ctx.diagnostics.push({
        severity: 'warning',
        code: 'rule-no-input-type',
        message: `Rule '${name}' has no resolvable input type; skipping Zod validator`
      });
      return '';
    }

    const isLocal = this.ctx.dataByName.has(inputTypeName);
    const isCrossNs = !isLocal && inputTypeRef && getElementNamespace(inputTypeRef) !== this.ctx.namespace;
    if (!isLocal && !isCrossNs) {
      this.ctx.diagnostics.push({
        severity: 'warning',
        code: 'rule-no-input-type',
        message: `Rule '${name}': input type '${inputTypeName}' not found; skipping Zod validator`
      });
      return '';
    }

    const schemaName = `${inputTypeName}Schema`;
    const attributeTypes = new Map<string, string>();
    const inputData =
      this.ctx.dataByName.get(inputTypeName) ?? (inputTypeRef && isData(inputTypeRef) ? inputTypeRef : undefined);
    if (inputData && 'attributes' in inputData) {
      for (const attr of (
        inputData as {
          attributes: Array<{ name: string; typeCall?: { type?: { $refText?: string } } }>;
        }
      ).attributes) {
        attributeTypes.set(attr.name, attr.typeCall?.type?.$refText ?? 'unknown');
      }
    }

    const transpilerCtx: ExpressionTranspilerContext = {
      selfName: 'data',
      emitMode: 'zod-refine',
      conditionName: name,
      typeName: inputTypeName,
      attributeTypes,
      diagnostics: this.ctx.diagnostics
    };

    const exprStr = transpileExpression(rule.expression, transpilerCtx);

    return `export const validate${name} = ${schemaName}.refine(\n  (data) => ${exprStr},\n  '${name}'\n);`;
  }

  /**
   * Emit the file header: SPDX, generated comment, imports, runtime helpers.
   * FR-021 (inlined helpers), T038.
   *
   * 019 Phase 0.5.2: when `suppressBoilerplate: true` is set on the
   * options (set by `GenericModelEmitter` when wrapping this emitter in
   * a whole-model layout), the inline `RUNTIME_HELPER_SOURCE` block is
   * replaced by an `import { runeCheckOneOf, runeCount, runeAttrExists }
   * from './runtime.zod.js'` statement. The Zod LanguageProfile's
   * `makeSharedArtifacts` then emits the `runtime.zod.ts` sidecar once
   * for the whole bundle.
   */
  private buildFileHeader(): string {
    return [
      `// SPDX-License-Identifier: MIT`,
      `// Generated by @rune-langium/codegen — do not edit`,
      `// Source namespace: ${this.model.namespace}`,
      ``,
      `import { z } from 'zod';`,
      ...(this.suppressBoilerplate
        ? [
            "import { Temporal } from '@js-temporal/polyfill';",
            buildRuntimeHelperImportLine(
              `${resolveImportPath(this.model.namespace, 'runtime', this.registry)}.zod.js`,
              ['runeExtendChoice']
            ),
            ``
          ]
        : ['', RUNTIME_HELPER_SOURCE, '', RUNE_EXTEND_CHOICE_HELPER_SOURCE, ''])
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private static helpers (pure utilities, no ctx)
  // ---------------------------------------------------------------------------

  /**
   * Return a property key expression for a Zod object literal.
   *
   * In ES5+ / TypeScript, reserved words are valid unquoted property keys
   * (e.g. `{ class: z.string() }` is legal). The oxfmt linter removes quotes
   * from reserved-word keys, so we emit them unquoted to keep byte-identical
   * output after formatting. FR-009.
   */
  private static quoteKey(key: string): string {
    // All valid identifiers (including JS reserved words) can be used unquoted
    // as property keys in object literals per ES5+. Return key as-is.
    return key;
  }

  /**
   * Escape a display-name string for use in a single-quoted TypeScript string literal.
   * Spec edge case: display names may contain `'` or backslashes.
   * We use single quotes to match the oxfmt singleQuote: true style.
   */
  private static escapeDisplayName(name: string): string {
    return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /**
   * Map a Rune cardinality to a Zod expression suffix applied to a base type schema.
   * FR-003.
   *
   * @param card - The RosettaCardinality AST node.
   * @param baseZodExpr - The base Zod expression (e.g., 'z.string()').
   * @returns The full Zod expression with cardinality encoding.
   */
  private static applyCardinality(card: RosettaCardinality, baseZodExpr: string): string {
    const { lower, upper } = decodeCardinality(card);

    if (upper === null) {
      // (lower..*)
      if (lower === 0) {
        return `z.array(${baseZodExpr})`; // (0..*)
      }
      if (lower === 1) {
        return `z.array(${baseZodExpr}).min(1)`; // (1..*)
      }
      return `z.array(${baseZodExpr}).min(${lower})`; // (n..*)
    }

    if (upper === 1 && lower === 1) {
      return baseZodExpr; // (1..1) — required scalar
    }

    if (upper === 0 && lower === 0) {
      // Degenerate: (0..0) — treat as optional
      return `${baseZodExpr}.optional()`;
    }

    if (upper === 1 && lower === 0) {
      return `${baseZodExpr}.optional()`; // (0..1)
    }

    // Array forms
    if (upper === lower && upper > 1) {
      return `z.array(${baseZodExpr}).length(${upper})`; // (n..n) n>1
    }

    if (lower === 0 && upper > 1) {
      return `z.array(${baseZodExpr}).max(${upper})`; // (0..m)
    }

    // (n..m) general
    return `z.array(${baseZodExpr}).min(${lower}).max(${upper})`;
  }

  /**
   * Apply cardinality to a TypeScript type expression for interface fields.
   */
  private static applyCardinalityTs(
    card: RosettaCardinality,
    baseType: string,
    name: string,
    optionalArrays = false
  ): string {
    const { lower, upper } = decodeCardinality(card);
    const key = ZodNamespaceEmitter.quoteKey(name);

    if (upper === null) {
      if (lower === 0) return `${key}?: ${baseType}[]`;
      return `${key}: ${baseType}[]`;
    }

    if (upper === 1 && lower === 1) return `${key}: ${baseType}`;
    if (upper === 1 && lower === 0) return `${key}?: ${baseType}`;

    // Array forms
    return `${key}${optionalArrays && lower === 0 ? '?' : ''}: ${baseType}[]`;
  }

  /**
   * Build a `.meta(...)` suffix for a Data node's type-level annotations.
   *
   * Each AnnotationRef contributes one key to the meta object whose value is an
   * object with:
   *   - `attribute`: the referenced attribute name (if any)
   *   - one entry per qualifier: qualName → qualValue
   *
   * Returns an empty string when the data node has no type-level annotations.
   * T068, T069, US11.
   */
  private static buildMetaSuffix(data: Data): string {
    const annotations = data.annotations ?? [];
    if (annotations.length === 0) return '';

    const metaEntries = annotations.map((annRef) => {
      const annName = annRef.annotation?.$refText ?? annRef.annotation?.ref?.name ?? 'unknown';
      const parts: string[] = [];
      const attrName = annRef.attribute?.$refText ?? annRef.attribute?.ref?.name;
      if (attrName) {
        parts.push(`attribute: '${attrName}'`);
      }
      for (const q of annRef.qualifiers ?? []) {
        if (q.qualName && q.qualValue !== undefined) {
          const escapedValue = q.qualValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          parts.push(`${q.qualName}: '${escapedValue}'`);
        }
      }
      const body = parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}';
      return `    ${annName}: ${body}`;
    });

    return `.meta({\n${metaEntries.join(',\n')}\n  })`;
  }
}
