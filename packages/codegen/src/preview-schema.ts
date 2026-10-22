// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { temporalWireFormat } from './expr/temporal-conversions.js';
import { AstUtils, type LangiumDocument } from 'langium';
import {
  isChoice,
  isData,
  isRosettaEnumeration,
  isRosettaFunction,
  isRosettaModel,
  isRosettaTypeAlias,
  type Attribute,
  type Choice,
  type ChoiceOption,
  type Data,
  type RosettaEnumeration,
  type RosettaFunction,
  type RosettaTypeAlias,
  type TypeCall,
  qualifiedExportPath
} from '@rune-langium/core';
import type {
  FormPreviewSchema,
  FunctionPreviewOutput,
  GeneratePreviewSchemaOptions,
  PreviewField,
  PreviewFieldKind,
  PreviewSourceMapEntry
} from './types.js';
import { choiceOptionFieldName, decodeCardinality } from './emit/base-namespace-emitter.js';
import { buildTypeReferenceGraph, findCyclicTypes } from './cycle-detector.js';
import { resolveTypeCallTarget, type TypeResolutionVisitor } from './emit/type-ref-resolver.js';
import { functionInputs, functionOutput, functionSignature } from './types/func.js';
import { fieldMetadataKind, type FieldMetadataKind } from './expr/metadata-runtime.js';
import { isMetadataInputEnvelope, metadataPayloadShape } from './expr/metadata-input.js';

function humanizeLabel(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_DEPTH = 3;

export interface NamespaceIndex {
  namespace: string;
  dataByName: Map<string, { node: Data; sourceUri: string }>;
  enumByName: Map<string, { node: RosettaEnumeration; sourceUri: string }>;
  typeAliasByName: Map<string, { node: RosettaTypeAlias; sourceUri: string }>;
  choiceByName: Map<string, { node: Choice; sourceUri: string }>;
  funcByName: Map<string, { node: RosettaFunction; sourceUri: string }>;
  duplicateDataNames: Set<string>;
  /** Mirrors `duplicateDataNames`, for `Choice` — see its own doc comment. */
  duplicateChoiceNames: Set<string>;
}

interface FieldContext {
  namespace: NamespaceIndex;
  unsupportedFeatures: Set<string>;
  sourceMap: PreviewSourceMapEntry[];
  sourceUri: string;
  maxDepth: number;
  depth: number;
  path: string;
  label: string;
  seenTypes: Set<string>;
  /** Whole-graph cycle membership is informational; path repeats use deferred definitions. */
  cyclicTypes: ReadonlySet<string>;
  /** Worker-derived assignability for function inputs and hydrated bundles. */
  assignableTypes?: ReadonlyMap<string, readonly string[]>;
}

const BUILTIN_KIND_MAP: Record<string, Extract<PreviewFieldKind, 'string' | 'number' | 'boolean'>> = {
  string: 'string',
  int: 'number',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  dateTime: 'string',
  zonedDateTime: 'string',
  time: 'string',
  productType: 'string',
  eventType: 'string'
};

export function generatePreviewSchemas(
  documents: LangiumDocument | LangiumDocument[],
  options: GeneratePreviewSchemaOptions = {}
): FormPreviewSchema[] {
  const docs = Array.isArray(documents) ? documents : [documents];
  const namespaces = buildNamespaceIndexes(docs);
  const assignableTypes = buildAssignableTypes(namespaces);
  const schemas: FormPreviewSchema[] = [];

  // Whole-graph cycle detection (issue: Form Preview's own local, walk-
  // order-dependent seenTypes guard misses a cycle whenever each side of it
  // is separately generated as its own top-level target — e.g. Party <->
  // Identifier, each entered fresh with its own empty seenTypes). Reuses the
  // SAME buildTypeReferenceGraph/findCyclicTypes Tarjan's-SCC mechanism
  // namespace-walker.ts already shares with the real Zod/TS/JSON-Schema
  // emitters, rather than re-deriving cycle detection locally (DRY). Passes
  // qualifiedTypeId as the node-id function since `docs` spans MULTIPLE
  // namespaces here (unlike namespace-walker.ts's per-namespace call,
  // bare names would collide across namespaces and produce false cycles).
  const cyclicTypes = findCyclicTypes(buildTypeReferenceGraph(docs, qualifiedTypeId));

  for (const namespace of namespaces) {
    // Data types
    const dataNames = Array.from(namespace.dataByName.keys()).sort();
    for (const name of dataNames) {
      const data = namespace.dataByName.get(name)!;
      const targetId = `${namespace.namespace}.${name}`;
      if (options.targetId && options.targetId !== targetId) continue;
      if (namespace.duplicateDataNames.has(name)) {
        schemas.push(buildDuplicateTargetSchema(data.node, targetId));
        continue;
      }
      schemas.push(
        buildDataSchema(
          data.node,
          data.sourceUri,
          namespace,
          targetId,
          options.maxDepth ?? DEFAULT_MAX_DEPTH,
          cyclicTypes
        )
      );
    }

    // Type aliases
    const aliasNames = Array.from(namespace.typeAliasByName.keys()).sort();
    for (const name of aliasNames) {
      const alias = namespace.typeAliasByName.get(name)!;
      const targetId = `${namespace.namespace}.${name}`;
      if (options.targetId && options.targetId !== targetId) continue;
      schemas.push(buildTypeAliasSchema(alias.node, alias.sourceUri, namespace, targetId, cyclicTypes));
    }

    // Choice types
    const choiceNames = Array.from(namespace.choiceByName.keys()).sort();
    for (const name of choiceNames) {
      const choice = namespace.choiceByName.get(name)!;
      const targetId = `${namespace.namespace}.${name}`;
      if (options.targetId && options.targetId !== targetId) continue;
      if (namespace.duplicateChoiceNames.has(name)) {
        schemas.push(buildDuplicateTargetSchema(choice.node, targetId));
        continue;
      }
      schemas.push(buildChoiceSchema(choice.node, choice.sourceUri, namespace, targetId, cyclicTypes));
    }

    // Functions
    const funcNames = Array.from(namespace.funcByName.keys()).sort();
    for (const name of funcNames) {
      const func = namespace.funcByName.get(name)!;
      const targetId = `${namespace.namespace}.${name}`;
      if (options.targetId && options.targetId !== targetId) continue;
      schemas.push(buildFunctionSchema(func.node, namespace, targetId, cyclicTypes, assignableTypes));
    }
  }

  const bodies = new Map<string, FormPreviewSchema>();
  const declarations = new Map<string, { node: Data | Choice; sourceUri: string; namespace: NamespaceIndex }>(
    namespaces.flatMap((namespace) => [
      ...Array.from(
        namespace.dataByName.values(),
        (entry) => [qualifiedTypeId(entry.node), { ...entry, namespace }] as const
      ),
      ...Array.from(
        namespace.choiceByName.values(),
        (entry) => [qualifiedTypeId(entry.node), { ...entry, namespace }] as const
      )
    ])
  );
  const references = (fields: PreviewField[]): string[] =>
    fields.flatMap((field) => [
      ...(field.kind === 'object' && field.definitionId ? [field.definitionId] : []),
      ...('children' in field ? references(field.children) : [])
    ]);
  for (const schema of schemas) {
    const definitions: NonNullable<FormPreviewSchema['definitions']> = Object.create(null);
    const pending = references(schema.fields);
    const unsupported = new Set(schema.unsupportedFeatures);
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index]!;
      if (definitions[id] !== undefined) continue;
      let body = bodies.get(id);
      if (!body) {
        const entry = declarations.get(id);
        if (!entry) {
          unsupported.add(`unresolved-reference:${id}`);
          continue;
        }
        body = isData(entry.node)
          ? buildDataSchema(entry.node, entry.sourceUri, entry.namespace, id, 0, cyclicTypes)
          : buildChoiceSchema(entry.node, entry.sourceUri, entry.namespace, id, cyclicTypes, 0);
        bodies.set(id, body);
      }
      for (const field of body.fields) {
        if (field.kind === 'object' && field.referencedTypeFqn) {
          field.assignableTypeFqns = [...(assignableTypes.get(field.referencedTypeFqn) ?? [])];
        } else if (field.kind === 'array') {
          const child = field.children[0];
          if (child.kind === 'object' && child.referencedTypeFqn) {
            child.assignableTypeFqns = [...(assignableTypes.get(child.referencedTypeFqn) ?? [])];
          }
        }
      }
      definitions[id] = {
        fields: body.fields,
        choiceArmPaths: body.kind === 'choice' ? body.fields.map((field) => field.path) : body.choiceArmPaths,
        sourceMap: body.sourceMap
      };
      body.unsupportedFeatures?.forEach((feature) => unsupported.add(feature));
      pending.push(...references(body.fields));
    }
    if (Object.keys(definitions).length) schema.definitions = definitions;
    if (unsupported.size) schema.unsupportedFeatures = Array.from(unsupported).sort();
    schema.status = hasReportableUnsupportedFeature(unsupported) ? 'unsupported' : 'ready';
  }
  return schemas;
}

