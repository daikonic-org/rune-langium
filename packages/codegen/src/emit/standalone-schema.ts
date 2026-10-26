// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { LangiumDocument } from 'langium';
import { isData, isChoice, isRosettaEnumeration, getFunctionInputs } from '@rune-langium/core';
import type { Data, Choice, RosettaEnumeration, RosettaTypeAlias } from '@rune-langium/core';
import { buildNamespaceIndexes, type NamespaceIndex } from '../preview-schema.js';
import { resolveTypeCallTarget, nodeSourceUri } from './type-ref-resolver.js';
import type { TypeIndexLookup, TypeIndexEntry, TypeResolutionVisitor } from './type-ref-resolver.js';
import { emitNamespace } from './zod-emitter.js';
import type { NamespaceWalkResult } from './namespace-walker.js';
import type { NamespaceEmitterOptions } from './namespace-emitter.js';
import { findCyclicTypes } from '../cycle-detector.js';
import type { TypeReferenceGraph } from '../cycle-detector.js';
import { topoSort } from '../topo-sort.js';
import type { GeneratorDiagnostic } from '../types.js';
import { RUNE_EXTEND_CHOICE_HELPER_JS_SOURCE } from './zod-runtime-helpers.js';

export interface ResolvedTarget {
  kind: 'data' | 'choice' | 'enum' | 'typeAlias';
  node: Data | Choice | RosettaEnumeration | RosettaTypeAlias;
  sourceUri: string;
}

function mergeIndexEntries<N>(
  target: Map<string, TypeIndexEntry<N>>,
  namespaceIndexes: readonly NamespaceIndex[],
  pick: (ns: NamespaceIndex) => ReadonlyMap<string, TypeIndexEntry<N>>
): void {
  for (const ns of namespaceIndexes) {
    for (const [name, entry] of pick(ns)) {
      if (!target.has(name)) target.set(name, entry);
    }
  }
}

/**
 * Merge every namespace's own index into one flat, bare-name-keyed
 * TypeIndexLookup spanning the whole loaded document set — Langium already
 * resolves cross-namespace `.ref`s at link time, so this index only backs
 * resolveTypeCallTarget's refText-fallback path, not primary resolution.
 */
export function buildGlobalTypeIndex(namespaceIndexes: readonly NamespaceIndex[]): TypeIndexLookup {
  const dataByName = new Map<string, TypeIndexEntry<Data>>();
  const enumByName = new Map<string, TypeIndexEntry<RosettaEnumeration>>();
  const choiceByName = new Map<string, TypeIndexEntry<Choice>>();
  const typeAliasByName = new Map<string, TypeIndexEntry<RosettaTypeAlias>>();
  mergeIndexEntries(dataByName, namespaceIndexes, (ns) => ns.dataByName);
  mergeIndexEntries(enumByName, namespaceIndexes, (ns) => ns.enumByName);
  mergeIndexEntries(choiceByName, namespaceIndexes, (ns) => ns.choiceByName);
  mergeIndexEntries(typeAliasByName, namespaceIndexes, (ns) => ns.typeAliasByName);
  return { dataByName, enumByName, choiceByName, typeAliasByName };
}

/**
 * Resolve a `${namespace}.${name}` targetId to its real AST node — mirrors
 * preview-schema.ts's own generatePreviewSchemas targetId matching (compute
 * each candidate's own qualified id and compare, rather than parsing the
 * targetId string apart, since namespaces are themselves dot-separated).
 *
 * A `name` present in a namespace's `duplicateDataNames`/`duplicateChoiceNames`
 * (two or more `Data`/`Choice` declarations sharing the same name in the
 * same namespace — a genuinely malformed corpus state) is skipped rather
 * than resolved to whichever declaration `dataByName`/`choiceByName`
 * happened to keep (the first one seen) — `generatePreviewSchemas` already
 * refuses to silently pick a winner for exactly this case
 * (`buildDuplicateTargetSchema`); this function does the same, surfacing as
 * `emitStandaloneZodSchema`'s `ambiguous-target` diagnostic rather than an
 * arbitrarily-chosen schema.
 */
