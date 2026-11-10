// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratorOptions, GeneratorOutput, Target } from '../types.js';
import { createDiagnostic } from '../diagnostics.js';
import { emitNamespaceWithContract } from './namespace-emitter.js';
import type { NamespaceEmitterConstructor, WholeModelEmitter } from './namespace-emitter.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import type { NamespaceWalkResult } from './namespace-walker.js';
import type { LanguageProfile } from './language-profile.js';
import { collectNamespaceDependencies } from '@rune-langium/core';
import { topoSortComponents } from '../topo-sort.js';

export type ModelLayout = 'per-namespace' | 'barrel' | 'single-file';

/**
 * Parameterized `WholeModelEmitter` that wraps any `NamespaceEmitter`
 * plus a `LanguageProfile` (019 spec §3.2). Collapses the
 * "per-namespace then aggregate" pattern into one place so individual
 * targets only need to ship a NamespaceEmitter + a Profile.
 *
 * Dispatch flow:
 *   1. Call the inner `NamespaceEmitter` for each namespace with
 *      `suppressBoilerplate: true` so shared runtime helpers are
 *      emitted once via the Profile's sidecar, not duplicated
 *      across per-namespace files.
 *   2. Resolve the layout (defaults to `'barrel'` here — the
 *      library default of `'per-namespace'` is handled one layer up
 *      in `resolveEmitter` before reaching this class).
 *   3. For `'single-file'`: check the Profile's `singleFileLimits`,
 *      then call `concatenate()`. Emit a fatal diagnostic if exceeded.
 *   4. For `'barrel'`: emit per-namespace outputs + the Profile's
 *      barrel + the Profile's sidecars.
 */
export class GenericModelEmitter<T extends Target = Target> implements WholeModelEmitter {
  constructor(
    private readonly innerCtor: NamespaceEmitterConstructor,
    private readonly profile: LanguageProfile<T>
  ) {}

  async emit(
    walks: ReadonlyMap<string, NamespaceWalkResult>,
    registry: NamespaceRegistry,
    options: GeneratorOptions
  ): Promise<GeneratorOutput[]> {
    const targetBlock = this.readTargetBlock(options);
    const rawLayout = targetBlock?.layout ?? (this.profile.target === 'typescript' ? 'per-namespace' : 'barrel');

    // Copilot review on PR #166: validate the layout string instead of
    // an unchecked cast — an unexpected value (e.g. from a malformed
    // /api/codegen request body) used to be silently coerced to
    // 'barrel'. Now it surfaces a fatal `invalid-layout` diagnostic
    // that strict-mode callers turn into a GeneratorError.
    if (rawLayout !== 'barrel' && rawLayout !== 'single-file' && rawLayout !== 'per-namespace') {
      return [
        {
          relativePath: `${this.profile.target}-invalid-layout.error`,
          content: '',
          sourceMap: [],
          diagnostics: [
            createDiagnostic(
              'error',
              'invalid-layout',
              `Invalid layout '${rawLayout}' for target '${this.profile.target}'. Expected 'per-namespace', 'barrel', or 'single-file'.`
            )
          ],
          funcs: []
        }
      ];
    }
    return this.emitLayout(walks, registry, options, rawLayout);
  }

  protected emitLayout(
    walks: ReadonlyMap<string, NamespaceWalkResult>,
    registry: NamespaceRegistry,
    options: GeneratorOptions,
    layout: ModelLayout
  ): GeneratorOutput[] {
    // Step 1 — per-namespace emission with boilerplate suppressed.
    const perNs: GeneratorOutput[] = [];
    for (const walk of walks.values()) {
      perNs.push(emitNamespaceWithContract(walk, { ...options, suppressBoilerplate: true }, registry, this.innerCtor));
    }
    return this.assembleNamespaces(walks, registry, layout, perNs);
  }

