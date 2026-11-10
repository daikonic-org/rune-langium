// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type {
  Module,
  LangiumCoreServices,
  PartialLangiumCoreServices,
  LangiumSharedCoreServices,
  PartialLangiumSharedCoreServices,
  DefaultSharedCoreModuleContext
} from 'langium';
import { inject, createDefaultCoreModule, createDefaultSharedCoreModule, EmptyFileSystem } from 'langium';
import { RuneJsonSerializer } from '../serializer/rune-json-serializer.js';
import { RuneDslGeneratedModule, RuneDslGeneratedSharedModule } from '../generated/module.js';
import { RuneDslScopeProvider } from './rune-dsl-scope-provider.js';
import { RuneDslScopeComputation } from './rune-dsl-scope-computation.js';
import { RuneDslValidator } from './rune-dsl-validator.js';
import { createRuneDslParser } from './rune-dsl-parser.js';
import { RuneValueConverter } from './rune-value-converter.js';
import { RuneWorkspaceManager } from './rune-workspace-manager.js';
import { RuneDslIndexManager } from './rune-dsl-index-manager.js';
import { RuneDslLinker, type DeferredModelProvider } from './rune-dsl-linker.js';
export type { DeferredModelProvider } from './rune-dsl-linker.js';

/**
 * Shared services module that overrides Langium's default IndexManager with
 * `RuneDslIndexManager`, enabling external registration of exported symbols
 * without requiring a full document build (ADR 007 Phase 4).
 *
 * @category Core
 */
export const RuneDslSharedModule: Module<LangiumSharedCoreServices, PartialLangiumSharedCoreServices> = {
  workspace: {
    IndexManager: (services) => new RuneDslIndexManager(services),
    WorkspaceManager: (services) => new RuneWorkspaceManager(services)
  }
};

/**
 * Union type for all services available in the Rune DSL language.
 *
 * @remarks
 * Extends Langium's `LangiumCoreServices` with Rune DSL-specific implementations:
 * - `RuneDslParser` — text pre-processor for implicit bracket insertion
 * - `RuneDslScopeProvider` — qualified-name and namespace-aware scoping
 * - `RuneDslScopeComputation` — index population for cross-file resolution
 *
 * @category Core
 */
export type RuneDslServices = LangiumCoreServices & {
  serializer: { JsonSerializer: RuneJsonSerializer };
  references: { Linker: RuneDslLinker };
};

/**
 * Dependency-injection module for the Rune DSL language.
 *
 * @config
 * Registers all Rune DSL-specific service overrides into Langium's DI container:
 * - `parser.LangiumParser` → `RuneDslParser` (bracket pre-processor)
 * - `references.ScopeComputation` → `RuneDslScopeComputation`
 * - `references.ScopeProvider` → `RuneDslScopeProvider`
 *
 * @remarks
 * Pass this module as the last argument to `inject()` to override Langium defaults.
 * The module is intentionally minimal — the generated module (`RuneDslGeneratedModule`)
 * handles grammar-derived service wiring; this module only registers hand-written
 * overrides.
 *
 * @useWhen
 * - Constructing a custom Langium services container in tests or tooling
 * - Extending Rune DSL services with additional providers (e.g., custom formatters)
 *
 * @avoidWhen
 * - Using `createRuneDslServices()` directly — it already applies this module;
 *   double-injecting it will cause service registration conflicts.
 *
 * @category Core
 */
export const RuneDslModule = {
  serializer: { JsonSerializer: (services) => new RuneJsonSerializer(services) },
  parser: {
    LangiumParser: (services) => createRuneDslParser(services),
    ValueConverter: () => new RuneValueConverter()
  },
  references: {
    Linker: (services) => new RuneDslLinker(services),
    ScopeComputation: (services) => new RuneDslScopeComputation(services),
    ScopeProvider: (services) => new RuneDslScopeProvider(services)
  }
} satisfies Module<RuneDslServices, PartialLangiumCoreServices>;

/**
 * Create the full set of services required for the Rune DSL language.
 *
 * @remarks
 * This is the primary entry point for any non-LSP usage (scripts, tests, build tools).
 * It wires together:
 * - The generated Langium modules (`RuneDslGeneratedModule`, `RuneDslGeneratedSharedModule`)
 * - The hand-written overrides in `RuneDslModule`
 * - `RuneDslValidator` checks registered into the `ValidationRegistry`
 *
 * Services are initialized synchronously. The `ConfigurationProvider.initialized({})`
 * call stubs out LSP configuration so that non-LSP code paths do not hang waiting
 * for a client `workspace/configuration` response.
 *
 * @useWhen
 * - Building a Node.js script that parses or validates `.rosetta` files
 * - Writing unit tests for grammar rules or validators
 * - Constructing a `parseWorkspace()` pipeline outside of the LSP server
 *
 * @avoidWhen
 * - Inside the LSP server — use `createRuneLspServer()` which provides the full
 *   `LangiumServices` (LSP providers) instead of core-only services.
 * - When you need to share a service instance across multiple requests in a
 *   long-running server — the returned instance is not thread-safe for concurrent
 *   `DocumentBuilder.build()` calls; serialize builds with a queue.
 *
 * @pitfalls
 * - NEVER call `DocumentBuilder.build()` before `createRuneDslServices()` returns —
 *   the Langium index is not populated until services are fully constructed.
 * - NEVER reuse the same services instance across unrelated workspace contexts
 *   (e.g., two different CDM versions) — the index will conflate type names from
 *   both contexts and produce incorrect cross-reference resolution.
 * - The returned `shared` and `RuneDsl` services share an internal `ServiceRegistry`;
 *   do NOT register additional languages into the same `shared` for production use
 *   unless you understand Langium's multi-language scoping rules.
 *
 * @param context - Optional Langium file-system context. Defaults to `EmptyFileSystem`
 *   (in-memory only). Pass a `NodeFileSystem` context when resolving imports from disk.
 * @returns An object with `shared` (shared core services) and `RuneDsl` (language-specific services).
 *
 * @example
 * ```ts
 * import { createRuneDslServices } from '@rune-langium/core';
 * import { NodeFileSystem } from 'langium/node';
 *
 * // In-memory (for tests / scripts):
 * const { RuneDsl } = createRuneDslServices();
 *
 * // Disk-backed (for resolving imports from the file system):
 * const { RuneDsl: diskServices } = createRuneDslServices(NodeFileSystem);
 * ```
 *
 * @category Core
 */
export function createRuneDslServices(
  context: DefaultSharedCoreModuleContext = EmptyFileSystem,
  deferredProvider?: DeferredModelProvider
): {
  shared: LangiumSharedCoreServices;
  RuneDsl: RuneDslServices;
} {
  const shared = inject(createDefaultSharedCoreModule(context), RuneDslGeneratedSharedModule, RuneDslSharedModule);
  const RuneDsl = inject(createDefaultCoreModule({ shared }), RuneDslGeneratedModule, RuneDslModule, {
    references: {
      Linker: (services: LangiumCoreServices) => new RuneDslLinker(services, deferredProvider)
    }
  });
  shared.ServiceRegistry.register(RuneDsl);

  // Register validation checks
  const validator = new RuneDslValidator();
  validator.registerChecks(RuneDsl);

  // Initialize configuration for non-LSP usage
  shared.workspace.ConfigurationProvider.initialized({});

  return { shared, RuneDsl };
}