export function findTargetNode(
  namespaceIndexes: readonly NamespaceIndex[],
  targetId: string
): ResolvedTarget | undefined {
  for (const ns of namespaceIndexes) {
    for (const [name, entry] of ns.dataByName) {
      if (`${ns.namespace}.${name}` === targetId) {
        if (ns.duplicateDataNames.has(name)) return undefined;
        return { kind: 'data', node: entry.node, sourceUri: entry.sourceUri };
      }
    }
    for (const [name, entry] of ns.choiceByName) {
      if (`${ns.namespace}.${name}` === targetId) {
        if (ns.duplicateChoiceNames.has(name)) return undefined;
        return { kind: 'choice', node: entry.node, sourceUri: entry.sourceUri };
      }
    }
    for (const [name, entry] of ns.enumByName) {
      if (`${ns.namespace}.${name}` === targetId) return { kind: 'enum', node: entry.node, sourceUri: entry.sourceUri };
    }
    for (const [name, entry] of ns.typeAliasByName) {
      if (`${ns.namespace}.${name}` === targetId)
        return { kind: 'typeAlias', node: entry.node, sourceUri: entry.sourceUri };
    }
  }
  return undefined;
}

export interface StandaloneClosure {
  dataByName: Map<string, Data>;
  choiceByName: Map<string, Choice>;
  enumByName: Map<string, RosettaEnumeration>;
  typeAliasByName: Map<string, RosettaTypeAlias>;
  docs: LangiumDocument[];
  diagnostics: GeneratorDiagnostic[];
}

type FrontierNode = Data | Choice | RosettaTypeAlias;

/**
 * Walk the transitive type-dependency closure of `target` — every Data,
 * Choice, Enum, and (only-if-the-target-itself) TypeAlias reachable via
 * attribute/option type calls and Data superType chains. `resolveTypeCallTarget`
 * already collapses RosettaTypeAlias chains down to their terminal kind, so
 * an alias reached via an attribute/option reference is never enqueued —
 * only the initial seed can ever land in typeAliasByName.
 */
