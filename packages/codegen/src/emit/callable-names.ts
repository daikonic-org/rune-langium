// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isRosettaRule,
  isData,
  isAnnotation,
  type RosettaFunction,
  type RosettaExternalFunction,
  type RosettaRule
} from '@rune-langium/core';
import type { AstNode } from 'langium';
import type { NamespaceRegistry } from './namespace-registry.js';
import { RUNE_HELPER_NAMES } from '../helpers.js';

export type CallableDeclaration = RosettaFunction | RosettaExternalFunction | RosettaRule;

export function callableExportName(declaration: CallableDeclaration): string {
  return isRosettaRule(declaration)
    ? `${declaration.eligibility ? 'validate' : 'extract'}${declaration.name}`
    : declaration.name;
}

/** One name allocation shared by imports, calls, and bundled exports. */
export class CallableNames {
  private readonly functionExports = new Map<string, string>();
  private readonly annotationExports = new Map<string, string>();
  private readonly dataExports = new Map<string, string>();
  private readonly owners = new Map<string, Set<string>>();
  private readonly aliases = new Map<string, string>();
  private readonly scopedAliases = new Map<string, string>();
  private readonly reservedAliases: Set<string>;

  constructor(registry: NamespaceRegistry) {
    for (const [namespace, manifest] of registry.namespaces) {
      const typeNames = new Set([
        ...manifest.exportedDataNames,
        ...manifest.exportedEnumNames,
        ...manifest.exportedTypeAliasNames,
        ...manifest.exportedAnnotationNames
      ]);
      const helpers = new Set<string>(RUNE_HELPER_NAMES);
      const reserved = new Set([
        ...typeNames,
        ...manifest.exportedFuncNames,
        ...manifest.exportedLibraryFuncNames,
        ...helpers,
        ...[...manifest.exportedAnnotationNames].map((name) => `${name}Args`)
      ]);
      const allocate = (name: string, suffix: string, exports: Map<string, string>, companions: string[] = []) => {
        const base = `${name}${suffix}`;
        let exported = base;
        for (
          let count = 1;
          reserved.has(exported) || companions.some((suffix) => reserved.has(exported + suffix));
          count++
        )
          exported = `${base}${count}`;
        reserved.add(exported);
        for (const suffix of companions) reserved.add(exported + suffix);
        exports.set(`${namespace}.${name}`, exported);
      };
      for (const name of [...manifest.exportedFuncNames, ...manifest.exportedLibraryFuncNames].sort())
        if (typeNames.has(name) || helpers.has(name)) allocate(name, 'Function', this.functionExports);
      for (const name of [...manifest.exportedDataNames].sort())
        if (helpers.has(name)) allocate(name, 'Data', this.dataExports);
      for (const name of [...manifest.exportedAnnotationNames].sort())
        if (helpers.has(name)) allocate(name, 'Annotation', this.annotationExports, ['Args']);
      const names = new Set([
        ...[...manifest.exportedDataNames].map((name) => this.dataExported(namespace, name)),
        ...[...manifest.exportedDataNames].flatMap((name) => [`${name}Shape`, `is${name}`]),
        ...manifest.exportedEnumNames,
        ...[...manifest.exportedEnumNames].flatMap((name) => [`${name}Values`, `${name}DisplayNames`]),
        ...[...manifest.exportedFuncNames].map((name) => this.exported(namespace, name)),
        ...manifest.exportedTypeAliasNames,
        ...[...manifest.exportedAnnotationNames].map((name) => this.annotationExported(namespace, name)),
        ...[...manifest.exportedAnnotationNames].map((name) => `${this.annotationExported(namespace, name)}Args`),
        ...[...manifest.exportedLibraryFuncNames].map((name) => this.exported(namespace, name)),
        ...[...manifest.exportedRuleNames].flatMap((name) => [`extract${name}`, `validate${name}`]),
        ...(manifest.exportedRuleNames.size ? ['runeReportRules'] : [])
      ]);
      for (const name of names) {
        const owners = this.owners.get(name) ?? new Set<string>();
        owners.add(namespace);
        this.owners.set(name, owners);
      }
    }
    const reserved = new Set(this.owners.keys());
    for (const [name, owners] of [...this.owners].sort(([a], [b]) => a.localeCompare(b))) {
      for (const namespace of [...owners].sort()) {
        const base = `__rune$${namespace.replace(/[^\w$]/g, '$')}$${name}`;
        let alias = base;
        for (let suffix = 1; reserved.has(alias); suffix++) alias = `${base}_${suffix}`;
        reserved.add(alias);
        this.aliases.set(`${namespace}.${name}`, alias);
      }
    }
    this.reservedAliases = reserved;
  }

  exported(namespace: string, name: string): string {
    return this.functionExports.get(`${namespace}.${name}`) ?? name;
  }

  dataExported(namespace: string, name: string): string {
    return this.dataExports.get(`${namespace}.${name}`) ?? name;
  }

  annotationExported(namespace: string, name: string): string {
    return this.annotationExports.get(`${namespace}.${name}`) ?? name;
  }

  declarationExported(namespace: string, declaration: AstNode & { name: string }, name = declaration.name): string {
    if (isData(declaration)) return this.dataExported(namespace, name);
    if (isAnnotation(declaration)) {
      if (name === declaration.name) return this.annotationExported(namespace, name);
      if (name === `${declaration.name}Args`) return `${this.annotationExported(namespace, declaration.name)}Args`;
    }
    return name;
  }

  alias(namespace: string, name: string): string {
    return this.aliases.get(`${namespace}.${name}`) ?? name;
  }

  protectedAlias(namespace: string, name: string, scope: string): string {
    if (scope === namespace) return this.alias(namespace, name);
    const key = `${scope}\u0000${namespace}\u0000${name}`;
    const existing = this.scopedAliases.get(key);
    if (existing) return existing;
    const base = `${this.alias(namespace, name)}$in$${scope.replace(/[^\w$]/g, '$')}`;
    let alias = base;
    for (let suffix = 1; this.reservedAliases.has(alias); suffix++) alias = `${base}_${suffix}`;
    this.reservedAliases.add(alias);
    this.scopedAliases.set(key, alias);
    return alias;
  }

  bundled(namespace: string, name: string): string {
    return (this.owners.get(name)?.size ?? 0) > 1 ? this.alias(namespace, name) : name;
  }
}
