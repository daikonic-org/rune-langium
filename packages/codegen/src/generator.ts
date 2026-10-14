// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { LangiumDocument } from 'langium';
import { isRosettaModel } from '@rune-langium/core';
import type { GeneratorOutput, GeneratorOptions, Target } from './types.js';
import { GeneratorError } from './types.js';
import { createDiagnostic, hasFatalDiagnostics } from './diagnostics.js';
import {
  emitNamespaceWithContract,
  type NamespaceEmitterConstructor,
  type WholeModelEmitterConstructor
} from './emit/namespace-emitter.js';
import { ZodNamespaceEmitter } from './emit/zod-emitter.js';
import { JsonSchemaNamespaceEmitter } from './emit/json-schema-emitter.js';
import { TsNamespaceEmitter } from './emit/ts-emitter.js';
import { SqlNamespaceEmitter } from './emit/sql-emitter.js';
import { OpenApiNamespaceEmitter } from './emit/openapi-emitter.js';
import { XsdNamespaceEmitter } from './emit/xsd-emitter.js';
import { buildNamespaceRegistry, type NamespaceRegistry } from './emit/namespace-registry.js';
import { walkNamespace, type NamespaceWalkResult } from './emit/namespace-walker.js';
import type { LanguageProfile } from './emit/language-profile.js';
import { GenericModelEmitter } from './emit/generic-model-emitter.js';
import { zodProfile } from './emit/zod-profile.js';
import { typescriptProfile } from './emit/typescript-profile.js';
import { jsonSchemaProfile } from './emit/json-schema-profile.js';
import { sqlProfile } from './emit/sql-profile.js';
import { ExcelWholeModelEmitter } from './emit/excel-emitter.js';
import {
  resolveExportSelection,
  unknownExportSelectionDiagnostics,
  type ResolvedExportSelection
} from './selection/declaration-selection.js';

// 019 spec §3.2 — two-registry dispatch.
//
// Each target lives in AT MOST one of:
//   - NAMESPACE_EMITTERS  → has a per-namespace emitter; will be used when
//                            options.<target>.layout === 'per-namespace'
//                            (the library default).
//   - WHOLE_MODEL_EMITTERS → has a hand-rolled WholeModelEmitter (Excel,
//                            GraphQL); used regardless of layout because
//                            the contract is whole-model only.
//   - PROFILES            → defines packaging metadata. Combined with a
//                            NAMESPACE_EMITTERS entry, the dispatch
//                            synthesizes a GenericModelEmitter wrapper
//                            for layouts other than 'per-namespace'.
//
// A target can appear in NAMESPACE_EMITTERS + PROFILES (Zod, TS, JSON
// Schema, SQL, Markdown) OR in WHOLE_MODEL_EMITTERS (Excel, GraphQL).
// Phase 0.5.1 ships the registries; Phase 0.5.2+ fills in PROFILES.
const NAMESPACE_EMITTERS: Partial<Record<Target, NamespaceEmitterConstructor>> = {
  zod: ZodNamespaceEmitter,
  'json-schema': JsonSchemaNamespaceEmitter,
  typescript: TsNamespaceEmitter,
  sql: SqlNamespaceEmitter,
  openapi: OpenApiNamespaceEmitter,
  xsd: XsdNamespaceEmitter
};

const WHOLE_MODEL_EMITTERS: Partial<Record<Target, WholeModelEmitterConstructor>> = {
  excel: ExcelWholeModelEmitter
  // Phase 3: graphql: GraphqlSdlEmitter
};

const PROFILES: Partial<Record<Target, LanguageProfile<Target>>> = {
  zod: zodProfile,
  typescript: typescriptProfile,
  'json-schema': jsonSchemaProfile,
  sql: sqlProfile
};

/**
 * The targets `runGenerate` can actually produce output for in this build.
 *
 * A target is "implemented" if any of:
 *   - it has a NAMESPACE_EMITTERS entry (covers per-namespace dispatch);
 *   - it has a WHOLE_MODEL_EMITTERS entry (covers hand-rolled whole-model);
 *   - it has a NAMESPACE_EMITTERS entry AND a PROFILES entry (covers
 *     synthesized whole-model dispatch).
 *
 * Phase 0/0.5.1 only registers the three per-namespace emitters, so this
 * resolves to ['zod', 'json-schema', 'typescript']. Phase 1/2/3 add to
 * the appropriate registry and this list updates automatically.
 *
 * 018 Phase 0 Task 0.7 follow-up; expanded in 019 Phase 0.5.1.
 */