export function computeStandaloneClosure(target: ResolvedTarget, globalIndex: TypeIndexLookup): StandaloneClosure {
  const dataByName = new Map<string, Data>();
  const choiceByName = new Map<string, Choice>();
  const enumByName = new Map<string, RosettaEnumeration>();
  const typeAliasByName = new Map<string, RosettaTypeAlias>();
  const docs = new Set<LangiumDocument>();
  const visited = new Set<Data | Choice | RosettaEnumeration | RosettaTypeAlias>();
  const frontier: FrontierNode[] = [];
  const diagnostics: GeneratorDiagnostic[] = [];

  const trackDoc = (node: { $container?: unknown }): void => {
    const withDoc = node as { $container?: { $document?: LangiumDocument } };
    const doc = withDoc.$container?.$document;
    if (doc) docs.add(doc);
  };

  // `computeStandaloneClosure`'s own maps, like `emitNamespace`'s
  // `NamespaceWalkResult` they feed into, are bare-name-keyed (ordinary
  // single-namespace usage has no collisions, and `emitNamespace` stays
  // UNMODIFIED per this module's design — it has no notion of qualifying a
  // schema name by namespace). A closure that transitively reaches two
  // DIFFERENT real namespaces' own same-named Data/Choice/Enum would
  // otherwise silently let the second-enqueued node overwrite the first in
  // the bare-name map — both real AST nodes are distinct (this function's
  // OWN `visited` set, keyed by object identity, enqueues each independently
  // once), but only ONE ends up with an actual `const <Name>Schema`
  // declaration in the synthesized script, while every consumer of EITHER
  // namespace's type still correctly resolves (via Langium's own `.ref`) to
  // its own real node and emits the same bare `<Name>Schema` reference —
  // silently validating one namespace's data against the OTHER namespace's
  // structurally different shape. Detected here and reported as an error
  // diagnostic; `emitStandaloneZodSchema` refuses to emit anything at all
  // once one is found (mirrors the `ambiguous-target` precedent — guessing
  // which namespace "wins" is worse than declining).
  //
  // The collision check is against ONE shared `emittedSchemaNames` map, not
  // each kind's own bare-name map separately: `emitNamespace` emits every
  // kind's schema as `export const <Name>Schema`, sharing ONE symbol
  // namespace across Data/Choice/Enum/typeAlias — `ns.a.Common` (an Enum)
  // and `ns.b.Common` (a Data) collide exactly as two same-kind `Common`s
  // would, and were previously invisible here since each kind's own map was
  // checked in isolation.
  const emittedSchemaNames = new Map<string, Data | Choice | RosettaEnumeration | RosettaTypeAlias>();
  const reportNameCollision = (kind: string, name: string): void => {
    diagnostics.push({
      severity: 'error',
      code: 'name-collision',
      message: `Two different namespaces in the closure each declare a '${kind}' named '${name}'; the synthesized script cannot distinguish them.`
    });
  };
  const claimSchemaName = (kind: string, node: Data | Choice | RosettaEnumeration | RosettaTypeAlias): boolean => {
    const existing = emittedSchemaNames.get(node.name);
    if (existing && existing !== node) {
      reportNameCollision(kind, node.name);
      return false;
    }
    emittedSchemaNames.set(node.name, node);
    return true;
  };

  const enqueue = (node: Data | Choice | RosettaEnumeration | RosettaTypeAlias): void => {
    if (visited.has(node)) return;
    visited.add(node);
    trackDoc(node);
    if (isData(node)) {
      if (claimSchemaName('Data', node)) dataByName.set(node.name, node);
      frontier.push(node);
    } else if (isChoice(node)) {
      if (claimSchemaName('Choice', node)) choiceByName.set(node.name, node);
      frontier.push(node);
    } else if (isRosettaEnumeration(node)) {
      if (claimSchemaName('Enum', node)) enumByName.set(node.name, node);
    } else {
      if (claimSchemaName('typeAlias', node)) typeAliasByName.set(node.name, node);
      frontier.push(node);
    }
  };

  const dependencyVisitor: TypeResolutionVisitor<void> = {
    onPrimitive: () => undefined,
    onEnum: (node) => enqueue(node),
    onData: (node) => enqueue(node),
    onChoice: (node) => enqueue(node),
    onUnresolved: () => undefined
  };

  enqueue(target.node);

  while (frontier.length > 0) {
    const node = frontier.shift()!;
    if (isData(node)) {
      // `node.superType` is the `Reference` object itself (present whenever
      // source wrote `extends X`); `.ref` is the RESOLVED target, `undefined`
      // when `X` doesn't resolve to anything. These are two different falsy
      // cases: no `extends` clause at all (`node.superType` itself absent)
      // vs. `extends X` written but `X` unresolved (`node.superType` present,
      // `.ref` undefined) — only the latter is a genuine corpus problem
      // worth a diagnostic; the closure walk silently omits the (nonexistent)
      // parent's attributes in both cases, since there is nothing to enqueue.
      if (node.superType && !node.superType.ref) {
        diagnostics.push({
          severity: 'warning',
          code: 'unresolved-ref',
          message: `Data '${node.name}': supertype '${node.superType.$refText}' is not resolved; inherited attributes are omitted`
        });
      }
      const superRef = node.superType?.ref;
      if (superRef) enqueue(superRef);
      for (const attr of node.attributes) {
        resolveTypeCallTarget(attr.typeCall, globalIndex, dependencyVisitor, nodeSourceUri(node, ''));
      }
    } else if (isChoice(node)) {
      for (const option of node.attributes) {
        resolveTypeCallTarget(option.typeCall, globalIndex, dependencyVisitor, nodeSourceUri(node, ''));
      }
    } else {
      // Only the initial seed (`target.node`) can ever reach this branch —
      // resolveTypeCallTarget already collapses any RosettaTypeAlias chain
      // reached via an attribute/option reference down to its terminal
      // kind, so an alias reached that way is never itself enqueued. A
      // dedicated onUnresolved (not the shared `dependencyVisitor`'s
      // no-op) reports when the REQUESTED target itself is a type alias
      // whose RHS doesn't resolve to anything — matches emitTypeAliasSchema's
      // own z.unknown() fallback (zod-emitter.ts), which previously had no
      // corresponding diagnostic here.
      resolveTypeCallTarget(
        node.typeCall,
        globalIndex,
        {
          ...dependencyVisitor,
          onUnresolved: (refText) => {
            diagnostics.push({
              severity: 'warning',
              code: 'unresolved-ref',
              message: refText
                ? `typeAlias '${node.name}': type '${refText}' is not resolved; emitting z.unknown()`
                : `typeAlias '${node.name}' has an unresolved type reference; emitting z.unknown()`
            });
          }
        },
        nodeSourceUri(node, '')
      );
    }
  }

  return { dataByName, choiceByName, enumByName, typeAliasByName, docs: Array.from(docs), diagnostics };
}

