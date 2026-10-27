// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { getEnumValues, getEnumValueLiteral } from '@rune-langium/core';

/**
 * SQL DDL target emitter (codegen-additional-targets §US2). One CREATE TABLE
 * per Data type with a surrogate BIGINT identity PK. Scalar attributes → typed
 * columns (NOT NULL when mandatory); enum-typed attributes → a text column with
 * a CHECK constraint (enumStrategy 'check', the default). Foreign keys, join
 * tables, and inheritance are layered in by later tasks. Dialect rendering is
 * delegated to sql-dialect.ts.
 */
import { type Data, type RosettaEnumeration, type RosettaTypeAlias, type TypeCall } from '@rune-langium/core';
import type { GeneratorOptions, GeneratorOutput, SqlOptions } from '../types.js';
import { emitNamespaceWithContract, type NamespaceEmitterOptions } from './namespace-emitter.js';
import type { NamespaceRegistry } from './namespace-registry.js';
import { getTargetRelativePath, type NamespaceWalkResult } from './namespace-walker.js';
import { dialectFor, type Dialect } from './sql-dialect.js';
import { BaseNamespaceEmitter, decodeCardinality } from './base-namespace-emitter.js';
import { resolveTypeCallTarget, toTypeIndexLookup, type TypeIndexLookup } from './type-ref-resolver.js';
import { debug } from '../instrument.js';

/** One attribute's resolved SQL modeling kind — FK column (Data), CHECK-constrained column (Enum), or a plain scalar column (builtin, possibly unresolved). */
type ResolvedAttrType =
  | { kind: 'data'; node: Data }
  | { kind: 'enum'; node: RosettaEnumeration }
  | { kind: 'scalar'; builtin: string | undefined; resolved: boolean };

export class SqlNamespaceEmitter extends BaseNamespaceEmitter {
  private readonly dialect: Dialect;
  private readonly inheritance: 'single-table' | 'table-per-type';
  private readonly enumStrategy: 'check' | 'table';
  private enumTableFallbackFlagged = false;
  private readonly statements: string[] = [];
  private readonly joinTables: string[] = [];
  private readonly relativePath: string;
  /** A real document URI — used as both the shared `sourceUri` for `toTypeIndexLookup`'s wrapped entries and `resolveTypeCallTarget`'s own `fallbackSourceUri` argument. Mirrors xsd-emitter.ts's identically-named field. */
  private readonly fallbackSourceUri: string;
  private readonly typeIndex: TypeIndexLookup;

  /** Collect enum value names including inherited members (cycle-safe, own first). */
  private static allEnumValueNames(enumNode: RosettaEnumeration): string[] {
    return getEnumValues(enumNode).map(getEnumValueLiteral);
  }

  /** SQL-escape + quote enum value literals for a CHECK (...) clause. */
  private static sqlEnumLiterals(names: readonly string[]): string {
    return names.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
  }

  constructor(
    model: NamespaceWalkResult,
    options: NamespaceEmitterOptions,
    registry: NamespaceRegistry = { namespaces: new Map() }
  ) {
    super(model, options, registry);
    const sql: SqlOptions = (options as GeneratorOptions).sql ?? {};
    this.dialect = dialectFor(sql.dialect ?? 'postgres');
    this.inheritance = sql.inheritance ?? 'table-per-type';
    this.enumStrategy = sql.enumStrategy ?? 'check';
    this.relativePath = getTargetRelativePath(model.namespace, 'sql');
    this.fallbackSourceUri = model.docs[0]?.uri?.toString() ?? '';
    this.typeIndex = toTypeIndexLookup(model, this.fallbackSourceUri);
  }