export function buildNamespaceIndexes(docs: LangiumDocument[]): NamespaceIndex[] {
  const byNamespace = new Map<string, NamespaceIndex>();

  for (const doc of docs) {
    const model = doc.parseResult?.value;
    if (!model || !isRosettaModel(model)) continue;

    const namespace = normalizeNamespace(model.name);
    if (!namespace) continue;

    let index = byNamespace.get(namespace);
    if (!index) {
      index = {
        namespace,
        dataByName: new Map(),
        enumByName: new Map(),
        typeAliasByName: new Map(),
        choiceByName: new Map(),
        funcByName: new Map(),
        duplicateDataNames: new Set(),
        duplicateChoiceNames: new Set()
      };
      byNamespace.set(namespace, index);
    }

    for (const element of model.elements) {
      if (isData(element)) {
        if (index.dataByName.has(element.name)) {
          index.duplicateDataNames.add(element.name);
          continue;
        }
        index.dataByName.set(element.name, { node: element, sourceUri: doc.uri.toString() });
      } else if (isRosettaEnumeration(element)) {
        index.enumByName.set(element.name, { node: element, sourceUri: doc.uri.toString() });
      } else if (isRosettaTypeAlias(element)) {
        index.typeAliasByName.set(element.name, { node: element, sourceUri: doc.uri.toString() });
      } else if (isChoice(element)) {
        if (index.choiceByName.has(element.name)) {
          index.duplicateChoiceNames.add(element.name);
          continue;
        }
        index.choiceByName.set(element.name, { node: element, sourceUri: doc.uri.toString() });
      } else if (isRosettaFunction(element)) {
        const signature = functionSignature(element);
        const existing = index.funcByName.get(element.name);
        if (!existing || !signature.dispatchAttribute) {
          index.funcByName.set(element.name, {
            node: signature,
            sourceUri: AstUtils.getDocument(signature).uri.toString()
          });
        }
      }
    }
  }

  return Array.from(byNamespace.values()).sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/** Maps each referenceable type to every concrete Data/Choice type assignable to it. */
function buildAssignableTypes(namespaces: readonly NamespaceIndex[]): ReadonlyMap<string, readonly string[]> {
  const types = namespaces.flatMap((namespace) => [
    ...Array.from(namespace.dataByName.values(), ({ node }) => node),
    ...Array.from(namespace.choiceByName.values(), ({ node }) => node)
  ]);
  const assignable = new Map<string, Set<string>>();
  for (const candidate of types) {
    const candidateId = qualifiedTypeId(candidate);
    const visited = new Set<string>();
    let current: Data | Choice | undefined = candidate;
    while (current) {
      const currentId = qualifiedTypeId(current);
      if (visited.has(currentId)) break;
      visited.add(currentId);
      let values = assignable.get(currentId);
      if (!values) assignable.set(currentId, (values = new Set()));
      values.add(candidateId);
      const parent: unknown = isData(current) ? current.superType?.ref : undefined;
      current = parent && (isData(parent) || isChoice(parent)) ? parent : undefined;
    }
  }
  return new Map(Array.from(assignable, ([typeFqn, values]) => [typeFqn, Array.from(values).sort()]));
}

function normalizeNamespace(name: unknown): string {
  if (typeof name === 'string') {
    return name.replace(/^"|"$/g, '');
  }
  if (
    name &&
    typeof name === 'object' &&
    'segments' in name &&
    Array.isArray((name as { segments?: unknown }).segments)
  ) {
    return (name as { segments: string[] }).segments.join('.');
  }
  return String(name ?? '');
}

/**
 * Namespace-qualified identity for a declaration, for use as a
 * `seenTypes` recursion-guard key (issue #436). Every top-level Data/Choice
 * is a direct child of its document's `RosettaModel`, so its namespace is
 * simply that container's (normalized) `name` — mirrors how
 * `buildNamespaceIndexes` derives the same namespace string for the SAME
 * container. Keying by bare `.name` alone let two distinct types in
 * different namespaces that happen to share a simple name (e.g.
 * `trade.Observable` vs. `asset.Observable`) collide and spuriously trip
 * the cycle guard.
 */
function qualifiedTypeId(node: Data | Choice | RosettaTypeAlias | RosettaEnumeration): string {
  return qualifiedExportPath(normalizeNamespace(node.$container.name), node.name);
}

/**
 * `unsupportedFeatures` mixes genuinely-truncated/unresolved markers
 * (`unresolved-reference:`, `duplicate-target:`,
 * `empty-choice:`, `choice-arm-collision:`) with the purely informational
 * `cyclic-type:` marker (a type participates in a cycle SOMEWHERE, even
 * when THIS occurrence rendered every field successfully — see
 * FieldContext.cyclicTypes' doc comment). Only a genuinely-truncated/
 * unresolved marker may flip `status` to 'unsupported': an inheritance-only
 * cycle (e.g. `A extends B`, `B extends A`) makes cyclicTypes flag both
 * ends even though `collectInheritedAttributes`'s own extends-chain guard
 * resolves it silently with no truncation at all — a schema whose ONLY tag
 * is `cyclic-type:` must read as 'ready', not 'unsupported' (Codex PR #459
 * review, round 3).
 */
function hasReportableUnsupportedFeature(unsupportedFeatures: ReadonlySet<string>): boolean {
  for (const feature of unsupportedFeatures) {
    if (!feature.startsWith('cyclic-type:')) return true;
  }
  return false;
}

/**
 * Builds Choice-ancestor option fields, dropping any whose `path` collides
 * with one of the Data type's OWN attribute names and flagging each
 * collision as unsupported (issue #435) rather than silently omitting it
 * from `choiceArmPaths`.
 *
 * The real emitted `runeExtendChoice(choice, shape)` helper is
 * `z.union(choice.options.map(arm => arm.extend(shape)))` — `shape` (the
 * Data's own attributes) is merged into EVERY arm via `.extend()`, which in
 * Zod v4 REPLACES a colliding key's schema across the WHOLE union, not just
 * the one arm that named it. A collision therefore destroys that arm's
 * distinguishing type entirely: the merged schema for it no longer conveys
 * "this Choice option was selected" at all, so there is no sound shape to
 * expose as a separate, selectable arm in the form preview. Silently
 * dropping it from `choiceArmPaths` (the prior behavior, shared by every
 * call site below) let `preview-validator.ts`'s "exactly one arm present"
 * check silently under-constrain and potentially reject a
 * structurally-valid sample. Marking the schema `unsupported` instead makes
 * the gap explicit, mirroring this file's existing `empty-choice` precedent
 * for other genuinely-ambiguous real-schema situations.
 *
 * Takes the raw `options` plus a `buildOption` callback (rather than an
 * already-built `PreviewField[]`) so each option can be built ONE AT A TIME
 * into its OWN, isolated `Set<string>` — `buildOption` receives that local
 * set to record diagnostics into instead of the ambient `unsupportedFeatures`.
 * If the option collides, its local set (and everything recorded into it,
 * including a doubly-nested inner collision — round-5 finding #1 — or any
 * unrelated recursive-/unresolved-reference diagnostic) is discarded
 * wholesale, since none of it can name a path the returned schema still
 * contains. If the option survives, its local set is merged into
 * `unsupportedFeatures`.
 *
 * Two prior approaches were both insufficient: a path-prefix removal
 * (round 3) can't distinguish a discarded option's own diagnostic from a
 * RETAINED field's diagnostic that merely shares the same colliding path
 * (round-4 finding). A before/after snapshot diff of the SHARED set (round
 * 4) is still fooled when building a discarded option MUTATES (rather than
 * just adds) an already-present entry — e.g. `asArrayItem`'s
 * `rewriteCollisionDiagnostics` rewrites any matching path in the whole
 * shared set, including a retained field's pre-existing diagnostic, which
 * then reads as "new" and gets swept away with nothing to restore the
 * original (Codex review round 5 on PR #443). Full isolation via a
 * per-option local set has no such gap: a discarded option's build can
 * only ever mutate diagnostics it itself created.
 */
function dropCollidingChoiceArmFields<TOption>(
  options: readonly TOption[],
  buildOption: (option: TOption, localUnsupportedFeatures: Set<string>) => PreviewField,
  ownPaths: ReadonlySet<string>,
  unsupportedFeatures: Set<string>
): PreviewField[] {
  const result: PreviewField[] = [];
  for (const option of options) {
    const local = new Set<string>();
    const field = buildOption(option, local);
    if (ownPaths.has(field.path)) {
      unsupportedFeatures.add(`choice-arm-collision:${field.path}`);
      continue;
    }
    for (const entry of local) unsupportedFeatures.add(entry);
    result.push(field);
  }
  return result;
}

/**
 * Result of walking a Data's `extends` chain: its own + inherited
 * `Attribute` AST nodes, PLUS (round-5 finding #1) the Choice the chain
 * terminates at, if any.
 */
interface InheritedAttributesResult {
  attributes: Attribute[];
  /**
   * Set when the `extends` chain terminates at a Choice ancestor (a Data's
   * `superType` reference is typed `DataOrChoice`, and a Choice can't
   * itself `extends` anything, so it's always the terminal ancestor —
   * mirrors `buildAttributeTypesMap`'s own Data/Choice walk in
   * base-namespace-emitter.ts). `buildDataSchema`'s top-level call site,
   * `buildTypeAliasSchema`'s data-alias branch, and `objectField`'s nested
   * attribute expansion all expand this into pseudo-fields — the first two
   * build a schema whose `fields` sit directly at the root, while
   * `objectField` passes its ambient field path to `buildChoiceOptionField`
   * via `pathPrefix` so the Choice option fields' `path` (e.g.
   * `constituent.commodity`) is correctly prefixed instead of bare. The one
   * remaining consumer of this helper that does NOT yet expand a Choice
   * ancestor is `buildChoiceOptionField`'s OWN nested Data-type option
   * expansion (a Choice option whose Data type itself extends a Choice) —
   * a doubly-nested case intentionally left as a follow-up.
   */
  choiceAncestor?: Choice;
}

/**
 * Collects `data`'s own attributes PLUS every ancestor Data's own
 * attributes, walking the `extends` chain (Data-to-Data), and reports the
 * Choice the chain terminates at, if any (round-5 finding #1 — see
 * `InheritedAttributesResult.choiceAncestor`'s doc comment).
 *
 * Without the attribute-chain walk, a subtype's FormPreviewSchema only
 * reflected its OWN `data.attributes` — omitting required fields declared
 * on a supertype, so an instance missing a required PARENT field could pass
 * structural validation.
 *
 * `attributes` is ordered root-ancestor-first, subtype's-own-attributes-last
 * (reads naturally as a form); a visited-set guards a malformed cyclic
 * chain. A name collision (which Rune's validator otherwise rejects) keeps
 * the root ancestor's declaration.
 */
function collectInheritedAttributes(data: Data): InheritedAttributesResult {
  const chain: Data[] = [];
  const visited = new Set<string>();
  let current: Data | undefined = data;
  let choiceAncestor: Choice | undefined;
  while (current && !visited.has(qualifiedTypeId(current))) {
    visited.add(qualifiedTypeId(current));
    chain.push(current);
    const parent: unknown = current.superType?.ref;
    if (parent && isChoice(parent)) {
      choiceAncestor = parent;
      break;
    }
    current = parent && isData(parent) ? parent : undefined;
  }
  const seen = new Set<string>();
  const attrs: Attribute[] = [];
  for (const node of [...chain].reverse()) {
    for (const attr of node.attributes) {
      if (seen.has(attr.name)) continue;
      seen.add(attr.name);
      attrs.push(attr);
    }
  }
  return { attributes: attrs, choiceAncestor };
}

function buildDataSchema(
  data: Data,
  sourceUri: string,
  namespace: NamespaceIndex,
  targetId: string,
  maxDepth: number,
  cyclicTypes: ReadonlySet<string>
): FormPreviewSchema {
  const unsupportedFeatures = new Set<string>();
  const sourceMap: PreviewSourceMapEntry[] = [];
  const { attributes, choiceAncestor } = collectInheritedAttributes(data);
  const attributeFields = attributes.map((attr) =>
    buildField(attr, {
      namespace,
      unsupportedFeatures,
      sourceMap,
      sourceUri,
      maxDepth,
      depth: 0,
      path: attr.name,
      label: humanizeLabel(attr.name),
      seenTypes: new Set([qualifiedTypeId(data)]),
      cyclicTypes
    })
  );

  // Data-extends-Choice (round-5 finding #1): when the `extends` chain
  // terminates at a Choice ancestor, the REAL generated schema for `data`
  // (see base-namespace-emitter.ts's buildAttributeTypesMap /
  // contributeChoiceOptionsAsAttributes) also accepts one key per Choice
  // option — e.g. `BasketConstituent extends Observable` accepts
  // `commodity`/`cash`/etc. alongside BasketConstituent's own attributes.
  // Reuse buildChoiceOptionField (the same function that already builds a
  // genuine, non-inherited Choice type's own fields) so an option's field
  // shape — and its lower-camel `path`, via choiceOptionFieldName — matches
  // the real emitted schema exactly. On a name collision, the Data type's
  // own attribute wins (mirrors buildAttributeTypesMap's `if
  // (!map.has(...))` precedence, where the more-derived Data's own
  // attributes are set before the Choice's options are ever contributed).
  const ownFieldPaths = new Set(attributeFields.map((field) => field.path));
  const choiceFields = choiceAncestor
    ? dropCollidingChoiceArmFields(
        choiceAncestor.attributes,
        (option, localUnsupportedFeatures) =>
          buildChoiceOptionField(option, {
            namespace,
            unsupportedFeatures: localUnsupportedFeatures,
            sourceUri,
            seenTypes: new Set([qualifiedTypeId(data), qualifiedTypeId(choiceAncestor)]),
            depth: 0,
            maxDepth,
            cyclicTypes
          }),
        ownFieldPaths,
        unsupportedFeatures
      )
    : [];

  const fields = [...choiceFields, ...attributeFields];

  return {
    schemaVersion: SCHEMA_VERSION,
    targetId,
    title: data.name,
    status: hasReportableUnsupportedFeature(unsupportedFeatures) ? 'unsupported' : 'ready',
    fields,
    ...(sourceMap.length > 0 ? { sourceMap } : {}),
    ...(unsupportedFeatures.size > 0 ? { unsupportedFeatures: Array.from(unsupportedFeatures).sort() } : {}),
    ...(choiceAncestor ? { choiceArmPaths: choiceFields.map((field) => field.path) } : {})
  };
}

function buildDuplicateTargetSchema(node: Data | Choice, targetId: string): FormPreviewSchema {
  return {
    schemaVersion: SCHEMA_VERSION,
    targetId,
    title: node.name,
    status: 'unsupported',
    fields: [],
    unsupportedFeatures: [`duplicate-target:${targetId}`]
  };
}

/**
 * Builds a FormPreviewSchema for a RosettaTypeAlias.
 *
 * - If the alias resolves directly to a primitive type (string, int, number,
 *   boolean, etc.), a single scalar field is emitted.
 * - If the alias resolves to another Data type, the object's fields are
 *   expanded inline (same as buildDataSchema).
 * - Otherwise the schema is marked unsupported.
 */
function buildTypeAliasSchema(
  alias: RosettaTypeAlias,
  sourceUri: string,
  namespace: NamespaceIndex,
  targetId: string,
  cyclicTypes: ReadonlySet<string>
): FormPreviewSchema {
  const refText = alias.typeCall?.type?.$refText;
  const unsupportedFeatures = new Set<string>();

  const unresolvedSchema = (): FormPreviewSchema => {
    unsupportedFeatures.add(`unresolved-reference:${refText ?? alias.name}`);
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'typeAlias',
      targetId,
      title: alias.name,
      status: 'unsupported',
      fields: [
        {
          path: 'value',
          label: humanizeLabel(alias.name),
          kind: 'unknown',
          required: true,
          description: `Type reference ${refText ?? alias.name} could not be resolved for form preview.`
        }
      ],
      unsupportedFeatures: Array.from(unsupportedFeatures).sort()
    };
  };

  return resolveTypeCallTarget<FormPreviewSchema>(
    alias.typeCall,
    namespace,
    {
      // Primitive alias (e.g. `typeAlias productType: string`)
      onPrimitive: (basicTypeName) => {
        const builtinKind = BUILTIN_KIND_MAP[basicTypeName];
        if (!builtinKind) {
          // No BUILTIN_KIND_MAP entry (the same pre-existing, unrelated
          // 'pattern'/'calculation' gap noted in buildBaseField) — today's
          // code falls through to the Data check next (which also fails
          // for a genuine primitive) and lands on the unresolved catch-all;
          // preserve that outcome directly.
          return unresolvedSchema();
        }
        return {
          schemaVersion: SCHEMA_VERSION,
          kind: 'typeAlias',
          targetId,
          title: alias.name,
          status: 'ready',
          fields: [
            {
              ...scalarField({ path: 'value', label: humanizeLabel(alias.name) }, builtinKind, basicTypeName),
              typeSymbol: `typeAlias:${targetId}`
            }
          ]
        };
      },
      // Enum alias (e.g. `typeAlias SideAlias: Side`) — new: buildTypeAliasSchema
      // previously had no enum handling at all, so this case always fell
      // through to the unresolved catch-all. Shaped by analogy to the
      // primitive-alias branch above (a single `value` field), reusing the
      // same enumValues mapping buildChoiceOptionField's/enumField's enum
      // branches already use for consistency.
      onEnum: (node) => ({
        schemaVersion: SCHEMA_VERSION,
        kind: 'typeAlias',
        targetId,
        title: alias.name,
        status: 'ready',
        fields: [
          {
            path: 'value',
            label: humanizeLabel(alias.name),
            typeSymbol: `typeAlias:${targetId}`,
            kind: 'enum',
            required: true,
            enumValues: node.enumValues.map((v) => ({
              value: v.name,
              label: v.display ?? humanizeLabel(v.name)
            }))
          }
        ]
      }),
      // Data-type alias — delegate field expansion to the underlying data type
      onData: (resolvedData, dataSourceUri) => {
        const sourceMap: PreviewSourceMapEntry[] = [];
        const { attributes, choiceAncestor } = collectInheritedAttributes(resolvedData);
        const attributeFields = attributes.map((attr) =>
          buildField(attr, {
            namespace,
            unsupportedFeatures,
            sourceMap,
            sourceUri: dataSourceUri,
            maxDepth: DEFAULT_MAX_DEPTH,
            depth: 0,
            path: attr.name,
            label: humanizeLabel(attr.name),
            seenTypes: new Set([qualifiedTypeId(resolvedData)]),
            cyclicTypes
          })
        );

        // Data-extends-Choice (round-5 finding #1), applied to a data-type alias:
        // mirrors buildDataSchema's expansion of a Choice ancestor's options into
        // top-level pseudo-fields — see that call site's comment for the full
        // rationale. On a name collision, the Data type's own attribute wins.
        const ownFieldPaths = new Set(attributeFields.map((field) => field.path));
        const choiceFields = choiceAncestor
          ? dropCollidingChoiceArmFields(
              choiceAncestor.attributes,
              (option, localUnsupportedFeatures) =>
                buildChoiceOptionField(option, {
                  namespace,
                  unsupportedFeatures: localUnsupportedFeatures,
                  sourceUri: dataSourceUri,
                  seenTypes: new Set([qualifiedTypeId(resolvedData), qualifiedTypeId(choiceAncestor)]),
                  depth: 0,
                  maxDepth: DEFAULT_MAX_DEPTH,
                  cyclicTypes
                }),
              ownFieldPaths,
              unsupportedFeatures
            )
          : [];

        const fields = [...choiceFields, ...attributeFields];
        return {
          schemaVersion: SCHEMA_VERSION,
          kind: 'typeAlias',
          targetId,
          title: alias.name,
          status: hasReportableUnsupportedFeature(unsupportedFeatures) ? 'unsupported' : 'ready',
          fields,
          ...(sourceMap.length > 0 ? { sourceMap } : {}),
          ...(unsupportedFeatures.size > 0 ? { unsupportedFeatures: Array.from(unsupportedFeatures).sort() } : {}),
          ...(choiceAncestor ? { choiceArmPaths: choiceFields.map((field) => field.path) } : {})
        };
      },
      // Choice alias (e.g. `typeAlias CollateralAlias: Collateral`) — new:
      // buildTypeAliasSchema previously had no Choice handling at all, so
      // this case always fell through to the unresolved catch-all too.
      // Mirrors buildChoiceSchema's own top-level Choice expansion (same
      // empty-choice guard, same buildChoiceOptionField mapping with a
      // fresh seenTypes seeded by the Choice's own id) — the alias just
      // forwards to the Choice's own arms, framed with `kind: 'typeAlias'`
      // (not `'choice'`) and this function's own targetId/title, with
      // `choiceArmPaths` set unconditionally since every field here IS a
      // Choice arm (mirrors the Data-extends-Choice branches' conditional
      // choiceArmPaths, just unconditional because there's no "own
      // attribute" here to combine with).
      onChoice: (node, choiceSourceUri) => {
        if (node.attributes.length === 0) {
          unsupportedFeatures.add(`empty-choice:${node.name}`);
          return {
            schemaVersion: SCHEMA_VERSION,
            kind: 'typeAlias',
            targetId,
            title: alias.name,
            status: 'unsupported',
            fields: [],
            unsupportedFeatures: Array.from(unsupportedFeatures).sort()
          };
        }
        const fields: PreviewField[] = node.attributes.map((option: ChoiceOption) =>
          buildChoiceOptionField(option, {
            namespace,
            unsupportedFeatures,
            sourceUri: choiceSourceUri,
            seenTypes: new Set([qualifiedTypeId(node)]),
            depth: 0,
            maxDepth: DEFAULT_MAX_DEPTH,
            cyclicTypes
          })
        );
        return {
          schemaVersion: SCHEMA_VERSION,
          kind: 'typeAlias',
          targetId,
          title: alias.name,
          status: hasReportableUnsupportedFeature(unsupportedFeatures) ? 'unsupported' : 'ready',
          fields,
          choiceArmPaths: fields.map((field) => field.path),
          ...(unsupportedFeatures.size > 0 ? { unsupportedFeatures: Array.from(unsupportedFeatures).sort() } : {})
        };
      },
      onUnresolved: () => unresolvedSchema()
    },
    sourceUri
  );
}