/**
 * Build the `Data`/`Choice` dependency graph for emit-order purposes, scoped
 * to exactly the closure's own members. `cycle-detector.ts`'s own
 * `buildTypeReferenceGraph` is NOT reused here: it reads `attr.typeCall?.type?.ref`
 * directly, so an attribute typed via a `RosettaTypeAlias` (the alias node
 * itself is neither `Data` nor `Choice`) produces no edge at all — silently
 * dropping exactly the dependency that determines correct `const` declaration
 * order in the synthesized script. Chasing every attribute/option/superType
 * through `resolveTypeCallTarget` (already used for closure discovery above)
 * fixes this without touching the shared `cycle-detector.ts`, which other
 * (non-alias-blind-sensitive) callers still rely on unchanged.
 */
function buildClosureReferenceGraph(closure: StandaloneClosure, globalIndex: TypeIndexLookup): TypeReferenceGraph {
  const nodes: string[] = [];
  const edges = new Map<string, string[]>();

  const ensureNode = (name: string): void => {
    if (!edges.has(name)) {
      nodes.push(name);
      edges.set(name, []);
    }
  };

  const addEdge = (from: string, to: string): void => {
    ensureNode(from);
    ensureNode(to);
    edges.get(from)!.push(to);
  };

  const dependencyVisitor = (from: string): TypeResolutionVisitor<void> => ({
    onPrimitive: () => undefined,
    onEnum: () => undefined,
    onData: (node) => addEdge(from, node.name),
    onChoice: (node) => addEdge(from, node.name),
    onUnresolved: () => undefined
  });

  for (const data of closure.dataByName.values()) {
    ensureNode(data.name);
    const superRef = data.superType?.ref;
    if (superRef) addEdge(data.name, superRef.name);
    for (const attr of data.attributes) {
      resolveTypeCallTarget(attr.typeCall, globalIndex, dependencyVisitor(data.name), nodeSourceUri(data, ''));
    }
  }

  for (const choice of closure.choiceByName.values()) {
    ensureNode(choice.name);
    for (const option of choice.attributes) {
      resolveTypeCallTarget(option.typeCall, globalIndex, dependencyVisitor(choice.name), nodeSourceUri(choice, ''));
    }
  }

  return { nodes, edges };
}

/**
 * Matches exactly the cross-namespace import lines `collectCrossNamespaceImports`
 * (zod-emitter.ts) emits — always a single line of the form
 * `import { Sym1, Sym2 } from '<path>.zod.js';`. It compares the REAL
 * namespace each referenced AST node's `$container` lives in against the
 * synthetic model's single `namespace` label, which can never match for a
 * closure spanning more than one real namespace — every such line is
 * necessarily wrong here (its target is, by construction of the closure,
 * ALREADY declared locally in this same script) and is stripped rather than
 * worked around by threading a "local" concept through zod-emitter.ts,
 * which this plan leaves unmodified.
 */
const CROSS_NAMESPACE_IMPORT_LINE = /^import \{[^}]*\} from '[^']*\.zod\.js';(\r?\n){0,2}/gm;