export const IMPLEMENTED_TARGETS: readonly Target[] = Object.freeze(
  Array.from(
    new Set<Target>([
      ...(Object.keys(NAMESPACE_EMITTERS) as Target[]),
      ...(Object.keys(WHOLE_MODEL_EMITTERS) as Target[])
    ])
  )
);

/**
 * Library-default layout per target. The Pages Function (`/api/codegen`)
 * picks its own opinionated default separately by sending an explicit
 * `options.<target>.layout` in the request body — see 019 spec §10.1.
 *
 * Every per-namespace-capable target defaults to `'per-namespace'` here
 * so CLI / library consumers see no behavior change.
 */
const LIBRARY_DEFAULT_LAYOUT: Record<Target, string> = {
  zod: 'per-namespace',
  typescript: 'per-namespace',
  'json-schema': 'per-namespace',
  sql: 'per-namespace',
  markdown: 'per-namespace',
  excel: 'single-file', // no per-namespace meaning; this default is decorative
  graphql: 'single-file', // ditto
  openapi: 'per-namespace',
  xsd: 'per-namespace'
};

function resolveLayout(target: Target, options: GeneratorOptions): string {
  const block = (options as unknown as Record<string, { layout?: string } | undefined>)[target];
  return block?.layout ?? LIBRARY_DEFAULT_LAYOUT[target];
}

/**
 * Pick the emitter constructor for a (target, layout) pair (019 spec §3.2).
 *
 * Returns one of:
 *   - the registered `NamespaceEmitter` ctor when `layout === 'per-namespace'`;
 *   - the registered `WholeModelEmitter` ctor when one exists;
 *   - a synthesized `GenericModelEmitter` ctor that wraps the
 *     `NamespaceEmitter` + `LanguageProfile` for the requested target;
 *   - `undefined` when no dispatch path exists (caller emits the
 *     not-implemented diagnostic).
 */
function resolveEmitter(
  target: Target,
  options: GeneratorOptions
): NamespaceEmitterConstructor | WholeModelEmitterConstructor | undefined {
  const layout = resolveLayout(target, options);
  const nsCtor = NAMESPACE_EMITTERS[target];
  const wmCtor = WHOLE_MODEL_EMITTERS[target];
  const profile = PROFILES[target];

  // Per-namespace request — go through the namespace emitter if we have one.
  if (layout === 'per-namespace' && nsCtor) {
    return nsCtor;
  }

  // Hand-rolled whole-model emitter takes priority over the generic wrapper.
  if (wmCtor) {
    return wmCtor;
  }

  // Synthesize the generic wrapper when we have both a NamespaceEmitter and a Profile.
  // Bind the narrowed values to locals so the inner class can capture
  // non-undefined references without TS losing the narrowing.
  if (nsCtor && profile) {
    const innerCtor: NamespaceEmitterConstructor = nsCtor;
    const innerProfile: LanguageProfile<Target> = profile;
    return class SynthesizedWholeModelEmitter extends GenericModelEmitter<Target> {
      constructor() {
        super(innerCtor, innerProfile);
      }
    };
  }

  // No emitter found for the requested target + layout combination.
  // Return undefined so the top-level runGenerate emits a
  // `not-implemented` diagnostic that strict-mode callers can turn
  // into a GeneratorError (PR #166: avoids silently ignoring the
  // caller's `options.<target>.layout` setting).
  return undefined;
}

/**
 * Group Langium documents by their namespace name.
 * Documents without a parseable RosettaModel or without a namespace
 * are silently skipped.
 */
function groupByNamespace(docs: LangiumDocument[]): Map<string, LangiumDocument[]> {
  const groups = new Map<string, LangiumDocument[]>();

  for (const doc of docs) {
    const model = doc.parseResult?.value;
    if (!model || !isRosettaModel(model)) continue;

    const ns = typeof model.name === 'string' ? model.name : String(model.name ?? 'unknown');
    if (!ns) continue;

    // Normalize quoted namespace: "cdm.base.math" → cdm.base.math
    const normalizedNs = ns.replace(/^"|"$/g, '');

    const existing = groups.get(normalizedNs);
    if (existing) {
      existing.push(doc);
    } else {
      groups.set(normalizedNs, [doc]);
    }
  }

  return groups;
}

/**
 * Top-level orchestrator for the code generator.
 *
 * 019 Phase 0.5.1: dispatch now uses `resolveEmitter`, which picks
 * between a registered NamespaceEmitter, a registered WholeModelEmitter,
 * and a synthesized GenericModelEmitter wrapper based on the resolved
 * per-target layout option.
 *
 * @param docs - One or more parsed Langium documents.
 * @param options - Generator options.
 * @returns Model outputs followed by companion files, with deterministic paths within each group.
 * @throws GeneratorError when strict mode is enabled and any error diagnostic is produced.
 */
