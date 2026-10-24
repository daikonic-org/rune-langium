// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey, type DeclarationIdentity } from '@rune-langium/core';
import { previewTypeSymbol } from '../preview-references.js';
import type { FormPreviewSchema, PreviewField } from '../types.js';
export interface ProjectCodeListBinding {
  symbol: DeclarationIdentity;
  values?: readonly { value: string; label: string }[];
  unavailable?: string;
}
export interface ProjectImplementationBinding {
  symbol: DeclarationIdentity;
  invoke?: (args: readonly unknown[]) => unknown;
  unavailable?: string;
}
export class ProjectBindingUnavailable extends Error {}
/** Prepared data and installed callbacks only; this module never reads configuration or loads code. */
export function createProjectBindingRegistry(input: {
  codeLists?: readonly ProjectCodeListBinding[];
  implementations?: readonly ProjectImplementationBinding[];
}) {
  const codeLists = new Map<string, ProjectCodeListBinding>();
  const byType = new Map<string, ProjectCodeListBinding>();
  const implementations = new Map<string, ProjectImplementationBinding>();
  for (const binding of input.codeLists ?? []) {
    const key = declarationKey(binding.symbol);
    if (codeLists.has(key)) throw new ProjectBindingUnavailable('Ambiguous code-list binding: ' + key);
    const entry = structuredClone(binding);
    codeLists.set(key, entry);
    const type = previewTypeSymbol(binding.symbol.kind, binding.symbol.namespace + '.' + binding.symbol.name);
    if (!type) throw new ProjectBindingUnavailable('Unsupported code-list declaration kind: ' + binding.symbol.kind);
    byType.set(
      type,
      byType.has(type) ? { symbol: entry.symbol, unavailable: 'Ambiguous model identity for code list ' + type } : entry
    );
  }
  for (const binding of input.implementations ?? []) {
    const key = declarationKey(binding.symbol);
    if (implementations.has(key)) throw new ProjectBindingUnavailable('Ambiguous implementation binding: ' + key);
    implementations.set(key, { ...binding, symbol: { ...binding.symbol } });
  }
  const values = (binding: ProjectCodeListBinding) => {
    if (binding.unavailable || !binding.values)
      throw new ProjectBindingUnavailable(binding.unavailable ?? 'Code-list values are unavailable.');
    return binding.values;
  };
  function invokeByKey(key: string, args: readonly unknown[]) {
    const binding = implementations.get(key);
    if (!binding?.invoke || binding.unavailable)
      throw new ProjectBindingUnavailable(binding?.unavailable ?? 'Implementation binding is unavailable: ' + key);
    const result = binding.invoke(args);
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof Reflect.get(result, 'then') === 'function'
    ) {
      void Promise.resolve(result).catch(() => {});
      throw new ProjectBindingUnavailable(
        'Asynchronous providers are unsupported by synchronous Rune calls. Prepare their data before execution.'
      );
    }
    return result;
  }
  return {
    implementationSymbols: [...implementations.values()].map((binding) => ({ ...binding.symbol })),
    implementationStatus(targetId: string) {
      const matches = [...implementations.values()].filter(
        (binding) =>
          binding.symbol.kind === 'RosettaFunction' && binding.symbol.namespace + '.' + binding.symbol.name === targetId
      );
      if (!matches.length) return undefined;
      const models = new Set(matches.map((binding) => binding.symbol.model));
      const unavailable =
        models.size !== 1
          ? 'Ambiguous model identity for function ' + targetId
          : matches.find((binding) => binding.unavailable || !binding.invoke)?.unavailable;
      return { available: !unavailable && matches.every((binding) => Boolean(binding.invoke)), reason: unavailable };
    },
    codeList(symbol: DeclarationIdentity) {
      const binding = codeLists.get(declarationKey(symbol));
      return binding ? values(binding) : undefined;
    },
    codeListForType(type: string) {
      const binding = byType.get(type);
      return binding ? values(binding) : undefined;
    },
    validateCode(symbol: DeclarationIdentity, value: unknown) {
      const binding = codeLists.get(declarationKey(symbol));
      return binding && value !== undefined && value !== null && !values(binding).some((entry) => entry.value === value)
        ? { path: '', message: `Value '${String(value)}' is not in the configured code list.` }
        : undefined;
    },
    invokeByKey,
    invoke(symbol: DeclarationIdentity, args: readonly unknown[]) {
      return invokeByKey(declarationKey(symbol), args);
    }
  };
}
export type ProjectBindingRegistry = ReturnType<typeof createProjectBindingRegistry>;
/** Transform every finite definition too, so deferred object expansion uses the same choices. */
export function applyProjectPreviewBindings(
  schema: FormPreviewSchema,
  bindings: ProjectBindingRegistry
): FormPreviewSchema {
  const issues = new Set<string>();
  const field = (input: PreviewField): PreviewField => {
    if (input.kind === 'array') return { ...input, children: [field(input.children[0])] };
    if (input.kind === 'object') return { ...input, children: input.children.map(field) };
    if (input.typeSymbol)
      try {
        const values = bindings.codeListForType(input.typeSymbol);
        if (values) {
          if (
            input.kind !== 'string' &&
            !(
              input.kind === 'enum' &&
              values.every((value) => input.enumValues.some((original) => original.value === value.value))
            )
          )
            throw new ProjectBindingUnavailable('Code-list choices require a Rune string alias: ' + input.typeSymbol);
          return { ...input, kind: 'enum', enumValues: values.map((entry) => ({ ...entry })) };
        }
      } catch (error) {
        issues.add(error instanceof Error ? error.message : String(error));
      }
    return { ...input };
  };
  const fields = schema.fields.map(field);
  const definitions = schema.definitions
    ? Object.fromEntries(
        Object.entries(schema.definitions).map(([id, definition]) => [
          id,
          { ...definition, fields: definition.fields.map(field) }
        ])
      )
    : undefined;
  const result = schema.result ? field(schema.result) : undefined;
  const implementation = schema.kind === 'function' ? bindings.implementationStatus(schema.targetId) : undefined;
  const { executionUnavailable, ...base } = schema;
  return {
    ...base,
    ...(!implementation
      ? { executionUnavailable }
      : implementation.available
        ? {}
        : { executionUnavailable: implementation.reason ?? 'The configured implementation is unavailable.' }),
    fields,
    ...(definitions ? { definitions } : {}),
    ...(result ? { result } : {}),
    ...(issues.size
      ? { status: 'unsupported', unsupportedFeatures: [...(schema.unsupportedFeatures ?? []), ...issues] }
      : {})
  };
}
/** Resource constraints supplement the generated Rune validator; missing data is an availability error. */
export function validateProjectPreviewBindings(
  schema: FormPreviewSchema,
  data: unknown,
  bindings: ProjectBindingRegistry
): { path: string; message: string }[] {
  const diagnostics: { path: string; message: string }[] = [];
  const ancestors = new WeakSet<object>();
  const name = (field: PreviewField) => {
    const parts = field.path.split('.');
    return parts[parts.length - 1]!.replace(/\[\]$/, '');
  };
  const visit = (field: PreviewField, value: unknown, path: string): void => {
    if (value === undefined || value === null) return;
    if (field.kind === 'array') {
      if (Array.isArray(value)) value.forEach((entry, index) => visit(field.children[0], entry, `${path}[${index}]`));
      return;
    }
    if (field.kind === 'object') {
      if (typeof value !== 'object' || ancestors.has(value)) return;
      ancestors.add(value);
      const children = field.children.length
        ? field.children
        : (schema.definitions?.[field.definitionId ?? '']?.fields ?? []);
      for (const child of children) visit(child, Reflect.get(value, name(child)), path + '.' + name(child));
      ancestors.delete(value);
      return;
    }
    const values = field.typeSymbol ? bindings.codeListForType(field.typeSymbol) : undefined;
    if (values && !values.some((entry) => entry.value === value))
      diagnostics.push({ path, message: `Value '${String(value)}' is not in the configured code list.` });
  };
  if (data && typeof data === 'object')
    for (const field of schema.fields) visit(field, Reflect.get(data, name(field)), name(field));
  return diagnostics;
}

/** Names cannot collide with authored Rune identifiers and remain unique in single-file bundles. */
export function projectBindingNames(namespace: string) {
  const suffix = namespace.replace(/\./g, () => '$');
  return { invoke: '$rune$project$' + suffix, bind: '$rune$bindProject$' + suffix };
}
export function projectBindingHeader(namespace: string): string {
  const names = projectBindingNames(namespace);
  return `export function ${names.bind}(invoke: (key: string, args: readonly unknown[]) => unknown): void { if (${names.invoke} && ${names.invoke} !== invoke) throw new Error('This module is already bound to another project runtime.'); ${names.invoke} = invoke; }\nlet ${names.invoke}: ((key: string, args: readonly unknown[]) => unknown) | undefined;`;
}
/** Attach a prepared registry to a newly loaded generated module; no global registry crosses projects. */
export function bindGeneratedProjectModule(
  module: Readonly<Record<string, unknown>>,
  bindings: ProjectBindingRegistry
): void {
  for (const [name, value] of Object.entries(module))
    if (name.startsWith('$rune$bindProject$') && typeof value === 'function') value(bindings.invokeByKey);
}