/**
 * Emit one target type's real Zod schema as a self-contained script — the
 * target's transitive closure (Task 2) assembled into a single synthetic
 * `NamespaceWalkResult` and rendered through the real, unmodified
 * `emitNamespace()` (zod target), never a hand-rolled approximation of it
 * (per the repo's DRY precept).
 *
 * The returned `code` is real TypeScript (types, `export`, and — for cyclic
 * types — an `interface` predeclaration all survive, unmodified), with two
 * exceptions: the spurious cross-namespace `import` lines described above
 * are stripped, since every symbol they'd reference is already declared
 * locally in this same script; and — only when the closure actually needs
 * it — a JS-safe `runeExtendChoice` definition (Data-extends-Choice
 * emission) is inlined right after the `import { z } from 'zod';` line,
 * since that helper is Zod-specific and therefore NOT part of the shared,
 * Zod-agnostic `RUNTIME_HELPER_JS_SOURCE` bundle the caller is expected to
 * prepend for everything else. External imports of `z` and `Temporal` are
 * preserved. Turning this into directly `new Function`-evaluable JavaScript
 * (erasing types/exports/interfaces/imports and binding `z` and `Temporal`)
 * is left to the caller, exactly as
 * `RUNTIME_HELPER_JS_SOURCE` is already caller-prepended rather than
 * bundled into this return value.
 *
 * Caveat inherited from `namespace-emitter.ts` (pre-existing there, not
 * introduced by this function): if `targetId` itself resolves to a
 * `RosettaTypeAlias` whose RHS is a `Data`/`Choice` (not a primitive or
 * `Enum`), the emitted alias `const` can reference its RHS `const` before
 * that RHS is declared — type aliases are always emitted before the
 * topo-sorted `Data`/`Choice` block, so evaluating the result throws a TDZ
 * `ReferenceError`. See `test/fixtures/type-aliases/data-ref/expected.zod.ts`
 * for the same defect in ordinary per-namespace output.
 *
 * A second, unrelated ordering hazard was found and FIXED directly in
 * `zod-emitter.ts` (not inherited/unfixed like the above): `topoSort`
 * always appends cyclic types LAST, after every non-cyclic type, regardless
 * of whether a non-cyclic type depends on one of them, and `zod-emitter.ts`
 * previously only wrapped a cyclic type's OWN schema declaration in
 * `z.lazy()`, never a reference TO it from elsewhere — confirmed to
 * reproduce in the REAL per-namespace `.zod.ts` output too, not specific to
 * standalone extraction. Fixed via `schemaRefExpr(name, ownerName)`, which
 * wraps a cross-declaration reference in `z.lazy()` while leaving
 * within-a-cycle references (self-references, mutual-cycle members) bare,
 * matching `test/us1-structural.test.ts`'s existing byte-identical golden
 * fixture; see `test/emit/zod-cyclic-reference-wrapping.test.ts` for full
 * coverage, including the related fix folding a cyclic parent's attributes
 * inline instead of `.extend()` (which `ZodLazy` doesn't support at all).
 *
 * A THIRD, separate, still-unfixed issue was found alongside this: a Data
 * extending a CROSS-namespace parent leaks that parent into the child
 * namespace's own `dataByName`/`emitOrder`, producing both a cross-ns
 * `import` AND a duplicate local re-declaration of the same schema name —
 * invalid ES module syntax regardless of cyclic-ness, reproducible against
 * the already-committed `test/fixtures/data-extends-data-crossns` fixture.
 * This is a `namespace-walker.ts`-level cross-namespace concern, unrelated
 * to cyclic ordering, and genuinely out of scope for this module — it is
 * NOT fixed here.
 */