  /**
   * Resolve an attribute's `typeCall` to its SQL modeling kind, transparently
   * chasing any `RosettaTypeAlias` chain in between (replaces the old
   * `resolveAliasBuiltin` hand-rolled chain, which only ever chased down to a
   * basic-type name and never terminated on a Data/Enum target). A basic type
   * is always resolved: every `ROSETTA_BASIC_TYPE_NAMES` entry has a 1:1
   * match in both `POSTGRES_TYPES` and `SQLSERVER_TYPES` (sql-dialect.ts).
   */
  private resolveAttrType(typeCall: TypeCall | undefined): ResolvedAttrType {
    return resolveTypeCallTarget<ResolvedAttrType>(
      typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => ({
          kind: 'scalar',
          builtin: basicTypeName,
          resolved: this.dialect.isKnownBuiltin(basicTypeName)
        }),
        onEnum: (node) => ({ kind: 'enum', node }),
        onData: (node) => ({ kind: 'data', node }),
        // No pre-existing special Choice handling in this file (confirmed: it
        // never imported isChoice) — a Choice-typed attribute already fell
        // through to the unresolved-scalar fallback; preserve that exactly.
        onChoice: () => ({ kind: 'scalar', builtin: undefined, resolved: false }),
        onUnresolved: (refText) => ({ kind: 'scalar', builtin: refText, resolved: false })
      },
      this.fallbackSourceUri
    );
  }

  @debug()
  emitEnumeration(_e: RosettaEnumeration): void {
    // Enums render inline as CHECK constraints on referencing columns (enumStrategy 'check').
  }

  @debug()
  emitTypeAlias(_a: RosettaTypeAlias): void {
    // Type aliases collapse to their underlying column type at the use site.
  }

  @debug()
  emitData(data: Data): void {
    const q = (id: string) => this.dialect.quote(id);
    const fkType = this.dialect.fkColumnType();
    const cols: string[] = [];
    const constraints: string[] = [];

    const superRef = data.superType?.ref;
    if (superRef) {
      if (this.inheritance === 'single-table') {
        this.diagnostics.push({
          severity: 'info',
          code: 'sql-single-table-unsupported',
          message: `Inheritance 'single-table' is not yet supported for '${data.name}'; emitting table-per-type.`
        });
      }
      // table-per-type: the child's PK IS a foreign key to the parent (shared identity).
      cols.push(`${q('id')} ${fkType} PRIMARY KEY`);
      constraints.push(`FOREIGN KEY (${q('id')}) REFERENCES ${q(superRef.name)} (${q('id')})`);
      // A parent in ANOTHER namespace isn't declared in this per-namespace file, so
      // the FK dangles until the per-ns scripts are applied together (or via the
      // single-file bundle). Surface that rather than emitting a silently-broken FK.
      if (!this.model.dataByName.has(superRef.name)) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'sql-cross-namespace-extends',
          message: `'${data.name}' extends '${superRef.name}', which is not defined in namespace '${this.model.namespace}'; the parent-table FK resolves only when both namespaces' DDL is applied together.`
        });
      }
    } else {
      cols.push(this.dialect.pkColumn('id'));
    }

    // Generated identifiers (the surrogate `id` PK, `<attr>_id` FK columns) can
    // collide with user attribute names (e.g. `type Trade: id string`). Track used
    // column names per table and rename-on-collision (append `_`) with a warning,
    // rather than emitting a table with duplicate columns (invalid DDL).
    const usedCols = new Set<string>(['id']);
    const uniqueCol = (name: string): string => {
      if (!usedCols.has(name)) {
        usedCols.add(name);
        return name;
      }
      let candidate = `${name}_`;
      let n = 2;
      while (usedCols.has(candidate)) candidate = `${name}_${n++}`;
      usedCols.add(candidate);
      this.diagnostics.push({
        severity: 'warning',
        code: 'sql-column-collision',
        message: `Column '${name}' in '${data.name}' collides with an existing column (e.g. the surrogate 'id' PK); renamed to '${candidate}'.`
      });
      return candidate;
    };

    for (const attr of data.attributes) {
      const { lower, upper } = decodeCardinality(attr.card);
      const refText = attr.typeCall?.type?.$refText ?? '';
      const notNull = lower >= 1 ? ' NOT NULL' : '';
      const resolved = this.resolveAttrType(attr.typeCall);

      // Multi-valued → a separate join/child table (emitted after the owner tables).
      if (upper === null || upper > 1) {
        this.joinTables.push(this.buildJoinTable(data.name, attr.name, resolved));
        continue;
      }

      if (resolved.kind === 'data') {
        // Scalar reference to another type → FK column + table-level constraint.
        const fkCol = uniqueCol(`${attr.name}_id`);
        cols.push(`${q(fkCol)} ${fkType}${notNull}`);
        constraints.push(`FOREIGN KEY (${q(fkCol)}) REFERENCES ${q(resolved.node.name)} (${q('id')})`);
      } else if (resolved.kind === 'enum') {
        this.flagEnumTableFallback();
        const col = uniqueCol(attr.name);
        cols.push(`${q(col)} ${this.dialect.columnType('string')}${notNull}`);
        // Include inherited enum members; skip the CHECK entirely for a valueless
        // enum (CHECK (... IN ()) is invalid SQL in both dialects).
        const names = SqlNamespaceEmitter.allEnumValueNames(resolved.node);
        if (names.length > 0) {
          constraints.push(`CHECK (${q(col)} IN (${SqlNamespaceEmitter.sqlEnumLiterals(names)}))`);
        } else {
          this.flagEmptyEnum(resolved.node.name);
        }
      } else {
        if (!resolved.resolved) {
          this.diagnostics.push({
            severity: 'warning',
            code: 'unresolved-ref',
            message: `Attribute '${data.name}.${attr.name}': type '${refText || '<unknown>'}' did not resolve; emitting ${this.dialect.columnType('string')}.`
          });
        }
        const col = uniqueCol(attr.name);
        cols.push(`${q(col)} ${this.dialect.columnType(resolved.builtin || 'string')}${notNull}`);
      }
    }

    this.checkIdentLength(data.name);
    const body = [...cols, ...constraints].map((line) => `  ${line}`).join(',\n');
    this.statements.push(`CREATE TABLE ${q(data.name)} (\n${body}\n);`);
  }

  /**
   * A multi-valued attribute becomes its own table: an FK back to the owner
   * plus either an FK to the element type (Data) or a `value` column
   * (enum → CHECK; builtin → typed column).
   */
  private buildJoinTable(ownerName: string, attrName: string, resolved: ResolvedAttrType): string {
    const q = (id: string) => this.dialect.quote(id);
    const fkType = this.dialect.fkColumnType();
    const tableName = `${ownerName}_${attrName}`;
    this.checkIdentLength(tableName);
    const ownerFk = `${ownerName.toLowerCase()}_id`;
    const cols: string[] = [`${q(ownerFk)} ${fkType} NOT NULL`];
    const constraints: string[] = [`FOREIGN KEY (${q(ownerFk)}) REFERENCES ${q(ownerName)} (${q('id')})`];

    if (resolved.kind === 'data') {
      // Disambiguate the target FK from the owner FK. The first fallback (attr
      // name) still collides when the attr name equals the owner type name
      // (e.g. `type Node: node Node (0..*)`), so add a guaranteed-distinct
      // second fallback.
      let targetFk = `${resolved.node.name.toLowerCase()}_id`;
      if (targetFk === ownerFk) targetFk = `${attrName.toLowerCase()}_id`;
      if (targetFk === ownerFk) targetFk = `${attrName.toLowerCase()}_target_id`;
      cols.push(`${q(targetFk)} ${fkType} NOT NULL`);
      constraints.push(`FOREIGN KEY (${q(targetFk)}) REFERENCES ${q(resolved.node.name)} (${q('id')})`);
    } else if (resolved.kind === 'enum') {
      this.flagEnumTableFallback();
      cols.push(`${q('value')} ${this.dialect.columnType('string')} NOT NULL`);
      // Inherited members included; skip CHECK for a valueless enum (IN () is invalid).
      const names = SqlNamespaceEmitter.allEnumValueNames(resolved.node);
      if (names.length > 0) {
        constraints.push(`CHECK (${q('value')} IN (${SqlNamespaceEmitter.sqlEnumLiterals(names)}))`);
      } else {
        this.flagEmptyEnum(resolved.node.name);
      }
    } else {
      // Unresolved-scalar silence is existing behavior here — buildJoinTable
      // never reported a diagnostic for this branch pre-migration; preserved.
      cols.push(`${q('value')} ${this.dialect.columnType(resolved.builtin || 'string')} NOT NULL`);
    }

    const body = [...cols, ...constraints].map((line) => `  ${line}`).join(',\n');
    return `CREATE TABLE ${q(tableName)} (\n${body}\n);`;
  }

  /**
   * The `'table'` enum strategy (a lookup table + FK per enum) is not yet
   * implemented; we fall back to the `'check'` strategy. Surface that once
   * (not per enum column) as an info diagnostic so the option isn't silently
   * ignored — mirrors the `single-table` inheritance fallback.
   */
  private flagEnumTableFallback(): void {
    if (this.enumStrategy !== 'table' || this.enumTableFallbackFlagged) return;
    this.enumTableFallbackFlagged = true;
    this.diagnostics.push({
      severity: 'info',
      code: 'sql-enum-table-unsupported',
      message: `enumStrategy 'table' is not yet supported in namespace '${this.model.namespace}'; emitting CHECK constraints.`
    });
  }

  /**
   * A valueless enum (the grammar permits `enum Foo:` with no members) can't
   * produce a `CHECK (... IN (...))` clause — `IN ()` is invalid SQL — so we emit
   * the column without the CHECK and surface a warning rather than invalid DDL.
   */
  private flagEmptyEnum(enumName: string): void {
    this.diagnostics.push({
      severity: 'warning',
      code: 'sql-empty-enum',
      message: `Enum '${enumName}' has no values; emitting the column without a CHECK constraint.`
    });
  }

  /**
   * Flag table/join-table identifiers that exceed the dialect's limit (Postgres
   * silently truncates at 63 — which can cause collisions — and SQL Server
   * rejects past 128). We don't truncate (that risks collisions); we surface it.
   */
  private checkIdentLength(id: string): void {
    if (id.length > this.dialect.maxIdentifierLength) {
      this.diagnostics.push({
        severity: 'warning',
        code: 'sql-identifier-too-long',
        message: `Identifier '${id}' (${id.length} chars) exceeds the ${this.dialect.name} limit of ${this.dialect.maxIdentifierLength}; the engine may truncate or reject it.`
      });
    }
  }

  finalize(): GeneratorOutput {
    const header = `-- SQL DDL generated from namespace ${this.model.namespace} (${this.dialect.name})\n`;
    const all = [...this.statements, ...this.joinTables];
    const content = header + all.join('\n\n') + (all.length ? '\n' : '');
    return { relativePath: this.relativePath, content, sourceMap: [], diagnostics: this.diagnostics, funcs: [] };
  }
}

export function emitNamespace(
  model: NamespaceWalkResult,
  options: GeneratorOptions,
  registry: NamespaceRegistry = { namespaces: new Map() }
): GeneratorOutput {
  return emitNamespaceWithContract(model, options, registry, SqlNamespaceEmitter);
}