/**
 * Builds a FormPreviewSchema for a grammar-level Choice type.
 *
 * Each ChoiceOption becomes an 'object' or scalar field representing one
 * possible selection. The schema conveys that exactly one option must be
 * chosen (discriminated union).
 */
function buildChoiceSchema(
  choice: Choice,
  sourceUri: string,
  namespace: NamespaceIndex,
  targetId: string,
  cyclicTypes: ReadonlySet<string>,
  maxDepth = DEFAULT_MAX_DEPTH
): FormPreviewSchema {
  const unsupportedFeatures = new Set<string>();
  // Empty Choice (Codex review, PR #433 round 6): the Rune validator
  // permits a Choice with zero options (warning-only), but the real
  // emitted schema (zod-emitter.ts's emitChoiceSchema) is `z.never()` for
  // one — an uninhabited type that NO value can ever satisfy. Without this
  // guard, `fields`/`choiceArmPaths` would both come out empty and this
  // schema would read as a trivially-satisfiable `status: 'ready'` object
  // accepting `{}`, the opposite of the real "no valid value exists"
  // semantics. Mark unsupported instead of silently misrepresenting it.
  if (choice.attributes.length === 0) {
    unsupportedFeatures.add(`empty-choice:${choice.name}`);
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'choice',
      targetId,
      title: choice.name,
      status: 'unsupported',
      fields: [],
      unsupportedFeatures: Array.from(unsupportedFeatures).sort()
    };
  }
  const fields: PreviewField[] = choice.attributes.map((option: ChoiceOption) =>
    buildChoiceOptionField(option, {
      namespace,
      unsupportedFeatures,
      sourceUri,
      seenTypes: new Set([qualifiedTypeId(choice)]),
      depth: 0,
      maxDepth,
      cyclicTypes
    })
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'choice',
    targetId,
    title: choice.name,
    status: hasReportableUnsupportedFeature(unsupportedFeatures) ? 'unsupported' : 'ready',
    fields,
    ...(unsupportedFeatures.size > 0 ? { unsupportedFeatures: Array.from(unsupportedFeatures).sort() } : {})
  };
}