export function emitStandaloneZodSchema(
  documents: LangiumDocument[],
  targetId: string,
  options: { functionInputs?: boolean; metadataInputs?: boolean } = {}
): { code: string; diagnostics: GeneratorDiagnostic[]; schemaName?: string } {
  const namespaceIndexes = buildNamespaceIndexes(documents);
  let target = options.functionInputs ? undefined : findTargetNode(namespaceIndexes, targetId);
  if (options.functionInputs) {
    for (const ns of namespaceIndexes) {
      for (const [name, entry] of ns.funcByName) {
        if (`${ns.namespace}.${name}` !== targetId) continue;
        // Reuse the Data emitter and dependency closure for the input object.
        // '$' cannot occur in a Rune declaration name, so this root cannot collide.
        const node: Data = {
          $type: 'Data',
          $container: entry.node.$container,
          name: '$Rune$FunctionInputs',
          attributes: getFunctionInputs(entry.node),
          annotations: [],
          conditions: [],
          references: [],
          synonyms: []
        };
        target = { kind: 'data', node, sourceUri: entry.sourceUri };
      }
    }
  }
  if (!target) {
    const ambiguousKind = namespaceIndexes.some((ns) =>
      Array.from(ns.duplicateDataNames).some((name) => `${ns.namespace}.${name}` === targetId)
    )
      ? 'Data'
      : namespaceIndexes.some((ns) =>
            Array.from(ns.duplicateChoiceNames).some((name) => `${ns.namespace}.${name}` === targetId)
          )
        ? 'Choice'
        : undefined;
    return {
      code: '',
      diagnostics: [
        ambiguousKind
          ? {
              severity: 'error',
              code: 'ambiguous-target',
              message: `Target '${targetId}' matches more than one '${ambiguousKind}' declaration in the loaded documents.`
            }
          : {
              severity: 'error',
              code: 'unknown-target',
              message: `Target '${targetId}' was not found in the loaded documents.`
            }
      ]
    };
  }

  const globalIndex = buildGlobalTypeIndex(namespaceIndexes);
  const closure = computeStandaloneClosure(target, globalIndex);

  // An error-severity closure diagnostic (currently only `name-collision`)
  // means the closure itself is unsound — e.g. two different namespaces
  // reached from `target` each declare a same-named Data/Choice/Enum, so
  // the bare-name-keyed synthetic model below cannot represent both.
  // Refuse to emit anything rather than silently picking a winner, mirroring
  // the `ambiguous-target` precedent above.
  if (closure.diagnostics.some((d) => d.severity === 'error')) {
    return { code: '', diagnostics: closure.diagnostics };
  }

  const graph = buildClosureReferenceGraph(closure, globalIndex);
  const cyclicTypes = findCyclicTypes(graph);
  const emitOrder = topoSort(graph, cyclicTypes);

  const syntheticModel: NamespaceWalkResult = {
    docs: closure.docs,
    namespace: '__standalone__',
    dataByName: closure.dataByName,
    enumByName: closure.enumByName,
    typeAliasByName: closure.typeAliasByName,
    choiceByName: closure.choiceByName,
    rulesByName: new Map(),
    reportsByName: new Map(),
    annotationsByName: new Map(),
    libraryFuncsByName: new Map(),
    emitOrder,
    cyclicTypes,
    graph
  };

  // `suppressBoilerplate: true` (the same knob `GenericModelEmitter` uses for
  // a shared whole-model bundle) makes `emitNamespace` emit an `import {
  // ... } from './runtime.zod.js'` line instead of INLINING the TypeScript
  // `RUNTIME_HELPER_SOURCE` block. That import line matches
  // CROSS_NAMESPACE_IMPORT_LINE's own `.zod.js'` shape, so it gets stripped
  // by the same regex below — leaving NEITHER an inlined helper block NOR a
  // broken import, exactly matching this function's documented contract
  // (the caller prepends `RUNTIME_HELPER_JS_SOURCE` separately). Without
  // this flag, the default (`{}`) inlines `RUNTIME_HELPER_SOURCE` into
  // `result.content`, which then collides with a caller's own prepended
  // `RUNTIME_HELPER_JS_SOURCE` — after type-erasure both declare the same
  // `const` helper names, and `new Function()` throws "Identifier has
  // already been declared".
  const emitOptions: NamespaceEmitterOptions = {
    suppressBoilerplate: true,
    functionInputs: options.functionInputs,
    metadataInputs: options.metadataInputs
  };
  const result = emitNamespace(syntheticModel, emitOptions, { namespaces: new Map() });
  const stripped = result.content.replace(CROSS_NAMESPACE_IMPORT_LINE, '');
  // `runeExtendChoice` backs Data-extends-Choice emission and is NOT part
  // of `RUNTIME_HELPER_JS_SOURCE` (that bundle is Zod-agnostic — shared
  // with the zero-Zod-dependency TypeScript target — so a `z`-typed helper
  // can't live there). `suppressBoilerplate: true` makes `emitNamespace`
  // emit `runeExtendChoice` as an IMPORT from './runtime.zod.js', which
  // the stripping above just removed along with the genuine cross-ns
  // imports (same '.zod.js' shape) — inlined directly here instead, so the
  // returned `code` stays self-contained for its own specific needs
  // without changing the documented "always prepend RUNTIME_HELPER_JS_SOURCE,
  // nothing else" caller contract. Conditional on actual use (`(` after
  // the name — the closure may reference other identifiers ending in
  // 'runeExtendChoice' in principle, but this codebase never generates
  // one) to avoid injecting dead code into the common case.
  const code = /\bruneExtendChoice\(/.test(stripped)
    ? stripped.replace(
        /^import \{ z \} from 'zod';\n/m,
        (header) => `${header}\n${RUNE_EXTEND_CHOICE_HELPER_JS_SOURCE}\n`
      )
    : stripped;
  return {
    code,
    diagnostics: [...closure.diagnostics, ...result.diagnostics],
    ...(options.functionInputs ? { schemaName: `${target.node.name}Schema` } : {})
  };
}
