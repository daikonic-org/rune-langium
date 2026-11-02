// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Temporal } from '@js-temporal/polyfill';
import { withInstrumentation } from '@rune-langium/instrumentation-core';
import { transform } from 'sucrase';
import { z } from 'zod';
import type { LangiumDocument } from 'langium';
import {
  emitStandaloneZodSchema,
  RUNTIME_HELPER_JS_SOURCE,
  generateSelected,
  bindGeneratedProjectModule,
  adaptPreviewData,
  type GeneratorDiagnostic,
  type GeneratorOutput,
  type GeneratorOptions,
  type ProjectBindingRegistry
} from '@rune-langium/codegen/export';

export interface StandaloneValidatorResult {
  validator: z.ZodTypeAny | undefined;
  diagnostics: GeneratorDiagnostic[];
}

type ValidatorRuntimeOptions = {
  generatorOptions?: Pick<GeneratorOptions, 'projectBindings' | 'projectResources'>;
  bindings?: ProjectBindingRegistry;
  beforeGenerate?: (selection: Parameters<typeof generateSelected>[1]) => void;
};

/** Compile canonical schemas and load their condition functions in the ordinary generated module graph. */
export const compileStandaloneValidator = withInstrumentation(
  async function compileStandaloneValidator(
    documents: LangiumDocument[],
    typeFqn: string,
    functionInputs: boolean | 'metadata' = false,
    options: ValidatorRuntimeOptions = {}
  ): Promise<StandaloneValidatorResult> {
    const emitted = emitStandaloneZodSchema(
      documents,
      typeFqn,
      functionInputs === 'metadata' ? { metadataInputs: true } : { functionInputs }
    );
    const { code, diagnostics } = emitted;
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { validator: undefined, diagnostics };
    try {
      const functions: Record<string, (...args: unknown[]) => unknown> = {};
      if (emitted.functions?.length) {
        const selection = {
          namespaces: [],
          declarations: emitted.functions.map(({ namespace, name }) => ({ namespace, name, kind: 'RosettaFunction' }))
        };
        options.beforeGenerate?.(selection);
        const { outputs } = await generateSelected(documents, selection, {
          ...options.generatorOptions,
          target: 'typescript'
        });
        const modules = createGeneratedModuleLoader(outputs, options.bindings);
        for (const dependency of emitted.functions) {
          const targetId = `${dependency.namespace}.${dependency.name}`;
          const output = outputs.find(
            (output) => output.relativePath.replaceAll('/', '.').replace(/\.ts$/, '') === dependency.namespace
          );
          const func = output?.funcs.find((func) => func.name === dependency.name);
          if (!output || !func) throw new Error(`Condition function '${targetId}' was not emitted.`);
          const callable = modules.load(output.relativePath)[func.exportName ?? dependency.bindingName];
          if (typeof callable !== 'function') throw new Error(`Condition function '${targetId}' is not callable.`);
          const inputs = await compileStandaloneValidator(documents, targetId, true, options);
          if (!inputs.validator)
            throw new Error(inputs.diagnostics[0]?.message ?? `Cannot validate '${targetId}' inputs.`);
          const validator = inputs.validator;
          functions[dependency.bindingName] = (...args) => {
            const values = Object.fromEntries(func.parameterNames.map((name, index) => [name, args[index]]));
            const adapted = adaptPreviewData(documents, `${targetId}#RosettaFunction`, values);
            const checked = validator.parse(adapted.data) as Record<string, unknown>;
            return runInWorkerSandbox(
              '',
              '$rune$function',
              { callable, args: func.parameterNames.map((name) => checked[name]) },
              '$rune$function.callable(...$rune$function.args)',
              false
            );
          };
        }
      }
      const bindings = (emitted.functions ?? []).map(
        ({ bindingName }) => `const ${bindingName} = $rune$validator.functions[${JSON.stringify(bindingName)}];`
      );
      const javascript = transpileGeneratedTypeScript(code.replace(/^import .*;$/gm, ''), `${typeFqn}.zod.ts`);
      const schemaName = emitted.schemaName ?? `${typeFqn.slice(typeFqn.lastIndexOf('.') + 1)}Schema`;
      const validator = runInWorkerSandbox(
        `const z = $rune$validator.z;\nconst exports = {};\n${bindings.join('\n')}\n${javascript}`,
        '$rune$validator',
        { z, functions },
        `exports[${JSON.stringify(schemaName)}]`
      ) as z.ZodTypeAny;
      return { validator, diagnostics };
    } catch (error) {
      return {
        validator: undefined,
        diagnostics: [
          ...diagnostics,
          { severity: 'error', code: 'compile-error', message: error instanceof Error ? error.message : String(error) }
        ]
      };
    }
  },
  {
    op: 'compileStandaloneValidator',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);

/** Parse and erase TypeScript syntax without using a host module resolver. */
export const transpileGeneratedTypeScript = withInstrumentation(
  function transpileGeneratedTypeScript(tsCode: string, moduleName: string): string {
    try {
      return transform(tsCode, {
        transforms: ['typescript', 'imports'],
        filePath: moduleName,
        disableESTransforms: true
      }).code;
    } catch (error) {
      throw new Error(
        `Unable to transpile generated module '${moduleName}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  {
    op: 'transpileGeneratedTypeScript',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);

// ---------------------------------------------------------------------------
// Hardened `new Function(...)` execution — shared sandbox wrapper
// ---------------------------------------------------------------------------

/**
 * Runs `jsSource` (with the runtime-helper bundle prepended) inside
 * `new Function(...)`, evaluates `returnExpr` as the final statement, and
 * returns its result. `argValue` is bound to the parameter named `argName`
 * inside that source.
 *
 * The `new Function(...)` constructor evaluates the given source in a
 * dedicated module-level scope, but it is NOT a sandbox:
 * - Identifier shadowing (`fetch`, `WebSocket`, `XMLHttpRequest`, `importScripts`
 *   passed as params) prevents direct calls to those names from the evaluated
 *   code, but `globalThis.fetch` etc. remain reachable.
 * - Other Worker globals (`postMessage`, `self`, `addEventListener`) are not
 *   shadowed.
 * - This worker runs in a dedicated Web Worker context, so the blast radius is
 *   limited to that worker, but the evaluated code can still exfil via globalThis.
 * - For stronger isolation, rely on the Cloudflare Workers / browser CSP to
 *   block network egress at the runtime level.
 *
 * Shared by `executeFunction` (generated Rune func bodies) and the
 * `instance:validate` handler (condition predicates) — the single hardened-
 * execution path in this worker; do not add a second one.
 *
 * react-doctor false positive: this is `new Function`, not `eval`, but the rule
 * flags both. Disable comment preserved.
 */
export const runInWorkerSandbox = withInstrumentation(
  function runInWorkerSandbox(
    jsSource: string,
    argName: string,
    argValue: unknown,
    returnExpr: string,
    includeRuntimeHelpers = true
  ): unknown {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    // react-doctor-disable-next-line react-doctor/no-eval
    const wrapper = new Function(
      argName,
      'Temporal',
      'fetch',
      'WebSocket',
      'XMLHttpRequest',
      'importScripts',
      `${includeRuntimeHelpers ? `${RUNTIME_HELPER_JS_SOURCE}\n\n` : ''}${jsSource}\nreturn ${returnExpr};`
    );
    return wrapper(argValue, Temporal, undefined, undefined, undefined, undefined);
  },
  {
    op: 'runInWorkerSandbox',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);

interface GeneratedModuleRecord {
  exports: Record<string, unknown>;
}

interface GeneratedModuleRuntime {
  module: GeneratedModuleRecord;
  require: (specifier: string) => Record<string, unknown>;
}

function normalizeGeneratedModulePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function resolveGeneratedModulePath(importer: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    throw new Error(`Generated preview module '${importer}' requested unsupported dependency '${specifier}'.`);
  }
  const lastSlash = importer.lastIndexOf('/');
  const directory = lastSlash === -1 ? '' : importer.slice(0, lastSlash);
  const joined = normalizeGeneratedModulePath(`${directory}/${specifier}`);
  return joined.replace(/\.js$/, '.ts');
}

/** Evaluate generated modules with a require closure over generated outputs. */
export const createGeneratedModuleLoader = withInstrumentation(
  function createGeneratedModuleLoader(
    outputs: readonly GeneratorOutput[],
    bindings?: ProjectBindingRegistry
  ): {
    load: (relativePath: string) => Record<string, unknown>;
  } {
    const sources = new Map<string, string>();
    for (const output of outputs) {
      const path = normalizeGeneratedModulePath(output.relativePath);
      // Content is the complete emitted module. Snippets cannot resolve imports
      // or sibling calls and are therefore not a valid execution source.
      const source = output.content;
      if (source) sources.set(path, source);
    }
    const modules = new Map<string, GeneratedModuleRecord>();
    const imports = new Map<string, Record<string, unknown>>();

    // Generated imports are named bindings. Resolve them on property access so
    // a type-only dependency cycle cannot eagerly construct a child before its
    // parent module has published its classes.
    const importModule = (path: string): Record<string, unknown> => {
      let imported = imports.get(path);
      if (!imported) {
        imported = new Proxy(
          {},
          {
            get: (_target, key) => (key === '__esModule' ? true : Reflect.get(load(path), key)),
            has: (_target, key) => Reflect.has(load(path), key),
            ownKeys: () => Reflect.ownKeys(load(path)),
            getOwnPropertyDescriptor: (_target, key) => {
              const descriptor = Object.getOwnPropertyDescriptor(load(path), key);
              return descriptor ? { ...descriptor, configurable: true } : undefined;
            }
          }
        );
        imports.set(path, imported);
      }
      return imported;
    };

    const load = (relativePath: string): Record<string, unknown> => {
      const path = normalizeGeneratedModulePath(relativePath).replace(/\.js$/, '.ts');
      const existing = modules.get(path);
      if (existing) return existing.exports;
      const source = sources.get(path);
      if (source === undefined) throw new Error(`Generated preview module '${path}' was not emitted.`);

      const module: GeneratedModuleRecord = { exports: {} };
      // Cache before evaluation so generated recursive functions/modules can
      // observe the same CommonJS export object during a cycle.
      modules.set(path, module);
      const runtime: GeneratedModuleRuntime = {
        module,
        require: (specifier) =>
          specifier === '@js-temporal/polyfill'
            ? { Temporal }
            : importModule(resolveGeneratedModulePath(path, specifier))
      };
      const javascript = transpileGeneratedTypeScript(source, path);
      runInWorkerSandbox(
        `const exports = $rune$module.module.exports;\nconst require = $rune$module.require;\n${javascript}`,
        '$rune$module',
        runtime,
        '$rune$module.module.exports',
        false
      );
      if (bindings) bindGeneratedProjectModule(module.exports, bindings);
      return module.exports;
    };

    return { load };
  },
  {
    op: 'createGeneratedModuleLoader',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