function buildChoiceOptionField(
  option: ChoiceOption,
  ctx: {
    namespace: NamespaceIndex;
    unsupportedFeatures: Set<string>;
    sourceUri: string;
    /**
     * Ambient field path to prefix this option's `path` (and its own
     * nested Data-type option `children`, built further below) with, for a
     * Choice ancestor expanded from a NESTED reference (e.g. `objectField`,
     * whose `children` live under `constituent.*`). Omitted by every
     * top-level call site (`buildChoiceSchema`, `buildDataSchema`,
     * `buildTypeAliasSchema`), all of which must keep producing a bare,
     * unprefixed `path`.
     */
    pathPrefix?: string;
    /**
     * Cycle-detection + recursion-depth state, threaded from the caller
     * (issue #394 fix, round 2). A Choice option's Data type can itself
     * reference — directly or transitively — the SAME Choice again; a real
     * CDM cycle hit exactly this and crashed with a stack overflow before
     * this fix. This function previously discarded whatever ambient state
     * the caller had and reset both to a fresh
     * `{seenTypes: new Set([resolvedData.name]), depth: 0}` for its own
     * nested Data-option expansion — the "doubly-nested" gap this doc
     * comment used to flag as a deferred follow-up. Every call site now
     * supplies real state instead of nothing.
     */
    seenTypes: Set<string>;
    depth: number;
    maxDepth: number;
    /** See FieldContext.cyclicTypes' doc comment — same whole-graph guard. */
    cyclicTypes: ReadonlySet<string>;
  }
): PreviewField {
  const typeRef = option.typeCall?.type?.ref;
  const refText = option.typeCall?.type?.$refText;

  // Resolve the option's label/path from the RESOLVED node's bare name,
  // falling back to the raw `$refText` only when unresolved — the same
  // precedence `zod-emitter.ts`'s `emitChoiceSchema` uses
  // (`optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? 'unknown'`).
  // A namespace-qualified reference (e.g. `other.ns.Cash`) resolves to a
  // typeRef whose bare `.name` is `Cash`; preferring `$refText` here
  // produced a mismatched key that couldn't round-trip against the real
  // emitted schema's `cash` key (issue #437).
  const optionTypeName = typeRef?.name ?? refText ?? 'unknown';
  const label = optionTypeName;
  const basePath = choiceOptionFieldName(optionTypeName);
  const path = ctx.pathPrefix ? `${ctx.pathPrefix}.${basePath}` : basePath;

  return resolvePreviewType(
    option.typeCall,
    ctx.namespace,
    {
      onPrimitive: (basicTypeName) => {
        const builtinKind = BUILTIN_KIND_MAP[basicTypeName];
        if (builtinKind) {
          return scalarField({ path, label }, builtinKind, basicTypeName, false);
        }
        // Unlike buildBaseField's onPrimitive, this function's ORIGINAL
        // builtin check had no distinct "resolved but unmapped" case of its
        // own — an unmapped primitive always fell through to the same
        // unresolved-reference catch-all below. Preserve that here.
        ctx.unsupportedFeatures.add(`unresolved-reference:${refText ?? label}`);
        return {
          path,
          label,
          kind: 'unknown',
          required: false,
          description: `Type reference ${refText ?? label} could not be resolved for form preview.`
        };
      },
      onEnum: (node) => ({
        path,
        label,
        kind: 'enum',
        required: false,
        enumValues: node.enumValues.map((v) => ({
          value: v.name,
          label: v.display ?? humanizeLabel(v.name)
        }))
      }),
      onChoice: (node, sourceUri) => {
        // A Choice option itself typed as another named Choice — mirrors
        // buildBaseField's own direct Choice-typed-attribute branch, just
        // threading THIS function's own cycle-safety state (seenTypes/
        // depth/cyclicTypes) through instead of a top-level FieldContext's,
        // so a cycle back to an ancestor Choice option is still caught.
        const childCtx: FieldContext = {
          namespace: ctx.namespace,
          unsupportedFeatures: ctx.unsupportedFeatures,
          sourceMap: [],
          sourceUri,
          maxDepth: ctx.maxDepth,
          depth: ctx.depth,
          path,
          label,
          seenTypes: ctx.seenTypes,
          cyclicTypes: ctx.cyclicTypes
        };
        // Every Choice option is `required: false` (only one arm may be
        // selected) — choiceField always returns `required: true`, so
        // override it, same as the primitive/enum/data branches above.
        return { ...choiceField(childCtx, node, sourceUri), required: false };
      },
      onData: (node, sourceUri) => {
        const resolvedDataId = qualifiedTypeId(node);
        if (ctx.cyclicTypes.has(resolvedDataId)) {
          ctx.unsupportedFeatures.add(`cyclic-type:${node.name}`);
        }
        if (ctx.seenTypes.has(resolvedDataId) || ctx.depth >= ctx.maxDepth) {
          return {
            path,
            label,
            kind: 'object',
            definitionId: resolvedDataId,
            referencedTypeFqn: resolvedDataId,
            children: [],
            required: false
          };
        }
        const nextSeen = new Set(ctx.seenTypes);
        nextSeen.add(resolvedDataId);
        const childCtx: FieldContext = {
          namespace: ctx.namespace,
          unsupportedFeatures: ctx.unsupportedFeatures,
          sourceMap: [],
          sourceUri,
          maxDepth: ctx.maxDepth,
          depth: ctx.depth + 1,
          path,
          label,
          seenTypes: nextSeen,
          cyclicTypes: ctx.cyclicTypes
        };
        const { attributes, choiceAncestor } = collectInheritedAttributes(node);
        const attributeChildren = attributes.map((child) =>
          buildField(child, {
            ...childCtx,
            path: `${path}.${child.name}`,
            label: humanizeLabel(child.name)
          })
        );

        // Doubly-nested Choice (Codex review, PR #433 round 5) — previously
        // a documented, deferred gap ("a Choice option whose Data type
        // itself extends a Choice"): a Choice option's Data type can itself
        // EXTEND another Choice, distinct from that Data type's own plain
        // attributes. Mirrors objectField's expansion of a choiceAncestor
        // exactly (same collision precedence, same choiceArmPaths contract)
        // so this level gets identical treatment to every other
        // Data-extends-Choice call site instead of silently dropping the
        // inherited arms — which would let a preview sample validate as
        // complete while the real emitted `runeExtendChoice` Zod schema
        // rejects it for missing the arm.
        const ownChildPaths = new Set(attributeChildren.map((child) => child.path));
        const choiceChildren = choiceAncestor
          ? (() => {
              const choiceSeen = new Set(nextSeen);
              choiceSeen.add(qualifiedTypeId(choiceAncestor));
              return dropCollidingChoiceArmFields(
                choiceAncestor.attributes,
                (choiceOption, localUnsupportedFeatures) =>
                  buildChoiceOptionField(choiceOption, {
                    namespace: ctx.namespace,
                    unsupportedFeatures: localUnsupportedFeatures,
                    sourceUri,
                    pathPrefix: path,
                    seenTypes: choiceSeen,
                    depth: ctx.depth + 1,
                    maxDepth: ctx.maxDepth,
                    cyclicTypes: ctx.cyclicTypes
                  }),
                ownChildPaths,
                ctx.unsupportedFeatures
              );
            })()
          : [];

        return {
          path,
          label,
          kind: 'object',
          required: false,
          children: [...choiceChildren, ...attributeChildren],
          ...(choiceAncestor ? { choiceArmPaths: choiceChildren.map((field) => field.path) } : {})
        };
      },
      onUnresolved: () => {
        ctx.unsupportedFeatures.add(`unresolved-reference:${refText ?? label}`);
        return {
          path,
          label,
          kind: 'unknown',
          required: false,
          description: `Type reference ${refText ?? label} could not be resolved for form preview.`
        };
      }
    },
    ctx.sourceUri
  );
}

