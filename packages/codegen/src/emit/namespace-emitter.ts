// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type {
  Annotation,
  Choice,
  Data,
  RosettaEnumeration,
  RosettaExternalFunction,
  RosettaRule,
  RosettaTypeAlias
} from '@rune-langium/core';
import type { GeneratorOptions, GeneratorOutput } from '../types.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import type { NamespaceWalkResult } from './namespace-walker.js';

/**
 * Options passed to a `NamespaceEmitter` constructor.
 *
 * Extends `GeneratorOptions` with one Phase-0.5 knob: `suppressBoilerplate`.
 * When true, the emitter must NOT inline shared runtime helpers (e.g.,
 * Zod's `runeCheckOneOf`, `runeCount`, `runeAttrExists`) in each per-
 * namespace output — the wrapping `GenericModelEmitter` emits them once
 * via the Profile's runtime sidecar instead. Default false; today's
 * behavior is preserved when this flag is unset.
 *
 * Emitters that have no runtime helpers (TypeScript, JSON Schema) may
 * ignore the flag — accepting it is enough to satisfy the contract.
 *
 * 019 spec §3.2.
 */
export interface NamespaceEmitterOptions extends GeneratorOptions {
  suppressBoilerplate?: boolean;
  /** Validate the adapted function input structure without evaluating Data conditions. */
  functionInputs?: boolean;
  /** Preserve metadata envelopes while retaining ordinary Data condition validation. */
  metadataInputs?: boolean;
}

export interface NamespaceEmitter {
  emitHeader?(): void;
  emitCrossNamespaceImports?(): void;
  emitAnnotation?(annotation: Annotation): void;
  emitAfterAnnotations?(): void;
  emitEnumeration(enumeration: RosettaEnumeration): void;
  emitTypeAlias(typeAlias: RosettaTypeAlias): void;
  emitDataPrelude?(): void;
  emitData(data: Data): void;
  /** W2: emit a `choice` declaration. Optional so non-Data/Choice targets (e.g. Excel) need not implement it. */
  emitChoice?(choice: Choice): void;
  emitRule?(rule: RosettaRule): void;
  emitReportMetadata?(): void;
  emitExternalFunction?(func: RosettaExternalFunction): void;
  emitFunctions?(): void;
  finalize(): GeneratorOutput;
}

export interface NamespaceEmitterConstructor {
  new (model: NamespaceWalkResult, options: NamespaceEmitterOptions, registry: NamespaceRegistry): NamespaceEmitter;
}

/**
 * Emitter contract for targets that consume the **entire model** as a
 * single input (rather than one namespace at a time). Used by targets
 * that need cross-namespace state — e.g. Excel produces one workbook
 * for the whole model with cross-sheet hyperlinks, GraphQL SDL
 * produces one schema file with the full type graph. SQL and Markdown
 * are per-namespace targets (see TARGET_DESCRIPTORS) — Copilot review
 * on PR #165 caught an earlier draft of this comment listing SQL as
 * whole-model.
 *
 * Returns one or more {@link GeneratorOutput} entries. Most whole-model
 * emitters return a single entry (the single artifact); the array
 * return type leaves room for emitters that want to split into
 * multiple files (e.g. an Excel emitter that produces both the
 * workbook AND a sidecar manifest).
 *
 * Async because binary emitters (ExcelJS) use stream APIs internally.
 * The Task 0.4 dispatch in `generator.ts` awaits this method.
 *
 * @see {@link isWholeModelEmitter} — runtime discriminator.
 * @see 018 Phase 0 Task 0.2.
 */
export interface WholeModelEmitter {
  emit(
    walks: ReadonlyMap<string, NamespaceWalkResult>,
    registry: NamespaceRegistry,
    options: GeneratorOptions
  ): Promise<GeneratorOutput[]>;
}

export interface WholeModelEmitterConstructor {
  new (): WholeModelEmitter;
}

/**
 * Runtime discriminator between the two emitter contracts. Distinguishes
 * by prototype shape: `NamespaceEmitter` exposes a `finalize()` method
 * (plus the per-element `emitData` / `emitEnumeration` / etc. hooks);
 * `WholeModelEmitter` exposes only a single async `emit()` method.
 *
 * Used by `generator.ts:runGenerate` (Task 0.4) to dispatch each
 * target through the appropriate pipeline.
 */
export function isWholeModelEmitter(
  c: NamespaceEmitterConstructor | WholeModelEmitterConstructor
): c is WholeModelEmitterConstructor {
  const proto = (c as { prototype?: Record<string, unknown> }).prototype;
  if (!proto) return false;
  return typeof proto.emit === 'function' && typeof proto.finalize !== 'function';
}

function sortedNames(map: ReadonlyMap<string, unknown>): string[] {
  return Array.from(map.keys()).sort();
}

export function emitNamespaceWithContract(
  model: NamespaceWalkResult,
  options: NamespaceEmitterOptions,
  registry: NamespaceRegistry,
  Emitter: NamespaceEmitterConstructor
): GeneratorOutput {
  const emitter = new Emitter(model, options, registry);

  emitter.emitHeader?.();
  emitter.emitCrossNamespaceImports?.();

  for (const name of sortedNames(model.annotationsByName)) {
    emitter.emitAnnotation?.(model.annotationsByName.get(name)!);
  }
  if (model.annotationsByName.size > 0) {
    emitter.emitAfterAnnotations?.();
  }

  for (const name of sortedNames(model.enumByName)) {
    emitter.emitEnumeration(model.enumByName.get(name)!);
  }

  for (const name of sortedNames(model.typeAliasByName)) {
    emitter.emitTypeAlias(model.typeAliasByName.get(name)!);
  }

  emitter.emitDataPrelude?.();

  // Data and Choice names are interleaved in one topo-sorted emitOrder (a
  // Choice must emit after its option types; a Data type referencing a
  // Choice attribute must emit after that Choice) — walk it once, dispatch
  // each name to whichever map it belongs to.
  const emittedData = new Set<string>();
  const emittedChoices = new Set<string>();
  for (const typeName of model.emitOrder) {
    const data = model.dataByName.get(typeName);
    if (data) {
      emittedData.add(typeName);
      emitter.emitData(data);
      continue;
    }
    const choice = model.choiceByName.get(typeName);
    if (choice) {
      emittedChoices.add(typeName);
      emitter.emitChoice?.(choice);
    }
  }

  for (const typeName of sortedNames(model.dataByName).filter((name) => !emittedData.has(name))) {
    emitter.emitData(model.dataByName.get(typeName)!);
  }

  for (const typeName of sortedNames(model.choiceByName).filter((name) => !emittedChoices.has(name))) {
    emitter.emitChoice?.(model.choiceByName.get(typeName)!);
  }

  for (const name of sortedNames(model.rulesByName)) {
    emitter.emitRule?.(model.rulesByName.get(name)!);
  }

  emitter.emitReportMetadata?.();

  for (const name of sortedNames(model.libraryFuncsByName)) {
    emitter.emitExternalFunction?.(model.libraryFuncsByName.get(name)!);
  }

  emitter.emitFunctions?.();

  return { ...emitter.finalize(), namespaces: [model.namespace] };
}