  protected assembleNamespaces(
    walks: ReadonlyMap<string, NamespaceWalkResult>,
    registry: NamespaceRegistry,
    layout: ModelLayout,
    perNs: GeneratorOutput[]
  ): GeneratorOutput[] {
    perNs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    if (layout === 'single-file') {
      const dependencies = collectNamespaceDependencies([...new Set([...walks.values()].flatMap((walk) => walk.docs))]);
      const graph = {
        nodes: [...walks.keys()].sort(),
        edges: new Map([...dependencies].map(([name, deps]) => [name, [...deps]]))
      };
      const order = topoSortComponents(graph);
      perNs.sort((a, b) => order.indexOf(a.namespaces?.[0] ?? '') - order.indexOf(b.namespaces?.[0] ?? ''));
      return this.emitSingleFile(perNs, registry);
    }

    // 'barrel' or any future per-namespace+aggregation layout.
    const outputs: GeneratorOutput[] = [...perNs];
    const barrel = layout === 'barrel' ? this.profile.makeBarrel(perNs, registry) : undefined;
    if (barrel) outputs.push(barrel);
    outputs.push(...this.sharedArtifacts(perNs, registry));
    return outputs;
  }

  /**
   * Read the per-target option block for this profile's target.
   * Returns `undefined` if the caller didn't pass one.
   */
  private readTargetBlock(options: GeneratorOptions): { layout?: string } | undefined {
    return (options as unknown as Record<string, { layout?: string } | undefined>)[this.profile.target];
  }

  protected emitSingleFile(
    perNs: ReadonlyArray<GeneratorOutput>,
    registry: NamespaceRegistry,
    combined?: GeneratorOutput
  ): GeneratorOutput[] {
    const namespaces = [...new Set(perNs.flatMap((output) => output.namespaces ?? []))];
    const limits = this.profile.singleFileLimits;

    // Pre-flight size check before concatenation.
    if (limits) {
      const overage = this.checkLimits(perNs, limits, combined ? namespaces.length : perNs.length);
      if (overage) {
        return [
          {
            relativePath: `${this.profile.target}-single-file.error`,
            content: '',
            sourceMap: [],
            diagnostics: [createDiagnostic('error', 'single-file-too-large', overage)],
            funcs: []
          }
        ];
      }
    }

    const main = combined ?? this.profile.concatenate(perNs, registry);
    main.namespaces = namespaces;
    const sidecars = this.sharedArtifacts(perNs, registry);
    return sidecars.length > 0 ? [main, ...sidecars] : [main];
  }

  protected sharedArtifacts(perNs: ReadonlyArray<GeneratorOutput>, registry: NamespaceRegistry): GeneratorOutput[] {
    return this.profile.makeSharedArtifacts(perNs, registry).map((output) => ({ ...output, artifactRole: 'support' }));
  }

  private checkLimits(
    perNs: ReadonlyArray<GeneratorOutput>,
    limits: NonNullable<LanguageProfile<T>['singleFileLimits']>,
    namespaceCount: number
  ): string | undefined {
    if (limits.maxNamespaces !== undefined && namespaceCount > limits.maxNamespaces) {
      return `single-file layout exceeded max namespaces (${namespaceCount} > ${limits.maxNamespaces}) for target '${this.profile.target}'. Use 'barrel' or 'per-namespace' layout instead.`;
    }
    if (limits.maxBytes !== undefined) {
      // `TextEncoder` is portable across Node, browsers, and CF Workers;
      // `Buffer.byteLength` would crash in the Pages Function runtime.
      const encoder = new TextEncoder();
      const totalBytes = perNs.reduce(
        (sum, o) => sum + (o.binary?.byteLength ?? encoder.encode(o.content).byteLength),
        0
      );
      if (totalBytes > limits.maxBytes) {
        return `single-file layout exceeded max bytes (${totalBytes} > ${limits.maxBytes}) for target '${this.profile.target}'. Use 'barrel' or 'per-namespace' layout instead.`;
      }
    }
    return undefined;
  }
}