function buildFunctionSchema(
  func: RosettaFunction,
  namespace: NamespaceIndex,
  targetId: string,
  cyclicTypes: ReadonlySet<string>,
  assignableTypes: ReadonlyMap<string, readonly string[]>
): FormPreviewSchema {
  const unsupportedFeatures = new Set<string>();
  const sourceMap: PreviewSourceMapEntry[] = [];

  const inputFields = functionInputs(func).map((attr) =>
    buildField(attr, {
      namespace,
      unsupportedFeatures,
      sourceMap,
      sourceUri: AstUtils.getDocument(attr).uri.toString(),
      maxDepth: DEFAULT_MAX_DEPTH,
      depth: 0,
      path: attr.name,
      label: humanizeLabel(attr.name),
      seenTypes: new Set(),
      cyclicTypes,
      assignableTypes
    })
  );
  const output = functionOutput(func);
  const functionOutputDescriptor = output
    ? resolveTypeCallTarget<FunctionPreviewOutput | undefined>(
        output.typeCall,
        namespace,
        {
          onPrimitive: () => undefined,
          onEnum: () => undefined,
          onData: (node) => ({
            typeFqn: qualifiedTypeId(node),
            kind: 'data',
            cardinality: toPreviewCardinality(decodeCardinality(output.card))
          }),
          onChoice: (node) => ({
            typeFqn: qualifiedTypeId(node),
            kind: 'choice',
            cardinality: toPreviewCardinality(decodeCardinality(output.card))
          }),
          onUnresolved: () => undefined
        },
        AstUtils.getDocument(output).uri.toString()
      )
    : undefined;

  const result = output
    ? buildField(output, {
        namespace,
        unsupportedFeatures,
        sourceMap,
        sourceUri: AstUtils.getDocument(output).uri.toString(),
        maxDepth: DEFAULT_MAX_DEPTH,
        depth: 0,
        path: output.name,
        label: humanizeLabel(output.name),
        seenTypes: new Set(),
        cyclicTypes,
        assignableTypes
      })
    : undefined;

  return {
    schemaVersion: SCHEMA_VERSION,
    targetId,
    title: func.name,
    kind: 'function',
    status: hasReportableUnsupportedFeature(unsupportedFeatures) ? 'unsupported' : 'ready',
    fields: inputFields,
    ...(result ? { result } : {}),
    ...(functionOutputDescriptor ? { functionOutput: functionOutputDescriptor } : {}),
    ...(sourceMap.length > 0 ? { sourceMap } : {}),
    ...(unsupportedFeatures.size > 0 ? { unsupportedFeatures: Array.from(unsupportedFeatures).sort() } : {})
  };
}