export async function runGenerate(
  docs: LangiumDocument[],
  options: GeneratorOptions,
  resolvedSelection?: ResolvedExportSelection
): Promise<GeneratorOutput[]> {
  if (docs.length === 0) {
    return [];
  }

  const target = options.target ?? 'zod';
  const emitterClass = resolveEmitter(target, options);

  let outputs: GeneratorOutput[];
  if (!emitterClass) {
    // Unknown / not-yet-implemented target. Falls through to the
    // strict-mode check below so `strict: true` callers still get the
    // GeneratorError they expect (Codex review on PR #165).
    outputs = [
      {
        relativePath: `${target}.unknown`,
        content: '',
        sourceMap: [],
        diagnostics: [createDiagnostic('error', 'not-implemented', `Target '${target}' is not implemented.`)],
        funcs: []
      }
    ];
  } else {
    const selectionResolution =
      resolvedSelection ?? (options.selection ? resolveExportSelection(docs, options.selection) : undefined);
    const unknownSelectionDiagnostics = selectionResolution
      ? unknownExportSelectionDiagnostics(selectionResolution)
      : [];
    if (unknownSelectionDiagnostics.length) {
      outputs = [
        {
          relativePath: `${target}.selection-error`,
          content: '',
          sourceMap: [],
          diagnostics: unknownSelectionDiagnostics.map((diagnostic) =>
            createDiagnostic('error', diagnostic.code, diagnostic.message)
          ),
          funcs: []
        }
      ];
    } else {
      // Group by namespace
      const emissionDocs = selectionResolution ? selectionResolution.documents : docs;
      const allByNamespace = groupByNamespace(emissionDocs);
      if (allByNamespace.size === 0) {
        return [];
      }

      // 019 §5.1/§5.3 — apply the optional namespace allowlist. Filtering
      // here (before registry-build + walk) means the registry only knows
      // about the kept namespaces, so import resolution stays scoped to the
      // emitted set. The caller passes a dependency-closed allowlist (the
      // modal's §5.2 cascade guarantees this), so no kept namespace imports
      // a dropped one. An unknown name in the allowlist is simply ignored.
      const allowlist = options.namespaces ? new Set(options.namespaces) : undefined;
      const byNamespace = allowlist
        ? new Map(Array.from(allByNamespace).filter(([ns]) => allowlist.has(ns)))
        : allByNamespace;
      if (byNamespace.size === 0) {
        return [];
      }

      // Build cross-namespace registry before per-namespace emission
      const registry: NamespaceRegistry = buildNamespaceRegistry(byNamespace);

      // Walk every namespace once. The walks are reused across both contract
      // types — WholeModelEmitter consumes the whole map, NamespaceEmitter
      // loops over individual entries.
      const walks = new Map<string, NamespaceWalkResult>();
      for (const [namespace, namespaceDocs] of byNamespace) {
        walks.set(namespace, walkNamespace(namespaceDocs, namespace));
      }

      // 019 §3.2 — registry membership disambiguates the contract; we
      // don't need a runtime discriminator here. The synthesized
      // GenericModelEmitter wrapper for (NamespaceEmitter + Profile) is
      // also a WholeModelEmitter so it lands in the same branch.
      const isWholeModelCtor =
        target in WHOLE_MODEL_EMITTERS ||
        (target in NAMESPACE_EMITTERS && target in PROFILES && resolveLayout(target, options) !== 'per-namespace');

      if (isWholeModelCtor) {
        outputs = await new (emitterClass as WholeModelEmitterConstructor)().emit(walks, registry, options);
      } else {
        outputs = [];
        for (const [, walked] of walks) {
          outputs.push(
            emitNamespaceWithContract(walked, options, registry, emitterClass as NamespaceEmitterConstructor)
          );
        }
      }

      outputs.sort(
        (a, b) =>
          Number(a.artifactRole === 'support') - Number(b.artifactRole === 'support') ||
          a.relativePath.localeCompare(b.relativePath)
      );
    }
  }

  // Strict mode: throw if any fatal diagnostics. Applies uniformly to
  // both the not-implemented short-circuit above and the normal
  // emit path.
  if (options.strict) {
    const allDiags = outputs.flatMap((o) => o.diagnostics);
    if (hasFatalDiagnostics(allDiags)) {
      throw new GeneratorError('Generation failed with errors', allDiags);
    }
  }

  return outputs;
}