function buildField(attr: Attribute, ctx: FieldContext): PreviewField {
  addSourceMapEntry(ctx.sourceMap, ctx.path, attr, ctx.sourceUri);
  const base = buildBaseField(attr, ctx);
  const decoded = decodeCardinality(attr.card);
  const { lower } = decoded;
  const cardinality = getCardinality(decoded);

  if (isArrayCardinality(decoded)) {
    return {
      path: ctx.path,
      label: ctx.label,
      kind: 'array',
      required: lower > 0,
      cardinality,
      children: [asArrayItem(base, ctx)]
    };
  }

  return {
    ...base,
    required: lower > 0,
    ...(cardinality ? { cardinality } : {})
  };
}

/** Attach presentation identity through the same resolver used by every emitter. */
function resolvePreviewType(
  typeCall: TypeCall | undefined,
  namespace: NamespaceIndex,
  visitor: TypeResolutionVisitor<PreviewField>,
  sourceUri: string
): PreviewField {
  let aliasSymbol: string | undefined;
  const field = resolveTypeCallTarget(
    typeCall,
    namespace,
    {
      ...visitor,
      onAlias: (alias) => {
        aliasSymbol ??= `typeAlias:${qualifiedTypeId(alias)}`;
      },
      onPrimitive: (name) => ({ ...visitor.onPrimitive(name), typeSymbol: `builtin:${name}` }),
      onEnum: (node, uri) => ({ ...visitor.onEnum(node, uri), typeSymbol: `enum:${qualifiedTypeId(node)}` }),
      onData: (node, uri) => ({ ...visitor.onData(node, uri), typeSymbol: `data:${qualifiedTypeId(node)}` }),
      onChoice: (node, uri) => ({ ...visitor.onChoice(node, uri), typeSymbol: `choice:${qualifiedTypeId(node)}` })
    },
    sourceUri
  );
  return field.kind === 'unknown' ? field : { ...field, typeSymbol: aliasSymbol ?? field.typeSymbol };
}

function buildBaseField(attr: Attribute, ctx: FieldContext): PreviewField {
  return resolvePreviewType(
    attr.typeCall,
    ctx.namespace,
    {
      onPrimitive: (basicTypeName) => {
        const builtinKind = BUILTIN_KIND_MAP[basicTypeName];
        // A primitive that resolved but has no BUILTIN_KIND_MAP entry (e.g.
        // 'pattern'/'calculation', a pre-existing, unrelated gap) is NOT
        // reported as an unresolved reference — matching the pre-migration
        // behavior of the typeRef-resolved basic-type/record-type branches,
        // which returned `unsupportedField` directly without ever touching
        // `unsupportedFeatures`.
        return builtinKind ? scalarField(ctx, builtinKind, basicTypeName) : unsupportedField(ctx, basicTypeName);
      },
      onEnum: (node) => enumField(ctx, node),
      onData: (node, sourceUri) => objectField(ctx, node, sourceUri),
      // Choice type reference (issue #394): mirrors zod-emitter.ts's own W2
      // fix for resolveTypeExpr's `isChoice(typeRef)` branch ("was falling
      // to z.unknown() — isChoice was never consulted here") — the exact
      // same gap, never propagated to this hand-maintained preview
      // approximation. The real emitted schema (emitChoiceSchema) is
      // `z.union([z.strictObject({ <field>: <OptionSchema> }), ...])` — one
      // key per option, exactly one present — the SAME shape `choiceField`
      // below builds by reusing `buildChoiceOptionField`, the function that
      // already produces this shape for a genuine top-level Choice
      // (buildChoiceSchema) and a Data-extends-Choice ancestor's options
      // (objectField/buildDataSchema).
      onChoice: (node, sourceUri) => choiceField(ctx, node, sourceUri),
      onUnresolved: (refText) => {
        ctx.unsupportedFeatures.add(`unresolved-reference:${refText ?? attr.name}`);
        return unsupportedField(
          ctx,
          refText ? `Type reference ${refText} could not be resolved for form preview.` : undefined
        );
      }
    },
    ctx.sourceUri
  );
}

function unsupportedField(ctx: FieldContext, description?: string): PreviewField {
  return {
    path: ctx.path,
    label: ctx.label,
    kind: 'unknown',
    required: true,
    description: description ?? 'Unresolved type reference is not supported in form preview.'
  };
}

function scalarField(
  ctx: Pick<PreviewField, 'path' | 'label'>,
  kind: Extract<PreviewFieldKind, 'string' | 'number' | 'boolean'>,
  basicTypeName: string,
  required = true
): PreviewField {
  const format = temporalWireFormat(basicTypeName);
  return {
    path: ctx.path,
    label: ctx.label,
    kind,
    required,
    ...(format ? { format } : {})
  };
}

function enumField(ctx: FieldContext, enumNode: RosettaEnumeration): PreviewField {
  return {
    path: ctx.path,
    label: ctx.label,
    kind: 'enum',
    required: true,
    enumValues: enumNode.enumValues.map((value) => ({
      value: value.name,
      label: value.display ?? humanizeLabel(value.name)
    }))
  };
}

function objectField(ctx: FieldContext, data: Data, sourceUri: string): PreviewField {
  const dataId = qualifiedTypeId(data);
  // Cycle membership does not prevent the first occurrence from expanding.
  if (ctx.cyclicTypes.has(dataId)) {
    ctx.unsupportedFeatures.add(`cyclic-type:${data.name}`);
  }
  if (ctx.seenTypes.has(dataId) || ctx.depth >= ctx.maxDepth) {
    return {
      path: ctx.path,
      label: ctx.label,
      kind: 'object',
      definitionId: dataId,
      referencedTypeFqn: dataId,
      ...(ctx.assignableTypes?.get(dataId) ? { assignableTypeFqns: [...ctx.assignableTypes.get(dataId)!] } : {}),
      children: [],
      required: true
    };
  }

  const nextSeen = new Set(ctx.seenTypes);
  nextSeen.add(dataId);
  const { attributes, choiceAncestor } = collectInheritedAttributes(data);
  const attributeChildren = attributes.map((child) =>
    buildField(child, {
      ...ctx,
      sourceUri,
      depth: ctx.depth + 1,
      path: `${ctx.path}.${child.name}`,
      label: humanizeLabel(child.name),
      seenTypes: nextSeen
    })
  );

  // Data-extends-Choice (round-5 finding #1), applied to a NESTED attribute
  // reference: mirrors buildDataSchema's/buildTypeAliasSchema's expansion of
  // a Choice ancestor's options — see collectInheritedAttributes'
  // `choiceAncestor` doc comment for the full rationale — but with each
  // option field's `path` prefixed with the ambient `ctx.path` (via
  // `pathPrefix`) so it comes out as e.g. `constituent.commodity` instead of
  // a bare, top-level-only `commodity`. On a name collision, the Data type's
  // own attribute wins (same precedence as the other two call sites).
  const ownChildPaths = new Set(attributeChildren.map((child) => child.path));
  const choiceFields = choiceAncestor
    ? (() => {
        const choiceSeen = new Set(nextSeen);
        choiceSeen.add(qualifiedTypeId(choiceAncestor));
        return dropCollidingChoiceArmFields(
          choiceAncestor.attributes,
          (option, localUnsupportedFeatures) =>
            buildChoiceOptionField(option, {
              namespace: ctx.namespace,
              unsupportedFeatures: localUnsupportedFeatures,
              sourceUri,
              pathPrefix: ctx.path,
              seenTypes: choiceSeen,
              depth: ctx.depth + 1,
              maxDepth: ctx.maxDepth,
              cyclicTypes: ctx.cyclicTypes
            }),
          ownChildPaths,
          ctx.unsupportedFeatures
        );
      })()
    : [];

  return {
    path: ctx.path,
    label: ctx.label,
    kind: 'object',
    referencedTypeFqn: dataId,
    ...(ctx.assignableTypes?.get(dataId) ? { assignableTypeFqns: [...ctx.assignableTypes.get(dataId)!] } : {}),
    required: true,
    children: [...choiceFields, ...attributeChildren],
    // choiceArmPaths (round-10 finding B): mirrors buildDataSchema's/
    // buildTypeAliasSchema's top-level choiceArmPaths — see
    // FormPreviewSchema.choiceArmPaths' doc comment for the full
    // rationale — scoped to this object field's own children so
    // preview-validator.ts can enforce "exactly one arm present" for a
    // NESTED Data-extends-Choice reference too, not just a top-level one.
    ...(choiceAncestor ? { choiceArmPaths: choiceFields.map((field) => field.path) } : {})
  };
}

/**
 * Builds a PreviewField for a Choice-typed attribute (e.g. `attr:
 * SomeChoice (1..1)`) — as distinct from a Data type EXTENDING a Choice
 * (see `collectInheritedAttributes`'s `choiceAncestor` / `objectField`'s
 * expansion of it). Represented the same way `buildChoiceSchema` represents
 * a genuine top-level Choice target: an 'object' field whose `children` are
 * one field per `ChoiceOption` (via `buildChoiceOptionField`, so the field
 * `path`s and shapes match the real emitted schema exactly), with
 * `choiceArmPaths` listing all of them so `preview-validator.ts` can
 * enforce "exactly one arm present" — mirroring `FormPreviewSchema.
 * choiceArmPaths`'/`PreviewObjectField.choiceArmPaths`'s existing contract
 * for the Choice-ancestor case, just triggered by a direct type reference
 * instead of `extends`.
 */
function choiceField(ctx: FieldContext, choice: Choice, sourceUri: string): PreviewField {
  const choiceId = qualifiedTypeId(choice);
  if (ctx.cyclicTypes.has(choiceId)) {
    ctx.unsupportedFeatures.add(`cyclic-type:${choice.name}`);
  }
  if (ctx.seenTypes.has(choiceId) || ctx.depth >= ctx.maxDepth) {
    return {
      path: ctx.path,
      label: ctx.label,
      kind: 'object',
      definitionId: choiceId,
      referencedTypeFqn: choiceId,
      ...(ctx.assignableTypes?.get(choiceId) ? { assignableTypeFqns: [...ctx.assignableTypes.get(choiceId)!] } : {}),
      children: [],
      required: true
    };
  }

  // Empty Choice (Codex review, PR #433 round 6) — see buildChoiceSchema's
  // identical guard for the full rationale: the real emitted schema is
  // `z.never()` (uninhabited) for a zero-option Choice, so this field must
  // NOT read as a trivially-satisfiable required object accepting `{}`.
  if (choice.attributes.length === 0) {
    ctx.unsupportedFeatures.add(`empty-choice:${choice.name}`);
    return {
      path: ctx.path,
      label: ctx.label,
      kind: 'unknown',
      required: true,
      description: `Choice ${choice.name} has no options and can never be satisfied.`
    };
  }

  const nextSeen = new Set(ctx.seenTypes);
  nextSeen.add(choiceId);
  const children = choice.attributes.map((option) =>
    buildChoiceOptionField(option, {
      namespace: ctx.namespace,
      unsupportedFeatures: ctx.unsupportedFeatures,
      sourceUri,
      pathPrefix: ctx.path,
      seenTypes: nextSeen,
      depth: ctx.depth + 1,
      maxDepth: ctx.maxDepth,
      cyclicTypes: ctx.cyclicTypes
    })
  );

  return {
    path: ctx.path,
    label: ctx.label,
    kind: 'object',
    referencedTypeFqn: choiceId,
    ...(ctx.assignableTypes?.get(choiceId) ? { assignableTypeFqns: [...ctx.assignableTypes.get(choiceId)!] } : {}),
    required: true,
    children,
    choiceArmPaths: children.map((field) => field.path)
  };
}

function asArrayItem(field: PreviewField, ctx: FieldContext): PreviewField {
  const itemPath = `${ctx.path}[]`;
  if (field.kind === 'object') {
    // A `choice-arm-collision:<path>` diagnostic (issue #435) recorded
    // while building this subtree names the PRE-rewrite path (e.g.
    // `positions.constituent.cash`) — rewritePathPrefix only rewrites the
    // returned field tree, not `ctx.unsupportedFeatures`, so without this
    // the diagnostic would name a path that doesn't exist in the returned
    // schema (Codex review on PR #443).
    rewriteCollisionDiagnostics(ctx.unsupportedFeatures, ctx.path, itemPath);
    return rewritePathPrefix({ ...field, label: `${ctx.label} item`, required: true }, ctx.path, itemPath);
  }
  return {
    ...field,
    path: itemPath,
    label: `${ctx.label} item`,
    required: true
  };
}

/**
 * Rewrites any `choice-arm-collision:<path>` diagnostic in
 * `unsupportedFeatures` whose path is `oldPrefix` or nested under it, to
 * the equivalent path under `newPrefix` — the same prefix-match rule
 * `rewritePathPrefix` applies to the field tree itself, kept in sync so an
 * array-nested collision's diagnostic always names an existing path.
 */
function rewriteCollisionDiagnostics(unsupportedFeatures: Set<string>, oldPrefix: string, newPrefix: string): void {
  const marker = 'choice-arm-collision:';
  for (const entry of Array.from(unsupportedFeatures)) {
    if (!entry.startsWith(marker)) continue;
    const path = entry.slice(marker.length);
    if (path !== oldPrefix && !path.startsWith(`${oldPrefix}.`)) continue;
    unsupportedFeatures.delete(entry);
    unsupportedFeatures.add(`${marker}${newPrefix}${path.slice(oldPrefix.length)}`);
  }
}

/**
 * Recursively rewrites `field.path` — and, for an 'object' or 'array'
 * field, every descendant's `path` at ANY depth (through BOTH container
 * kinds) plus 'object' `choiceArmPaths` entries at every level — from
 * `oldPrefix` (or `oldPrefix.*`) form to `newPrefix` form.
 *
 * Used by `asArrayItem` to convert an array item's WHOLE subtree from
 * `parent.child.grandchild` to `parent[].child.grandchild`, not just its
 * immediate children. Codex review on PR #433:
 *   - round 2: the original one-level-only rewrite correctly updated a
 *     Choice arm's own path (e.g. `variant.commodity` →
 *     `variant[].commodity`) but left that arm's OWN nested attributes
 *     (e.g. a Data-typed arm's `variant.commodity.name`) untouched — a
 *     grandchild path pointing outside the rewritten array item's subtree
 *     entirely, making a Data-backed Choice arm's fields impossible to
 *     populate correctly. Fixed by recursing through 'object' fields.
 *   - round 3: that recursion still stopped at 'array' fields (e.g. a
 *     Data-typed Choice arm with its OWN nested array attribute,
 *     `variant.commodity.legs[]`) — rewriting the array field's own path
 *     but never descending into its single item field, leaving the deeper
 *     `[]`-suffixed descendant path stale. Recurses through both
 *     container kinds now.
 * This defect predates Choice support entirely (any sufficiently nested
 * structure inside an array would hit it), just newly exercised by the
 * Choice-array regression tests.
 */
function rewritePathPrefix(field: PreviewField, oldPrefix: string, newPrefix: string): PreviewField {
  const rewrite = (p: string): string =>
    p === oldPrefix || p.startsWith(`${oldPrefix}.`) ? newPrefix + p.slice(oldPrefix.length) : p;
  const path = rewrite(field.path);
  if (field.kind === 'array') {
    return {
      ...field,
      path,
      children: [rewritePathPrefix(field.children[0], oldPrefix, newPrefix)]
    };
  }
  if (field.kind !== 'object') {
    return { ...field, path };
  }
  return {
    ...field,
    path,
    children: field.children?.map((child) => rewritePathPrefix(child, oldPrefix, newPrefix)),
    ...(field.choiceArmPaths ? { choiceArmPaths: field.choiceArmPaths.map(rewrite) } : {})
  };
}

function isArrayCardinality(decoded: { lower: number; upper: number | null }): boolean {
  return decoded.upper === null || decoded.upper > 1;
}

function getCardinality(decoded: { lower: number; upper: number | null }): PreviewField['cardinality'] {
  const { lower, upper } = decoded;
  if (lower === 1 && upper === 1) return undefined;
  return {
    min: lower,
    max: upper === null ? 'unbounded' : upper
  };
}

function toPreviewCardinality(decoded: { lower: number; upper: number | null }): FunctionPreviewOutput['cardinality'] {
  return { min: decoded.lower, max: decoded.upper === null ? 'unbounded' : decoded.upper };
}

function addSourceMapEntry(
  sourceMap: PreviewSourceMapEntry[],
  fieldPath: string,
  attr: Attribute,
  sourceUri: string
): void {
  const start = attr.$cstNode?.range?.start;
  if (!sourceUri || !start) {
    return;
  }
  sourceMap.push({
    fieldPath,
    sourceUri,
    sourceLine: start.line + 1,
    sourceChar: start.character + 1
  });
}

/** Adapt plain form values to the generated function's metadata-bearing input contract. */
export function normalizePreviewInputs(
  documents: LangiumDocument[],
  targetId: string,
  inputs: Record<string, unknown>,
  wrappers: Record<FieldMetadataKind, (value: unknown) => unknown>
): Record<string, unknown> {
  const namespaces = buildNamespaceIndexes(documents);
  const namespace = namespaces.find(
    (entry) =>
      targetId.startsWith(`${entry.namespace}.`) && entry.funcByName.has(targetId.slice(entry.namespace.length + 1))
  );
  const func = namespace?.funcByName.get(targetId.slice(namespace.namespace.length + 1))?.node;
  if (!namespace || !func) throw new Error(`Function '${targetId}' has no input signature.`);
  const typeIndex = namespace;
  const activeValues = new Set<object>();

  function normalizeObject(value: unknown, fields: ReadonlyMap<string, (value: unknown) => unknown>): unknown {
    if (value == null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
      throw new Error('Expected an object in function preview inputs.');
    if (activeValues.has(value)) throw new Error('Cyclic function preview input values are not supported.');
    activeValues.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const normalize = fields.get(key);
          return [key, normalize ? normalize(child) : child];
        })
      );
    } finally {
      activeValues.delete(value);
    }
  }

  function attributeFields(attributes: readonly Attribute[]): Map<string, (value: unknown) => unknown> {
    return new Map(
      attributes.map((attr) => [
        attr.name,
        (value: unknown) => {
          if (value == null) return undefined;
          const kind = fieldMetadataKind(attr);
          const shape = kind ? metadataPayloadShape(attr.typeCall, typeIndex) : null;
          const normalizeItem = (item: unknown) => {
            if (item == null) return undefined;
            if (kind && isMetadataInputEnvelope(item, shape)) {
              return Object.prototype.hasOwnProperty.call(item, 'value')
                ? { ...item, value: normalizeType(attr.typeCall, item.value) }
                : { ...item };
            }
            const normalized = normalizeType(attr.typeCall, item);
            return kind ? wrappers[kind](normalized) : normalized;
          };
          return isArrayCardinality(decodeCardinality(attr.card)) && Array.isArray(value)
            ? value.map(normalizeItem)
            : normalizeItem(value);
        }
      ])
    );
  }

  function choiceFields(choice: Choice): Map<string, (value: unknown) => unknown> {
    return new Map(
      choice.attributes.map((option) => [
        choiceOptionFieldName(option.typeCall.type?.ref?.name ?? option.typeCall.type?.$refText ?? ''),
        (value: unknown) => normalizeType(option.typeCall, value)
      ])
    );
  }

  function normalizeType(typeCall: TypeCall | undefined, value: unknown): unknown {
    if (value == null) return undefined;
    return resolveTypeCallTarget(
      typeCall,
      typeIndex,
      {
        onPrimitive: () => value,
        onEnum: () => value,
        onData: (node) => {
          const { attributes, choiceAncestor } = collectInheritedAttributes(node);
          const fields = new Map([
            ...(choiceAncestor ? choiceFields(choiceAncestor) : []),
            ...attributeFields(attributes)
          ]);
          return normalizeObject(value, fields);
        },
        onChoice: (node) => normalizeObject(value, choiceFields(node)),
        onUnresolved: (name) => {
          throw new Error(`Cannot resolve function input type '${name}'.`);
        }
      },
      ''
    );
  }

  return normalizeObject(inputs, attributeFields(functionInputs(func))) as Record<string, unknown>;
}
