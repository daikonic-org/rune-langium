// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getEnumValues,
  isAsOperation,
  isSwitchCaseGuard,
  isSwitchOperation,
  isChoice,
  isAttribute,
  isChoiceOption,
  isRosettaFunction,
  isRosettaExternalFunction,
  isRosettaRule,
  isRosettaSymbolReference,
  isRosettaExpression,
  isRosettaConstructorExpression,
  isData,
  type Choice,
  type Condition,
  type Data,
  type Attribute,
  type RosettaEnumeration,
  type RosettaExpression,
  type RosettaCardinality,
  type RosettaTypeAlias,
  type RosettaRule,
  type RosettaReport,
  type Annotation,
  type RosettaExternalFunction,
  type TypeCall,
  getElementNamespace
} from '@rune-langium/core';
import { emittedTypeScriptProjection } from '../projection/typescript.js';
import type { EmittedProjection } from '../projection/types.js';
import { expressionIsMany, expressionType, featureIsMany, typeFeatures, resolveType } from '../expr/navigation.js';
import { expressionMetadataKind } from '../expr/metadata-type.js';
import { groupFuncDispatches, renderFuncDispatchGroup } from './func-dispatch.js';
import { AstUtils, isMultiReference, type AstNode } from 'langium';
import { renderFuncAssignment, renderAssignmentValue } from './func-assignment.js';
import { freshLocal } from '../expr/inline-function.js';
import { expressionFitsCardinality, renderCardinalityChecks } from '../expr/cardinality.js';
import { fieldMetadataKind, metadataType, hasFieldMetadata, hasTypeMetadata } from '../expr/metadata-runtime.js';

/**
 * TypeScript class target emitter for the Rune code generator.
 *
 * Entry point: emitNamespace(model, options) → GeneratorOutput
 *
 * FR-020 (full TS class shape, no Zod dependency), US5B acceptance scenarios 2–5, SC-005.
 * T104–T111 (Phase 8).
 *
 * Produces one *.ts module per namespace containing:
 *   - Inlined RUNTIME_HELPER_SOURCE (no `import { z }` — zero Zod dependency)
 *   - export interface <TypeName>Shape { ... }
 *   - export class <TypeName> implements <TypeName>Shape (or extends Parent)
 *   - static from(json: unknown): <TypeName> factory
 *   - export function is<TypeName>(x: unknown): x is <TypeName> type guard
 *   - export function is<Child>(x: <Parent>): x is <Child> discriminator predicates
 *   - validate<ConditionName>(): { valid: boolean; errors: string[] } instance methods
 *   - export function declarations for Rune functions
 */

import type {
  GeneratorOptions,
  GeneratorOutput,
  SourceMapEntry,
  GeneratorDiagnostic,
  GeneratedFunc
} from '../types.js';
import { resolveImportPath, type NamespaceRegistry } from './namespace-registry.js';
import { emitNamespaceWithContract, type NamespaceEmitterOptions } from './namespace-emitter.js';
import {
  BaseNamespaceEmitter,
  decodeCardinality,
  buildAttributeTypesMap,
  buildAttrAccessorNamesMap,
  activeConditions,
  mergeProfileTypeMaps,
  buildReportRulesLines,
  buildCrossNsImportLines,
  choiceOptionFieldName
} from './base-namespace-emitter.js';
import { getTargetRelativePath, type NamespaceWalkResult } from './namespace-walker.js';
import { debug } from '../instrument.js';
import { runtimeHelperSource, buildRuntimeHelperImportLine } from '../helpers.js';
import {
  attrAccessExpr,
  transpileCondition,
  transpileExpression,
  renderTranspiledSwitch,
  type ExpressionTranspilerContext
} from '../expr/transpiler.js';
import {
  typescriptProfile,
  TS_LIBRARY_RUNTIME_SOURCE,
  TS_RUNTIME_SIDECAR_PATH,
  typescriptHelperModuleName
} from './typescript-profile.js';

import { TYPESCRIPT_RESERVED_NAMES } from './typescript-names.js';
import { CallableNames, callableExportName, type CallableDeclaration } from './callable-names.js';
import { resolveTypeCallTarget, toTypeIndexLookup, type TypeIndexLookup } from './type-ref-resolver.js';
import {
  extractFuncs,
  functionInputs,
  functionOutput,
  buildFuncCallGraph,
  findCyclicFuncs,
  topoSortFuncs,
  resolveFuncTypeTs,
  resolveFuncValueTypeTs,
  type RuneFunc,
  type RuneFuncAssignment,
  type RuneFuncAlias,
  type FuncBodyContext
} from '../types/func.js';

// ---------------------------------------------------------------------------
// Internal emission context
// ---------------------------------------------------------------------------

interface EmissionContext {
  target: 'typescript';
  emitOrder: readonly string[];
  lazyTypes: ReadonlySet<string>;
  sourceMap: SourceMapEntry[];
  diagnostics: GeneratorDiagnostic[];
  namespace: string;
  dataByName: ReadonlyMap<string, Data>;
  enumByName: ReadonlyMap<string, RosettaEnumeration>;
  choiceByName: ReadonlyMap<string, Choice>;
  typeAliasByName: ReadonlyMap<string, RosettaTypeAlias>;
  rulesByName: ReadonlyMap<string, RosettaRule>;
  reportsByName: ReadonlyMap<string, RosettaReport>;
  annotationsByName: ReadonlyMap<string, Annotation>;
  libraryFuncsByName: ReadonlyMap<string, RosettaExternalFunction>;
  registry: NamespaceRegistry;
  /** Merged builtin type map from the TS profile (basicTypeMap ∪ recordTypeMap ∪ typeAliasMap). */
  builtinTypeMap: Readonly<Record<string, string>>;
  /** JS typeof strings for scalar builtin types (for type-guard generation). */
  typeofMap: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Built-in type maps (derived from typescriptProfile at module load)
// ---------------------------------------------------------------------------

const TS_BUILTIN_TYPE_MAP: Readonly<Record<string, string>> = mergeProfileTypeMaps(typescriptProfile) as Record<
  string,
  string
>;

/**
 * Derive a JS typeof string for each TS type expression.
 * - 'boolean' → 'boolean'
 * - 'number' → 'number'
 * - 'string' and string aliases → 'string'
 * - Temporal.* types → 'object'
 *
 * Used for type-guard checks. T108.
 */
function buildTsTypeofMap(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, tsType] of Object.entries(TS_BUILTIN_TYPE_MAP)) {
    if (tsType === 'boolean') result[key] = 'boolean';
    else if (tsType === 'number') result[key] = 'number';
    else if (typeof tsType === 'string' && tsType.startsWith('Temporal.')) result[key] = 'object';
    else result[key] = 'string';
  }
  return result;
}

const TS_TYPEOF_MAP: Readonly<Record<string, string>> = buildTsTypeofMap();

// ---------------------------------------------------------------------------
// Emission context constructor helper
// ---------------------------------------------------------------------------

function buildEmissionContext(
  model: NamespaceWalkResult,
  registry: NamespaceRegistry,
  diagnostics: GeneratorDiagnostic[]
): EmissionContext {
  return {
    target: 'typescript',
    emitOrder: model.emitOrder,
    lazyTypes: model.cyclicTypes,
    sourceMap: [],
    diagnostics,
    namespace: model.namespace,
    dataByName: model.dataByName,
    enumByName: model.enumByName,
    choiceByName: model.choiceByName,
    typeAliasByName: model.typeAliasByName,
    rulesByName: model.rulesByName,
    reportsByName: model.reportsByName,
    annotationsByName: model.annotationsByName,
    libraryFuncsByName: model.libraryFuncsByName,
    registry,
    builtinTypeMap: TS_BUILTIN_TYPE_MAP,
    typeofMap: TS_TYPEOF_MAP
  };
}

// ---------------------------------------------------------------------------
// T104: emitNamespace entry point
// ---------------------------------------------------------------------------

/**
 * Emit the namespace as a single *.ts file.
 *
 * Entry point for the TypeScript class emitter.
 * T104, FR-020, US5B, T126 (func emission).
 *
 * @param model    - Shared walker output for this namespace.
 * @param _options - Generator options.
 */
export function emitNamespace(
  model: NamespaceWalkResult,
  options: GeneratorOptions,
  registry: NamespaceRegistry = { namespaces: new Map() }
): GeneratorOutput {
  return emitNamespaceWithContract(model, options, registry, TsNamespaceEmitter);
}

export class TsNamespaceEmitter extends BaseNamespaceEmitter {
  private readonly ctx: EmissionContext;
  private readonly typeIndex: TypeIndexLookup;
  private readonly sections: string[] = [];
  private readonly relativePath: string;
  private readonly generatedFuncs: GeneratedFunc[] = [];
  private readonly projections: EmittedProjection[] = [];
  private readonly callableNames: CallableNames;
  private readonly singleFile: boolean;
  private readonly inputChecks: boolean;
  private readonly localCallableAliases = new Map<string, string>();

  constructor(
    model: NamespaceWalkResult,
    options: NamespaceEmitterOptions,
    registry: NamespaceRegistry = { namespaces: new Map() }
  ) {
    super(model, options, registry);
    this.ctx = buildEmissionContext(model, registry, this.diagnostics);
    this.typeIndex = toTypeIndexLookup(this.ctx, this.ctx.namespace);
    this.relativePath = getTargetRelativePath(model.namespace, 'typescript');
    this.callableNames = new CallableNames(registry, TYPESCRIPT_RESERVED_NAMES);
    this.singleFile = options.typescript?.layout === 'single-file';
    this.inputChecks = options.typescript?.inputChecks === true;
  }

  private readonly emittedData = new Set<Data>();

  private callableName = (declaration: CallableDeclaration, forceAlias = false): string => {
    const namespace = getElementNamespace(declaration) ?? this.model.namespace;
    const name = this.callableNames.exported(namespace, callableExportName(declaration));
    const emitted =
      this.singleFile || namespace !== this.model.namespace ? this.callableNames.bundled(namespace, name) : name;
    if (forceAlias) {
      if (this.callableNames.alias(namespace, name) === emitted) return emitted;
      const alias = this.callableNames.protectedAlias(namespace, name, this.model.namespace);
      this.localCallableAliases.set(alias, emitted);
      return alias;
    }
    return emitted;
  };

  private typeName = (declaration: AstNode & { name: string }, exportedName = declaration.name): string => {
    const namespace = getElementNamespace(declaration) ?? this.model.namespace;
    exportedName = this.callableNames.declarationExported(namespace, declaration, exportedName);
    return this.singleFile || namespace !== this.model.namespace
      ? this.callableNames.bundled(namespace, exportedName)
      : exportedName;
  };

  emitHeader(): void {
    this.sections.push(this.buildFileHeader());
  }

  emitCrossNamespaceImports(): void {
    const crossNsImports = this.collectCrossNamespaceImports();
    for (const importLine of crossNsImports) {
      this.sections.push(importLine);
    }
    if (crossNsImports.length > 0) {
      this.sections.push('');
    }
  }

  emitAnnotation(annotation: Annotation): void {
    this.sections.push('');
    this.sections.push(this.emitAnnotationDeclaration(annotation));
  }

  emitAfterAnnotations(): void {
    this.sections.push('');
  }

  @debug()
  emitEnumeration(enumNode: RosettaEnumeration): void {
    this.sections.push(this.emitEnumDeclaration(enumNode));
    this.sections.push('');
  }

  @debug()
  emitTypeAlias(typeAlias: RosettaTypeAlias): void {
    this.sections.push('');
    this.sections.push(this.emitTypeAliasDeclaration(typeAlias));
  }

  @debug()
  emitData(data: Data): void {
    if (this.emittedData.has(data)) return;
    this.emittedData.add(data);
    const parent = data.superType?.ref;
    if (isData(parent) && this.ctx.dataByName.get(parent.name) === parent) this.emitData(parent);
    this.sections.push(this.emitInterface(data));
    this.sections.push('');
    this.sections.push(this.emitClass(data));
    this.sections.push('');
    this.sections.push(this.emitTypeGuard(data));
    this.sections.push('');
  }

  /**
   * W2: emit a `choice` declaration as a key-presence discriminated union
   * type (no class — a Choice is a type-only union, not an instantiable
   * shape like Data) plus an exactly-one-of type guard.
   *
   * Data-extends-Choice (user-directed correction, supersedes the spec
   * snippet where they differ): ALSO emit a SHAPE-level union
   * (`<Name>Shape = { cash: CashShape } | ...`) alongside the class-armed
   * one — see emitChoiceShapeTypeDeclaration's doc comment. The original
   * `export type <Name> = { cash: Cash } | ...` union is unchanged (W2
   * surface, non-goal).
   */
  @debug()
  emitChoice(choice: Choice): void {
    this.sections.push(this.emitChoiceTypeDeclaration(choice));
    this.sections.push('');
    this.sections.push(this.emitChoiceShapeTypeDeclaration(choice));
    this.sections.push('');
    this.sections.push(this.emitChoiceTypeGuard(choice));
    this.sections.push('');
  }

  emitRule(rule: RosettaRule): void {
    this.sections.push('');
    this.sections.push(this.emitRuleDeclaration(rule));
  }

  emitReportMetadata(): void {
    const reportMeta = this.buildReportMetadataText();
    if (reportMeta !== '') {
      this.sections.push('');
      this.sections.push(reportMeta);
    }
  }

  emitExternalFunction(func: RosettaExternalFunction): void {
    this.sections.push('');
    this.sections.push(this.emitLibraryFunc(func));
  }

  emitFunctions(): void {
    const runeFuncs = extractFuncs(
      Array.from(this.model.docs),
      this.model.namespace,
      this.ctx.diagnostics,
      new Set(this.ctx.dataByName.keys()),
      this.typeName
    );
    const callGraph = buildFuncCallGraph(runeFuncs);
    const cyclicNames = findCyclicFuncs(callGraph);
    const groups = groupFuncDispatches(runeFuncs);
    const groupsByName = new Map(groups.map((group) => [group[0]!.name, group]));
    const sortedFuncs = topoSortFuncs(
      groups.map((group) => group.find((func) => !func.dispatchAttribute) ?? group[0]!),
      callGraph
    );

    for (const func of sortedFuncs) {
      const bodies = new Map<RuneFunc, string>();
      const isHoisted = cyclicNames.has(func.name);
      const funcCtx = {
        ...TsNamespaceEmitter.buildFuncBodyContext(func, callGraph, this.ctx.diagnostics),
        callableName: this.callableName,
        typeNameResolver: this.typeName,
        onConditionProjection: (condition: Condition, code: string, predicate: string) =>
          this.recordProjection(condition.expression, code, 'condition', predicate)
      };
      const group = groupsByName.get(func.name)!.map((variant) => ({
        ...variant,
        name: variant.source ? this.callableName(variant.source) : variant.name
      }));
      const funcText =
        group.length === 1
          ? TsNamespaceEmitter.emitFunc(group[0]!, funcCtx, isHoisted, (body) => bodies.set(group[0]!, body))
          : renderFuncDispatchGroup(group, {
              renderSignature: (base) =>
                `export function ${base.name}(${TsNamespaceEmitter.buildFuncParameters(base)}): ${TsNamespaceEmitter.buildFuncOutputType(base)}`,
              renderSelector: (_base, attribute) => attrAccessExpr(attribute, funcCtx),
              renderBody: (variant) => {
                const lines = TsNamespaceEmitter.emitFuncBody(variant, {
                  ...TsNamespaceEmitter.buildFuncBodyContext(variant, callGraph, this.ctx.diagnostics),
                  callableName: this.callableName,
                  typeNameResolver: this.typeName,
                  onConditionProjection: (condition: Condition, code: string, predicate: string) =>
                    this.recordProjection(condition.expression, code, 'condition', predicate)
                });
                bodies.set(
                  variant,
                  TsNamespaceEmitter.emitFuncBody(variant, {
                    ...TsNamespaceEmitter.buildFuncBodyContext(variant, callGraph, []),
                    callableName: this.callableName,
                    typeNameResolver: this.typeName,
                    objectEquality: 'method',
                    projection: true
                  })
                    .join('\n')
                    .split('\n')
                    .map((line) => line.slice(2))
                    .join('\n')
                );
                return lines;
              }
            });

      this.sections.push('');
      const outputLine = this.sections.join('\n').split('\n').length;
      this.sections.push(funcText);
      const sources = group.flatMap((variant) => {
        const fragment = variant.source
          ? this.recordProjection(variant.source, funcText, 'function', bodies.get(variant))
          : undefined;
        return fragment ? fragment.sourceMap : [];
      });
      this.ctx.sourceMap.push(...sources.map((entry) => ({ ...entry, outputLine: outputLine + entry.outputLine })));

      const inputCheckExportName = this.inputChecks ? `$rune$check$${group[0]!.name}` : undefined;
      if (inputCheckExportName) {
        this.sections.push(
          renderFuncDispatchGroup(group, {
            renderSignature: (base) =>
              `export function ${inputCheckExportName}(${TsNamespaceEmitter.buildFuncParameters(base)}): void`,
            renderSelector: (_base, attribute) => attrAccessExpr(attribute, funcCtx),
            renderBody: (variant) => [
              ...(variant.preConditions.length
                ? TsNamespaceEmitter.emitFuncInputChecks(variant, {
                    ...TsNamespaceEmitter.buildFuncBodyContext(variant, callGraph, this.ctx.diagnostics),
                    callableName: this.callableName,
                    typeNameResolver: this.typeName
                  })
                : []),
              '  return;'
            ]
          })
        );
      }
      this.generatedFuncs.push({
        ...(inputCheckExportName ? { inputCheckExportName } : {}),
        name: func.name,
        exportName: group[0]!.name,
        parameterNames: func.inputs.map((input) => input.name),
        relativePath: this.relativePath,
        fileContents: funcText,
        sourceMap: sources
      });
    }
  }

  private recordProjection(
    node: AstNode,
    code: string,
    kind: EmittedProjection['kind'],
    body?: string
  ): EmittedProjection | undefined {
    const projection = emittedTypeScriptProjection(node, code, kind, body);
    if (projection) this.projections.push(projection);
    return projection;
  }

  finalize(): GeneratorOutput {
    while (this.sections.length > 0 && this.sections[this.sections.length - 1] === '') {
      this.sections.pop();
    }
    return {
      relativePath: this.relativePath,
      content:
        [
          ...this.sections,
          ...[...this.localCallableAliases].map(
            ([alias, name]) => `const ${alias} = (...args: Parameters<typeof ${name}>) => ${name}(...args);`
          )
        ].join('\n') + '\n',
      sourceMap: this.ctx.sourceMap,
      diagnostics: this.ctx.diagnostics,
      funcs: this.generatedFuncs,
      projections: this.projections
    };
  }

  // ---------------------------------------------------------------------------
  // Private instance methods (ctx-taking helpers)
  // ---------------------------------------------------------------------------

  /**
   * Collect cross-namespace import statements needed for the types and aliases
   * defined in this emission context.
   */
  private collectCrossNamespaceImports(): string[] {
    const imports = new Map<string, Set<string>>(); // namespace -> symbol names

    const trackRef = (
      typeRef: (AstNode & { name: string }) | undefined,
      symbolName: string,
      localName?: string
    ): void => {
      if (!typeRef) return;
      const ns = getElementNamespace(typeRef);
      if (!ns || ns === this.ctx.namespace) return;

      let symbols = imports.get(ns);
      if (!symbols) {
        symbols = new Set();
        imports.set(ns, symbols);
      }
      const name = this.callableNames.declarationExported(ns, typeRef, symbolName);
      const exported = this.singleFile ? this.callableNames.bundled(ns, name) : name;
      const local = localName ?? this.typeName(typeRef, symbolName);
      symbols.add(exported === local ? exported : `${exported} as ${local}`);
    };
    const trackCallable = (declaration: CallableDeclaration) => {
      const name = this.callableNames.exported(
        getElementNamespace(declaration) ?? this.model.namespace,
        callableExportName(declaration)
      );
      trackRef(declaration, name, this.callableName(declaration));
    };

    // Route every import-candidate scan through the same `resolveTypeCallTarget`
    // dispatch the VALUE-emitting code uses (resolveTypeExprAsTs/
    // emitTypeAliasDeclaration/emitChoiceTypeDeclaration/
    // emitChoiceShapeTypeDeclaration), so import-tracking can never drift from
    // value-emission again: a `TypeCall` that resolves through a
    // RosettaTypeAlias chain (any number of hops) to a cross-namespace
    // Data/Enum/Choice is tracked against the TERMINAL resolved node, not the
    // immediate (possibly same-namespace alias) reference.
    //
    // ATTRIBUTE position: bare name only for all three kinds — matches
    // resolveTypeExprAsTs's onData/onEnum/onChoice, which all return the bare
    // `node.name` at attribute position (never `<Name>Shape`).
    const trackAttributePositionImport = (typeCall: TypeCall | undefined): void => {
      resolveTypeCallTarget(
        typeCall,
        this.typeIndex,
        {
          onPrimitive: () => undefined,
          onEnum: (node) => trackRef(node, node.name),
          onData: (node) => trackRef(node, node.name),
          onChoice: (node) => trackRef(node, node.name),
          onUnresolved: () => undefined
        },
        this.ctx.namespace
      );
    };

    // Check data type inheritance and attribute references
    for (const data of this.ctx.dataByName.values()) {
      const parentRef = data.superType?.ref;
      if (parentRef) {
        // Deliberately NOT gated on isData: a Choice supertype in another
        // namespace needs BOTH symbols too — `<Choice>Shape` (the generic
        // constraint/default on the child's Shape alias and class, per
        // emitChoiceShapeTypeDeclaration) and the bare `<Choice>` union.
        // Before Choices emitted a Shape-level union this ungated tracking
        // emitted a broken `import { AssetShape }` (TS2305, real corpus:
        // TransferableProduct/SpecificAsset extends Asset cross-namespace);
        // now the symbol exists and the same tracking is simply correct.
        trackRef(parentRef, `${parentRef.name}Shape`);
        trackRef(parentRef, parentRef.name);
      }
      // Multi-level Data-extends-Choice: the child's generic Shape alias
      // constraint references the Choice ANCESTOR's `<Choice>Shape` even
      // when the immediate parent is a Data — the ancestor may live in a
      // third namespace the immediate-parent tracking above never sees.
      if (parentRef && isData(parentRef)) {
        const choiceAncestor = TsNamespaceEmitter.findChoiceAncestor(parentRef);
        if (choiceAncestor) {
          trackRef(choiceAncestor, `${choiceAncestor.name}Shape`);
        }
      }
      // Chases RosettaTypeAlias chains via resolveTypeCallTarget so an
      // attribute typed via an alias that resolves to a cross-namespace
      // Data/Enum/Choice is tracked against the terminal target, matching
      // resolveTypeExprAsTs's value emission (was previously untracked
      // entirely for alias-typed attributes — an alias ref is neither
      // isData/isRosettaEnumeration/isChoice, so the old direct-ref checks
      // never fired for it).
      for (const attr of data.attributes) {
        trackAttributePositionImport(attr.typeCall);
      }
    }

    // Check type alias references — chases the alias's own RHS through any
    // further alias links via resolveTypeCallTarget (a 2+ hop chain), matching
    // emitTypeAliasDeclaration's value emission, instead of only tracking the
    // alias's immediate direct ref (which for a 2+ hop chain tracked the
    // wrong, intermediate alias's bare name rather than the terminal target).
    // DECLARATION position: Data/Choice resolve to `<Name>Shape` (a type
    // alias is a structural synonym); Enum resolves to the bare name — matches
    // emitTypeAliasDeclaration's onData/onChoice/onEnum exactly.
    for (const alias of this.ctx.typeAliasByName.values()) {
      resolveTypeCallTarget(
        alias.typeCall,
        this.typeIndex,
        {
          onPrimitive: () => undefined,
          onEnum: (node) => trackRef(node, node.name),
          onData: (node) => trackRef(node, `${node.name}Shape`),
          onChoice: (node) => trackRef(node, `${node.name}Shape`),
          onUnresolved: () => undefined
        },
        this.ctx.namespace
      );
    }

    // Check Choice option type references — mirrors the attribute loop above
    // (bare-name, attribute-position convention) for the union arms
    // (emitChoiceTypeDeclaration), PLUS the Shape-suffixed convention for
    // Data options in the Shape-level union (emitChoiceShapeTypeDeclaration).
    // Previously never scanned at all, so a Choice option typed as (or via an
    // alias to) a cross-namespace Data/Enum/Choice produced a correct value
    // reference but no import line.
    for (const choice of this.ctx.choiceByName.values()) {
      for (const option of choice.attributes) {
        trackAttributePositionImport(option.typeCall);
        // emitChoiceShapeTypeDeclaration additionally references
        // `<Name>Shape` for options that resolve to a Data (only Data —
        // preserves that function's exact pre-existing Data-only special
        // case; Enum/Choice options use the same bare name in both unions).
        resolveTypeCallTarget(
          option.typeCall,
          this.typeIndex,
          {
            onPrimitive: () => undefined,
            onEnum: () => undefined,
            onData: (node) => trackRef(node, `${node.name}Shape`),
            onChoice: () => undefined,
            onUnresolved: () => undefined
          },
          this.ctx.namespace
        );
      }
    }

    for (const annotation of this.ctx.annotationsByName.values()) {
      for (const attribute of annotation.attributes) trackAttributePositionImport(attribute.typeCall);
    }

    // Check rule input types
    for (const rule of this.ctx.rulesByName.values()) {
      const inputRef = rule.input?.type?.ref;
      if (isData(inputRef) || isChoice(inputRef)) {
        trackRef(inputRef, `${inputRef.name}Shape`);
        trackRef(inputRef, inputRef.name);
      } else if (inputRef?.$type === 'RosettaTypeAlias' || inputRef?.$type === 'RosettaEnumeration') {
        trackRef(inputRef, inputRef.name);
      }
    }

    for (const func of this.ctx.libraryFuncsByName.values()) {
      for (const parameter of [...func.parameters, func]) {
        const type = parameter.typeCall?.type?.ref;
        if (isData(type) || isChoice(type)) trackRef(type, `${type.name}Shape`);
        else if (type?.$type === 'RosettaTypeAlias' || type?.$type === 'RosettaEnumeration') trackRef(type, type.name);
      }
    }

    for (const doc of this.model.docs) {
      for (const node of AstUtils.streamAllContents(doc.parseResult.value)) {
        const narrowed = isAsOperation(node)
          ? node.type.ref
          : isSwitchCaseGuard(node)
            ? node.referenceGuard?.ref
            : undefined;
        if (isData(narrowed) || isChoice(narrowed)) trackRef(narrowed, `${narrowed.name}Shape`);
        if (isRosettaConstructorExpression(node)) {
          const type = expressionType(node);
          if (isData(type) || isChoice(type)) trackRef(type, `${type.name}Shape`);
        }
        if (isRosettaSymbolReference(node)) {
          const ref = node.symbol?.ref;
          if (isRosettaFunction(ref) || isRosettaExternalFunction(ref) || isRosettaRule(ref)) trackCallable(ref);
        }
        if (isRosettaFunction(node)) {
          const output = functionOutput(node);
          for (const parameter of [...functionInputs(node), ...(output ? [output] : [])]) {
            const type = parameter.typeCall?.type?.ref;
            if (isData(type) || isChoice(type)) trackRef(type, `${type.name}Shape`);
            else if (type?.$type === 'RosettaTypeAlias' || type?.$type === 'RosettaEnumeration')
              trackRef(type, type.name);
          }
          const parent = node.superFunction?.ref;
          if (parent) trackCallable(parent);
        }
      }
    }

    return buildCrossNsImportLines(imports, this.ctx.namespace, this.ctx.registry, '.js');
  }

  /**
   * Resolve the TypeScript type expression for an attribute.
   * T105.
   */
  private resolveTypeExprAsTs(attr: Attribute): string {
    const type = resolveTypeCallTarget(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (mapped) return mapped;
          // Matches the original inline diagnostic exactly (code +
          // message) — mirrors zod-emitter.ts's onPrimitive, which keeps
          // its own target-specific diagnostics.push rather than routing
          // through reportUnresolvedReference: this is a resolved
          // primitive with no TARGET mapping, a different condition than
          // an unresolved reference.
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no TypeScript mapping; emitting unknown`
          });
          return 'unknown';
        },
        // W2: a Choice-typed attribute resolves to the emitted Choice
        // union type name — was previously falling to 'unknown' (isChoice
        // was never consulted in the hand-rolled chain this replaces).
        onEnum: (node) => this.typeName(node),
        onData: (node) => this.typeName(node),
        onChoice: (node) => this.typeName(node),
        onUnresolved: (refText) => {
          if (refText) return refText; // preserves this file's existing permissive refText shortcut
          this.reportUnresolvedReference(attr.name, undefined, 'unknown');
          return 'unknown';
        }
      },
      this.ctx.namespace
    );
    return metadataType(type, fieldMetadataKind(attr));
  }

  /**
   * Resolve the JS typeof string for an attribute's base type.
   * Returns undefined when the type is not a scalar (e.g., Data reference).
   * T108.
   */
  private resolveTypeofStr(attr: Attribute): string | undefined {
    if (hasFieldMetadata(attr)) return 'object';
    return resolveTypeCallTarget<string | undefined>(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => this.ctx.typeofMap[basicTypeName],
        onEnum: () => undefined,
        onData: () => undefined,
        onChoice: () => undefined,
        onUnresolved: () => undefined
      },
      this.ctx.namespace
    );
  }

  /**
   * Resolve the emitted TS type for a builtin attribute (e.g. `Temporal.PlainDate`,
   * `string`). Used to make `instanceof` guards precise for the Temporal record
   * mappings. Returns undefined for non-builtin (Data/Enum) references.
   */
  private resolveBuiltinTsType(attr: Attribute): string | undefined {
    return resolveTypeCallTarget<string | undefined>(
      attr.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => this.ctx.builtinTypeMap[basicTypeName],
        onEnum: () => undefined,
        onData: () => undefined,
        onChoice: () => undefined,
        onUnresolved: () => undefined
      },
      this.ctx.namespace
    );
  }

  // ---------------------------------------------------------------------------
  // T105: emitInterface
  // ---------------------------------------------------------------------------

  /**
   * Walk UP a Data's `extends` chain (NOT including `data` itself, mirroring
   * zod-emitter.ts's `findChoiceAncestor` cycle-guard contract) and report
   * the Choice it bottoms out at, if any. Needed because `interface X
   * extends AliasWithUnionDefault` does not typecheck (TS2312: "An
   * interface can only extend an object type or intersection of object
   * types with statically known members") — a GENERIC alias whose default
   * type argument resolves to a union is exactly that shape. So once ANY
   * ancestor's Shape becomes the generic intersection alias (T105's
   * Data-extends-Choice case), every DESCENDANT's Shape must also become a
   * generic alias threading the same `T`, chaining `<Parent>Shape<T>`
   * rather than `extends <Parent>Shape` — unlike zod's runtime
   * `runeExtendChoice` (which must flatten to ONE call because a `z.union`
   * has no `.extend()`), TS type aliases chain naturally
   * (`type CShape<T> = BShape<T> & {...}` typechecks and still narrows
   * correctly at any depth — verified empirically), so no flattening is
   * needed here.
   */
  private static findChoiceAncestor(data: Data): Choice | undefined {
    const visited = new Set<string>([data.name]);
    let current: unknown = data.superType?.ref;
    while (current) {
      if (isChoice(current)) return current;
      if (!isData(current) || visited.has(current.name)) return undefined;
      visited.add(current.name);
      current = current.superType?.ref;
    }
    return undefined;
  }

  /**
   * Emit the `<TypeName>Shape` TYPE-level artifact.
   *
   * Ordinary case (no supertype, and no Choice ancestor anywhere up the
   * `extends` chain): `export interface <TypeName>Shape { ... }`, extending
   * `<Parent>Shape` when the parent is a Data in this namespace — own
   * attributes only, parent's are inherited via `extends`. UNCHANGED for
   * this feature.
   *
   * Data-extends-Choice (per docs/superpowers/specs/2026-07-02-
   * data-extends-choice-design.md "TS type — generic intersection", plus
   * the user-directed Shape-constraint correction): when
   * `data.superType.ref` is a `Choice` directly, an `interface … extends`
   * is not expressible (interfaces cannot extend a union) — the spec's own
   * type surface is `T & { ...extras }`, generic over the Choice arm.
   * Since the CLASS is already named `<TypeName>` (T106), the type alias is
   * emitted as `<TypeName>Shape` instead (collision-free naming, recorded
   * in the spec doc). The constraint/default is the Choice's SHAPE-level
   * union (`<Choice>Shape`, per emitChoiceShapeTypeDeclaration), NOT the
   * bare Choice union — the bare union's arms are the CLASS types, which
   * would world-mix a plain-data construction payload with class-armed
   * types: `export type <TypeName>Shape<T extends <Choice>Shape =
   * <Choice>Shape> = T & { ...own attrs };`. Bare `<TypeName>Shape` (no
   * type argument) still typechecks at every existing reference site
   * because the default type param is the full Shape-level union.
   *
   * Multi-level (`Data extends Data extends Choice`): when the IMMEDIATE
   * parent is a Data whose own chain reaches a Choice ancestor further up
   * (`findChoiceAncestor`), this Data's Shape must ALSO become a generic
   * alias threading the same `T` through the parent's generic Shape:
   * `export type <TypeName>Shape<T extends <ChoiceAncestor>Shape =
   * <ChoiceAncestor>Shape> = <Parent>Shape<T> & { ...own attrs };` — plain
   * `interface … extends <Parent>Shape` would fail to compile once
   * `<Parent>Shape` is itself the generic alias (its default resolves to a
   * union).
   * T105.
   */
  private emitInterface(data: Data): string {
    const interfaceName = this.typeName(data, `${data.name}Shape`);

    const parentRef = data.superType?.ref;
    const choiceParent = parentRef && isChoice(parentRef) ? parentRef : undefined;
    // Item 2 (docs/superpowers/specs/2026-07-02-emitter-crossns-hardening-
    // design.md): NOT gated on `this.ctx.dataByName.has(...)` — that map
    // only holds THIS namespace's own Data nodes, so a parent Data in
    // ANOTHER namespace failed the check and silently lost `extends
    // <Parent>Shape` even though `collectCrossNamespaceImports` already
    // tracks and emits the import for exactly this case. `isData(parentRef)`
    // alone suffices: Langium cross-ns refs are resolved AST nodes, `.name`
    // and `findChoiceAncestor` both work through them regardless of which
    // namespace they live in — the same reasoning that already applies to
    // cross-ns Data-extends-Choice (collectCrossNamespaceImports's own doc
    // comment).
    const parentData = parentRef && isData(parentRef) ? parentRef : undefined;
    const inheritedChoiceAncestor = parentData ? TsNamespaceEmitter.findChoiceAncestor(parentData) : undefined;

    // Own attribute field declarations — identical across all branches.
    const fields: string[] = hasTypeMetadata(data) ? ['  meta?: RuneMetadata;'] : [];
    for (const attr of data.attributes) {
      const baseType = this.resolveTypeExprAsTs(attr);
      const fieldDecl = TsNamespaceEmitter.applyCardinalityTs(attr.card, baseType, attr.name);
      fields.push(`  ${fieldDecl};`);
    }
    const body = fields.length === 0 ? '{}' : `{\n${fields.join('\n')}\n}`;

    if (choiceParent) {
      const constraint = this.typeName(choiceParent, `${choiceParent.name}Shape`);
      return `export type ${interfaceName}<T extends ${constraint} = ${constraint}> = T & ${body};`;
    }

    if (parentData && inheritedChoiceAncestor) {
      const constraint = this.typeName(inheritedChoiceAncestor, `${inheritedChoiceAncestor.name}Shape`);
      return `export type ${interfaceName}<T extends ${constraint} = ${constraint}> = ${this.typeName(parentData, `${parentData.name}Shape`)}<T> & ${body};`;
    }

    const parentInterfaceName = parentData ? this.typeName(parentData, `${parentData.name}Shape`) : undefined;

    const header = parentInterfaceName
      ? `export interface ${interfaceName} extends ${parentInterfaceName}`
      : `export interface ${interfaceName}`;

    return `${header} ${body}`;
  }

  // ---------------------------------------------------------------------------
  // T106: emitClass
  // ---------------------------------------------------------------------------

  /**
   * Emit `export class <TypeName> implements <TypeName>Shape` (no parent)
   * or `export class <Child> extends <Parent> implements <Child>Shape` (with parent).
   * Includes instance field declarations and constructor.
   *
   * Data-extends-Choice (AMENDED per docs/superpowers/specs/2026-07-02-
   * data-extends-choice-design.md "TS class — generic child class"): when
   * `data.superType.ref` is a `Choice` (not a `Data`), there is no parent
   * CLASS to `extends` (a Choice is a type-only union, never emitted as a
   * class — see emitChoice's doc comment) — instead the child class itself
   * becomes generic over the Choice arm: `class <Name><T extends
   * <Choice>Shape = <Choice>Shape>` (constrained on the SHAPE-level Choice
   * union, per the user-directed correction — see
   * emitChoiceShapeTypeDeclaration's world-mixing rationale). `<Name>Shape`
   * is now the generic intersection type alias (T105, "TS type — generic
   * intersection") — its DEFAULT instantiation (`<Name>Shape` with no type
   * argument) is `<Choice>Shape & {...own attrs}`, a
   * union-rooted intersection, which a class cannot `implements` (classes
   * may only implement object types, not unions). So the class omits
   * `implements` for the Choice-parent case; `<Name>Shape<T>` remains the
   * single construction-time type used by the constructor parameter and
   * `static from`'s cast — the class/alias pairing is still verified by
   * the emitted-runtime behavior tests (real `tsc` + real execution), just
   * not via a structural `implements` clause. The constructor threads `T`
   * through its parameter (`data: <Name>Shape<T>`) and
   * `Object.assign(this, data)` copies the T-surface onto the instance,
   * while own attributes are still assigned explicitly afterward (unchanged
   * convention) so `typeof this.<attr>` narrowing keeps working. `static
   * from`/`new <Name>(...)` remain the only construction paths (no
   * competing `of<T>()` factory).
   * T106.
   */
  private emitClass(data: Data): string {
    const name = this.typeName(data);
    const interfaceName = this.typeName(data, `${data.name}Shape`);
    const parentRef = data.superType?.ref;
    // Item 2: NOT gated on `dataByName.has` — see emitInterface's doc
    // comment for the full cross-namespace rationale.
    const parentData = parentRef && isData(parentRef) ? parentRef : undefined;
    const parentName = parentData ? this.typeName(parentData) : undefined;
    const choiceParent = parentRef && isChoice(parentRef) ? parentRef : undefined;
    // Multi-level (Data extends Data extends Choice, per T105's
    // emitInterface): once the PARENT's own Shape is itself the generic
    // intersection alias, THIS Data's Shape (bare, default `T`) is also
    // union-rooted — `implements <Name>Shape` fails the same way it does
    // for a direct Choice parent (TS2422: a class can only implement an
    // object type, not a union). The class stays ordinary (`extends
    // <Parent>` only, no `<T>` on the class itself — the leaf Data doesn't
    // need its own generic param, `super(data)` structurally accepts the
    // wider bare Shape), it just drops `implements`.
    const inheritedChoiceAncestor = parentData ? TsNamespaceEmitter.findChoiceAncestor(parentData) : undefined;
    const shapeIsGeneric = choiceParent !== undefined || inheritedChoiceAncestor !== undefined;

    const classHeader = choiceParent
      ? `export class ${name}<T extends ${this.typeName(choiceParent, `${choiceParent.name}Shape`)} = ${this.typeName(choiceParent, `${choiceParent.name}Shape`)}>`
      : parentName
        ? shapeIsGeneric
          ? `export class ${name} extends ${parentName}`
          : `export class ${name} extends ${parentName} implements ${interfaceName}`
        : `export class ${name} implements ${interfaceName}`;

    const lines: string[] = [`${classHeader} {`];

    if (hasTypeMetadata(data)) lines.push('  meta?: RuneMetadata;');

    // Own instance fields
    for (const attr of data.attributes) {
      const baseType = this.resolveTypeExprAsTs(attr);
      const fieldDecl = TsNamespaceEmitter.applyCardinalityTs(attr.card, baseType, attr.name);
      lines.push(`  ${fieldDecl};`);
    }

    // Constructor body lines
    const ctorBodyLines: string[] = [];
    if (choiceParent) {
      ctorBodyLines.push(`    Object.assign(this, data);`);
    } else if (parentName) {
      ctorBodyLines.push(`    super(data);`);
    }
    if (hasTypeMetadata(data)) ctorBodyLines.push('    this.meta = data.meta;');
    for (const attr of data.attributes) {
      ctorBodyLines.push(`    this.${attr.name} = data.${attr.name};`);
    }

    const hasOwnFields = data.attributes.length > 0;
    if (hasOwnFields) {
      lines.push('');
    }
    const ctorParamType = choiceParent ? `${interfaceName}<T>` : interfaceName;
    if (ctorBodyLines.length === 0) {
      lines.push(`  constructor(data: ${ctorParamType}) {}`);
    } else {
      lines.push(`  constructor(data: ${ctorParamType}) {`);
      for (const bodyLine of ctorBodyLines) {
        lines.push(bodyLine);
      }
      lines.push('  }');
    }

    // static from factory (T107)
    lines.push('');
    lines.push(this.emitFromFactory(data, shapeIsGeneric));

    // Data-extends-Choice: exactly-one-of validator over the inherited
    // Choice's option names, mirroring emitOneOf's ts-method emission
    // convention (rune.checkOneOf + errors.push), read off `this` since the
    // option keys were copied on via Object.assign in the constructor.
    if (choiceParent) {
      lines.push('');
      lines.push(this.emitChoiceParentValidateMethod(choiceParent, name));
    }

    // validate methods (T110)
    if (activeConditions(data).length > 0) {
      lines.push('');
      lines.push(this.emitValidateMethods(data));
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Data-extends-Choice: emit an exactly-one-of validate method for a
   * child's inherited Choice supertype — mirrors `emitOneOf`'s ts-method
   * body shape (`rune.checkOneOf` + `errors.push`) exactly, since this IS
   * the same exactly-one-of semantics as a `OneOfOperation`/
   * `ChoiceOperation` condition, just synthesized from the Choice's option
   * list instead of an authored `Condition` node.
   *
   * Reads `this.<choiceOptionFieldName>` — the REAL emitted field key
   * (camelCase, e.g. `cash`), populated by `Object.assign(this, data)` in
   * the constructor from the union member key (`{ cash: Cash }`, per
   * emitChoiceTypeDeclaration) — NOT `this.<OptionTypeName>` (`Cash`,
   * capitalized). The error MESSAGE still uses the bare option type names
   * (`optionNames`, matching the DSL-facing option list a reader expects to
   * see), but the RUNTIME CHECK must read the accessor names — the same
   * DSL-text-vs-real-field-key distinction the transpiler's
   * `attrAccessorNames` remap fixes for authored conditions
   * (base-namespace-emitter.ts's `buildAttrAccessorNamesMap` doc comment
   * has the full rationale).
   *
   * The read is cast via `(this as unknown as Record<string, unknown>)`
   * (matching `buildTypeGuardChecks`'s existing convention elsewhere in
   * this file): the class does NOT statically declare the option keys as
   * members (they only exist on `this` at runtime, via `Object.assign` in
   * the constructor) — a direct `this.cash` fails real `tsc --strict`
   * (TS2339, "Property 'cash' does not exist"), since TypeScript classes
   * cannot declare members from a type parameter (the same documented
   * limitation the spec's amended TS-class section calls out).
   */
  private emitChoiceParentValidateMethod(choice: Choice, childName: string): string {
    const optionNames = choice.attributes.map((option) => {
      const optionTypeRef = option.typeCall?.type;
      return optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? '?';
    });
    const accessors = optionNames
      .map((n) => `(this as unknown as Record<string, unknown>).${choiceOptionFieldName(n)}`)
      .join(', ');
    const message = `${choice.name}: exactly one of [${optionNames.join(', ')}] must be present in ${childName}`;

    return [
      `  validate${choice.name}(): { valid: boolean; errors: string[] } {`,
      `    const errors: string[] = [];`,
      `    if (!rune.checkOneOf([${accessors}])) {`,
      `      errors.push('${message}');`,
      `    }`,
      `    return { valid: errors.length === 0, errors };`,
      `  }`
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // T108: emitTypeGuard
  // ---------------------------------------------------------------------------

  /**
   * Build the field-check lines for a type guard body.
   */
  private buildTypeGuardChecks(data: Data): string[] {
    const lines: string[] = [];
    const obj = 'x';

    const allAttrs: Attribute[] = [];
    const parentRef = data.superType?.ref;
    if (parentRef && isData(parentRef)) {
      const parent = parentRef;
      for (const attr of parent.attributes) {
        allAttrs.push(attr);
      }
    }
    for (const attr of data.attributes) {
      allAttrs.push(attr);
    }

    for (const attr of allAttrs) {
      const card = attr.card;
      const typeofStr = this.resolveTypeofStr(attr);
      const isArray = TsNamespaceEmitter.isArrayCardinality(card);
      const isOpt = TsNamespaceEmitter.isOptionalCardinality(card);

      if (isArray) {
        const { lower } = decodeCardinality(card);
        if (lower > 0) {
          lines.push(`  if (!Array.isArray((${obj} as Record<string, unknown>).${attr.name})) return false;`);
        } else {
          lines.push(
            `  if ((${obj} as Record<string, unknown>).${attr.name} !== undefined && !Array.isArray((${obj} as Record<string, unknown>).${attr.name})) return false;`
          );
        }
      } else if (isOpt) {
        if (typeofStr) {
          const access = `(${obj} as Record<string, unknown>).${attr.name}`;
          const tsType = this.resolveBuiltinTsType(attr);
          lines.push(
            `  if (${access} !== undefined && ${TsNamespaceEmitter.negTypeofGuard(access, typeofStr, tsType)}) return false;`
          );
        }
      } else {
        if (typeofStr) {
          const access = `(${obj} as Record<string, unknown>).${attr.name}`;
          const tsType = this.resolveBuiltinTsType(attr);
          lines.push(`  if (${TsNamespaceEmitter.negTypeofGuard(access, typeofStr, tsType)}) return false;`);
        } else {
          lines.push(`  if ((${obj} as Record<string, unknown>).${attr.name} === undefined) return false;`);
        }
      }
    }

    return lines;
  }

  /**
   * Emit `export function is<TypeName>(x: unknown): x is <TypeName>`.
   * T108, T109.
   */
  private emitTypeGuard(data: Data): string {
    const name = this.typeName(data);
    const parentRef = data.superType?.ref;
    // Item 2: NOT gated on `dataByName.has` — see emitInterface's doc
    // comment for the full cross-namespace rationale.
    const parentName = parentRef && isData(parentRef) ? this.typeName(parentRef) : undefined;

    const checkLines = this.buildTypeGuardChecks(data);

    if (parentName) {
      const lines: string[] = [
        `export function ${this.typeName(data, `is${data.name}`)}(x: unknown): x is ${name};`,
        `export function ${this.typeName(data, `is${data.name}`)}(x: ${parentName}): x is ${name};`,
        `export function ${this.typeName(data, `is${data.name}`)}(x: unknown): x is ${name} {`,
        `  if (typeof x !== 'object' || x === null) return false;`,
        ...checkLines,
        `  return true;`,
        `}`
      ];
      return lines.join('\n');
    }

    const lines: string[] = [
      `export function ${this.typeName(data, `is${data.name}`)}(x: unknown): x is ${name} {`,
      `  if (typeof x !== 'object' || x === null) return false;`,
      ...checkLines,
      `  return true;`,
      `}`
    ];
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // W2: Choice emission
  // ---------------------------------------------------------------------------

  /**
   * Resolve a Choice option's bare TS type reference — the same
   * `resolveTypeCallTarget` alias-chasing dispatch `resolveTypeExprAsTs` uses
   * for an attribute's type reference, adapted for a `ChoiceOption` (which
   * has a `typeCall` but no `.name`, unlike `Attribute`).
   */
  private resolveChoiceOptionTypeExpr(typeCall: TypeCall | undefined, diagnosticLabel: string): string {
    return resolveTypeCallTarget(
      typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (mapped) return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no TypeScript mapping; emitting unknown`
          });
          return 'unknown';
        },
        onEnum: (node) => this.typeName(node),
        onData: (node) => this.typeName(node),
        onChoice: (node) => this.typeName(node),
        onUnresolved: (refText) => {
          if (refText) return refText;
          this.reportUnresolvedReference(diagnosticLabel, undefined, 'unknown');
          return 'unknown';
        }
      },
      this.ctx.namespace
    );
  }

  /**
   * Resolve a Choice option's SHAPE-level TS type reference for
   * `emitChoiceShapeTypeDeclaration` — identical dispatch to
   * `resolveChoiceOptionTypeExpr` except a Data target resolves to its
   * `<Name>Shape` structural type. Preserves that function's pre-existing
   * Data-only special case (Enum/Choice targets stay bare, matching
   * `emitChoiceShapeTypeDeclaration`'s doc comment) — now driven through the
   * resolved terminal node instead of the immediate direct ref.
   */
  private resolveChoiceOptionShapeTypeExpr(typeCall: TypeCall | undefined, diagnosticLabel: string): string {
    return resolveTypeCallTarget(
      typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (mapped) return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no TypeScript mapping; emitting unknown`
          });
          return 'unknown';
        },
        onEnum: (node) => this.typeName(node),
        onData: (node) => this.typeName(node, `${node.name}Shape`),
        onChoice: (node) => this.typeName(node),
        onUnresolved: (refText) => {
          if (refText) return refText;
          this.reportUnresolvedReference(diagnosticLabel, undefined, 'unknown');
          return 'unknown';
        }
      },
      this.ctx.namespace
    );
  }

  /**
   * Emit `export type <ChoiceName> = { option1: Type1 } | { option2: Type2 } | ...;`
   * — a key-presence discriminated union (not `z.discriminatedUnion`-style
   * literal-tag discrimination; CDM Choice instances are encoded as an
   * object with exactly ONE option key present, not a `$type` tag).
   */
  private emitChoiceTypeDeclaration(choice: Choice): string {
    const name = this.typeName(choice);
    const options = choice.attributes
      .map((option) => {
        // FIELD KEY: derived from the DIRECT/immediate reference's name,
        // never the alias-chased terminal target — established convention
        // (matches preview-schema.ts's buildChoiceOptionField and
        // zod-emitter's emitChoiceSchema); an option typed via a type alias
        // keeps its author-given key, not the alias's resolved target's name.
        const optionTypeRef = option.typeCall?.type;
        const optionTypeName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? '?';
        const fieldName = choiceOptionFieldName(optionTypeName);
        // VALUE TYPE: chases through any RosettaTypeAlias chain.
        const valueType = metadataType(
          this.resolveChoiceOptionTypeExpr(option.typeCall, fieldName),
          fieldMetadataKind(option)
        );
        return `{ ${fieldName}: ${valueType} }`;
      })
      .join(' | ');
    if (options === '') {
      return `export type ${name} = never;`;
    }
    return `export type ${name} = ${options};`;
  }

  /**
   * Emit the SHAPE-level Choice union:
   * `export type <ChoiceName>Shape = { cash: CashShape } | { commodity: CommodityShape } | ...;`
   *
   * Data-extends-Choice (user-directed correction): the generic
   * intersection Shape alias and the generic child class must constrain
   * `T` on the Choice's SHAPE-level union, not the bare Choice union —
   * `emitChoiceTypeDeclaration`'s arms reference bare names, which for
   * Data options are the CLASS types, so `T extends <Choice>` would
   * intersect the plain-data (Shape) world with a class-armed union
   * (world-mixing: a `{ cash: { amount: 5 } }` construction payload is
   * not a `Cash` class instance). Each arm's value type here is the
   * option's `<Name>Shape` when the option resolves to a Data (the type
   * a construction payload actually carries at that key), and the bare
   * name otherwise (enums/builtins have no Shape form — same convention
   * as every other Shape-suffix site in this emitter).
   */
  private emitChoiceShapeTypeDeclaration(choice: Choice): string {
    const name = this.typeName(choice, `${choice.name}Shape`);
    const options = choice.attributes
      .map((option) => {
        // FIELD KEY: same direct/immediate-name convention as
        // emitChoiceTypeDeclaration — see that function's doc comment.
        const optionTypeRef = option.typeCall?.type;
        const optionTypeName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? '?';
        const fieldName = choiceOptionFieldName(optionTypeName);
        // VALUE TYPE: chases through any RosettaTypeAlias chain; Data targets
        // resolve to `<Name>Shape`.
        const valueType = metadataType(
          this.resolveChoiceOptionShapeTypeExpr(option.typeCall, fieldName),
          fieldMetadataKind(option)
        );
        return `{ ${fieldName}: ${valueType} }`;
      })
      .join(' | ');
    if (options === '') {
      return `export type ${name} = never;`;
    }
    return `export type ${name} = ${options};`;
  }

  /**
   * Emit `export function is<ChoiceName>(x: unknown): x is <ChoiceName>` —
   * an "exactly one of the option keys is present" validator, mirroring
   * rune.checkOneOf's one-of semantics (same as the ChoiceOperation condition
   * validator) but as a standalone type guard for the emitted union type.
   */
  private emitChoiceTypeGuard(choice: Choice): string {
    const name = this.typeName(choice);
    const fieldNames = choice.attributes.map((option) => {
      const optionTypeRef = option.typeCall?.type;
      const optionTypeName = optionTypeRef?.ref?.name ?? optionTypeRef?.$refText ?? '?';
      return choiceOptionFieldName(optionTypeName);
    });

    const accessors = fieldNames.map((f) => `(x as Record<string, unknown>).${f}`).join(', ');

    const lines: string[] = [
      `export function ${this.typeName(choice, `is${choice.name}`)}(x: unknown): x is ${name} {`,
      `  if (typeof x !== 'object' || x === null) return false;`,
      `  return rune.checkOneOf([${accessors}]);`,
      `}`
    ];
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // T110: emitValidateMethods
  // ---------------------------------------------------------------------------

  /**
   * Build an ExpressionTranspilerContext for ts-method emission.
   */
  private buildTsTranspilerContext(data: Data, conditionName: string): ExpressionTranspilerContext {
    const attributeTypes = buildAttributeTypesMap(data);
    const attrAccessorNames = buildAttrAccessorNamesMap(data);
    return {
      selfName: 'this',
      emitMode: 'ts-method',
      conditionName,
      typeName: data.name,
      attributeTypes,
      diagnostics: this.ctx.diagnostics,
      attrAccessorNames,
      callableName: this.callableName,
      typeNameResolver: this.typeName,
      localMetadata: new Map(
        typeFeatures(data)
          .filter(isAttribute)
          .filter(hasFieldMetadata)
          .map((attr) => [attr.name, { kind: fieldMetadataKind(attr)!, many: featureIsMany(attr) }])
      )
    };
  }

  /**
   * Emit validate methods for all conditions on a type.
   * T110.
   */
  private emitValidateMethods(data: Data): string {
    const conditions = activeConditions(data);
    if (conditions.length === 0) return '';

    const methodBlocks: string[] = [];

    for (const cond of conditions) {
      const condName = cond.name ?? 'Condition';
      const transpilerCtx = this.buildTsTranspilerContext(data, condName);
      const body = transpileCondition(cond, transpilerCtx);

      const indentedBody = body
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');

      const method = [
        `  validate${condName}(): { valid: boolean; errors: string[] } {`,
        `    const errors: string[] = [];`,
        indentedBody,
        `    return { valid: errors.length === 0, errors };`,
        `  }`
      ].join('\n');

      this.recordProjection(
        cond.expression,
        method,
        'condition',
        transpileCondition(cond, {
          ...transpilerCtx,
          selfName: 'data',
          emitMode: 'ts-expression',
          objectEquality: 'method',
          projection: true
        })
      );
      methodBlocks.push(method);
    }

    return methodBlocks.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Report metadata / rule / library func / file header / enum / annotation / type alias
  // ---------------------------------------------------------------------------

  /**
   * Build the runeReportRules const string.
   * Renamed from emitReportMetadata to avoid collision with the public interface method.
   */
  private buildReportMetadataText(): string {
    const name = this.singleFile
      ? this.callableNames.bundled(this.model.namespace, 'runeReportRules')
      : 'runeReportRules';
    const lines = buildReportRulesLines(this.ctx.rulesByName, name);
    return lines.length === 0 ? '' : lines.join('\n');
  }

  /**
   * Emit a standalone rule function.
   * Renamed from emitRule to avoid collision with the public interface method.
   */
  private emitRuleDeclaration(rule: RosettaRule): string {
    const name = rule.name;
    const inputTypeRef = rule.input?.type?.ref;
    const inputTypeName = inputTypeRef ? inputTypeRef.name : undefined;
    const paramType = rule.input
      ? resolveFuncValueTypeTs({ typeCall: rule.input }, undefined, this.typeName)
      : 'Record<string, unknown>';
    const paramName = inputTypeName ? inputTypeName.charAt(0).toLowerCase() + inputTypeName.slice(1) : 'input';

    const inputType = resolveType(rule.input);
    const dataContext = isData(inputType) ? this.buildTsTranspilerContext(inputType, name) : undefined;
    const transpilerCtx: ExpressionTranspilerContext = {
      ...dataContext,
      selfName: paramName,
      emitMode: rule.eligibility ? 'ts-method' : 'ts-expression',
      conditionName: name,
      typeName: inputTypeName ?? name,
      attributeTypes: dataContext?.attributeTypes ?? new Map<string, string>(),
      diagnostics: this.ctx.diagnostics,
      callableName: this.callableName,
      typeNameResolver: this.typeName
    };

    const exprStr = transpileExpression(rule.expression, transpilerCtx);

    if (rule.eligibility) {
      return `export function ${this.callableName(rule)}(${paramName}: ${paramType}): boolean {\n  return ${exprStr};\n}`;
    } else {
      return `export function ${this.callableName(rule)}(${paramName}: ${paramType}) {\n  return ${exprStr};\n}`;
    }
  }

  /**
   * Emit a TypeScript callable-type alias for a Rune library function declaration.
   */
  private emitLibraryFunc(func: RosettaExternalFunction): string {
    const name = this.callableName(func);

    const params = func.parameters.map(
      (parameter) =>
        `${parameter.name}: ${resolveFuncValueTypeTs(parameter, undefined, this.typeName)}${parameter.isArray ? '[]' : ''}`
    );
    const returnType = resolveFuncValueTypeTs(func, undefined, this.typeName);
    const binding = typescriptProfile.libraryFuncMap[func.name];
    if (binding?.expr) {
      return [
        `export type ${name} = (${params.join(', ')}) => ${returnType};`,
        `export const ${name}: ${name} = ${binding.expr};`
      ].join('\n');
    }

    return [
      `export type ${name} = (${params.join(', ')}) => ${returnType};`,
      `export const ${name}: ${name} & { implementation?: ${name} } = (${params.join(', ')}): ${returnType} => {`,
      `  if (!${name}.implementation) throw new Error(${JSON.stringify(`Library function '${name}' requires an implementation`)});`,
      `  return ${name}.implementation(${func.parameters.map((p) => p.name).join(', ')});`,
      `};`
    ].join('\n');
  }

  /**
   * Emit the file header: SPDX, generated comment, inlined runtime helpers.
   * No `import { z } from 'zod'` — zero Zod dependency.
   * T104.
   */
  private usesMetadata(): boolean {
    const declarationUsesMetadata = (node: AstNode | undefined): boolean =>
      ((isAttribute(node) || isChoiceOption(node)) && hasFieldMetadata(node)) ||
      (isData(node) && hasTypeMetadata(node)) ||
      (isRosettaFunction(node) &&
        (functionInputs(node).some(hasFieldMetadata) || hasFieldMetadata(functionOutput(node))));
    return this.model.docs.some((doc) =>
      AstUtils.streamAllContents(doc.parseResult.value).some(
        (node) =>
          node.$type === 'WithMetaOperation' ||
          node.$type === 'AsKeyOperation' ||
          declarationUsesMetadata(node) ||
          AstUtils.streamReferences(node).some(({ reference }) =>
            isMultiReference(reference)
              ? reference.items.some((item) => declarationUsesMetadata(item.ref))
              : declarationUsesMetadata(reference.ref)
          )
      )
    );
  }

  private buildFileHeader(): string {
    const libraryHelpers = [...this.ctx.libraryFuncsByName.keys()].flatMap((name) => {
      const binding = typescriptProfile.libraryFuncMap[name];
      return binding?.importFrom === TS_RUNTIME_SIDECAR_PATH && binding.expr ? [binding.expr] : [];
    });
    return [
      `// SPDX-License-Identifier: MIT`,
      `// Generated by @rune-langium/codegen — do not edit`,
      `// Source namespace: ${this.model.namespace}`,
      ``,
      ...(this.suppressBoilerplate
        ? [
            "import { Temporal } from '@js-temporal/polyfill';",
            buildRuntimeHelperImportLine(
              `${resolveImportPath(this.model.namespace, typescriptHelperModuleName(this.registry), this.registry)}.js`,
              [
                ...libraryHelpers,
                ...(this.usesMetadata()
                  ? ['type RuneFieldWithMeta', 'type RuneReferenceWithMeta', 'type RuneMetadata']
                  : [])
              ]
            ),
            ``
          ]
        : [
            runtimeHelperSource(true, false, this.usesMetadata()),
            ...(libraryHelpers.length ? [TS_LIBRARY_RUNTIME_SOURCE] : []),
            ''
          ])
    ].join('\n');
  }

  /**
   * Emit a TypeScript enum declaration (as a const string union + const object).
   * The value object and legacy Values array share the canonical enum members.
   */
  private emitEnumDeclaration(enumNode: RosettaEnumeration): string {
    const name = this.typeName(enumNode);
    const memberNames = getEnumValues(enumNode).map((v) => v.name);
    const members = memberNames.map((member) => {
      const key = member === '__proto__' ? `[${JSON.stringify(member)}]` : JSON.stringify(member);
      return `  ${key}: ${JSON.stringify(member)}`;
    });
    const valueObject = `export const ${name} = {${members.length ? `\n${members.join(',\n')}\n` : ''}} as const;`;

    if (memberNames.length === 0) {
      return [
        `export type ${name} = never;`,
        valueObject,
        `export const ${this.typeName(enumNode, `${enumNode.name}Values`)}: ${name}[] = [];`
      ].join('\n');
    }

    const memberLiterals = memberNames.map((m) => `'${m}'`).join(' | ');
    const valuesArr = memberNames.map((m) => `${name}[${JSON.stringify(m)}]`).join(', ');

    const lines: string[] = [
      `export type ${name} = ${memberLiterals};`,
      valueObject,
      `export const ${this.typeName(enumNode, `${enumNode.name}Values`)}: ${name}[] = [${valuesArr}];`
    ];

    const hasDisplayNames = getEnumValues(enumNode).some((v) => v.display != null);
    if (hasDisplayNames) {
      const displayEntries = getEnumValues(enumNode).map((v) => {
        const displayName = v.display != null ? v.display : v.name;
        const escaped = displayName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `  ${v.name}: '${escaped}'`;
      });
      lines.push('');
      lines.push(
        `export const ${this.typeName(enumNode, `${enumNode.name}DisplayNames`)}: Record<${name}, string> = {\n${displayEntries.join(',\n')}\n};`
      );
    }

    return lines.join('\n');
  }

  /**
   * Emit a typed decorator factory for an annotation declaration.
   * T065, US11.
   */
  private emitAnnotationDeclaration(annotation: Annotation): string {
    const name = this.typeName(annotation);
    const attrs = annotation.attributes ?? [];

    if (attrs.length === 0) {
      return [
        `export function ${name}(): ClassDecorator & PropertyDecorator {`,
        `  return (target: any, propertyKey?: any) => {};`,
        `}`
      ].join('\n');
    }

    const paramFields = attrs
      .map((attr) => {
        const typeName = this.resolveTypeExprAsTs(attr);
        const optional = decodeCardinality(attr.card).lower === 0 ? '?' : '';
        return `  ${attr.name}${optional}: ${typeName};`;
      })
      .join('\n');

    return [
      `export interface ${this.typeName(annotation, `${annotation.name}Args`)} {`,
      paramFields,
      `}`,
      ``,
      `export function ${name}(args: ${this.typeName(annotation, `${annotation.name}Args`)}): ClassDecorator & PropertyDecorator {`,
      `  return (target: any, propertyKey?: any) => {};`,
      `}`
    ].join('\n');
  }

  /**
   * Emit a TypeScript type alias declaration.
   * Maps a Rune typeAlias to `export type <Name> = <TsType>;`.
   * Renamed from emitTypeAlias to avoid collision with the public interface method.
   *
   * Resolves the alias's own right-hand side (`typeAlias A: B` — what `B`
   * resolves to) via the shared `resolveTypeCallTarget` resolver, same as
   * `resolveTypeExprAsTs` resolves an ATTRIBUTE's type reference. This
   * transparently chases `B` through further `RosettaTypeAlias` links — the
   * two hand-rolled inline builtin maps this replaces had no
   * `isRosettaTypeAlias` branch (so a chained alias silently degraded to
   * `unknown`) AND were mutually inconsistent (the `typeRef`-branch map
   * lacked `pattern`/`calculation`; the `refText`-branch map additionally
   * lacked `productType`/`eventType`, and neither was sourced from
   * `this.ctx.builtinTypeMap` like every other builtin lookup in this file).
   * Routing primitives through `this.ctx.builtinTypeMap` also means the
   * temporal builtins (`date`/`dateTime`/`zonedDateTime`/`time`) now resolve
   * to their real `Temporal.*` TS types instead of the old maps' `'string'`
   * literal — consistent with every other builtin-typed declaration in this
   * emitter (no fixture previously exercised a temporal-typed alias).
   *
   * Data/Choice targets resolve to their `<Name>Shape` plain-structural type
   * (not the class/bare-union name `resolveTypeExprAsTs` uses for attribute
   * fields) — a type alias is a structural synonym, and this function's own
   * pre-existing Data handling already used the `Shape` suffix (verified by
   * the `data-ref` US7 fixture: `typeAlias HomeAddress: Address` →
   * `export type HomeAddress = AddressShape;`); Choice follows the same
   * Shape-suffix convention for consistency (previously unhandled — any
   * alias-to-Choice fell through to `unknown`).
   */
  private emitTypeAliasDeclaration(alias: RosettaTypeAlias): string {
    const name = this.typeName(alias);

    const tsType = resolveTypeCallTarget(
      alias.typeCall,
      this.typeIndex,
      {
        onPrimitive: (basicTypeName) => {
          const mapped = this.ctx.builtinTypeMap[basicTypeName];
          if (mapped) return mapped;
          this.ctx.diagnostics.push({
            severity: 'warning',
            code: 'unmapped-builtin',
            message: `Builtin type '${basicTypeName}' has no TypeScript mapping in type alias '${alias.name}'; emitting unknown`
          });
          return 'unknown';
        },
        onEnum: (node) => this.typeName(node),
        onData: (node) => this.typeName(node, `${node.name}Shape`),
        onChoice: (node) => this.typeName(node, `${node.name}Shape`),
        // A totally unresolved RHS falls back to `unknown`. This is a
        // deliberate, disclosed behavior change from pre-migration: the old
        // code did `builtinMap[refText] ?? refText` (a raw refText
        // passthrough for a named-but-unresolvable alias RHS) — see this
        // plan's execution ledger (progress.md, "dropped raw-refText
        // passthrough") for the disclosure and risk assessment.
        onUnresolved: () => 'unknown'
      },
      this.ctx.namespace
    );

    return `export type ${name} = ${tsType};`;
  }

  // ---------------------------------------------------------------------------
  // Private static helpers (pure utilities, no ctx)
  // ---------------------------------------------------------------------------

  /**
   * Apply cardinality to a TypeScript field declaration.
   * T105.
   */
  private static applyCardinalityTs(card: RosettaCardinality, baseType: string, fieldName: string): string {
    const { lower, upper } = decodeCardinality(card);

    if (upper === null) {
      if (lower === 0) return `${fieldName}?: ${baseType}[]`;
      return `${fieldName}${lower === 0 ? '?' : ''}: ${baseType}[]`;
    }

    if (upper === 1 && lower === 1) return `${fieldName}: ${baseType}`;
    if (upper === 0) return `${fieldName}?: never`;
    if (upper === 1 && lower === 0) return `${fieldName}?: ${baseType}`;

    return `${fieldName}${lower === 0 ? '?' : ''}: ${baseType}[]`;
  }

  /**
   * Determine whether a cardinality describes an array field.
   */
  private static isArrayCardinality(card: RosettaCardinality): boolean {
    const { lower, upper } = decodeCardinality(card);
    if (upper === null) return true;
    if (upper === 1 && lower === 1) return false;
    if (upper === 1 && lower === 0) return false;
    if (upper === 0 && lower === 0) return false;
    return true;
  }

  /**
   * Determine whether a cardinality is optional (can be absent).
   */
  private static isOptionalCardinality(card: RosettaCardinality): boolean {
    const { lower, upper } = decodeCardinality(card);
    if (upper === null && lower === 0) return true;
    if (upper === 1 && lower === 0) return true;
    if (upper === 0 && lower === 0) return true;
    return false;
  }

  /**
   * Build a positive type-guard expression for a scalar/object builtin field.
   */
  private static posTypeofGuard(access: string, typeofStr: string, tsType?: string): string {
    if (typeofStr === 'object') {
      if (tsType && tsType.startsWith('Temporal.')) return `${access} instanceof ${tsType}`;
      return `(typeof ${access} === 'object' && ${access} !== null && !Array.isArray(${access}))`;
    }
    return `typeof ${access} === '${typeofStr}'`;
  }

  /** Negated form of posTypeofGuard (true when the field does NOT match). */
  private static negTypeofGuard(access: string, typeofStr: string, tsType?: string): string {
    if (typeofStr === 'object') {
      if (tsType && tsType.startsWith('Temporal.')) return `!(${access} instanceof ${tsType})`;
      return `(typeof ${access} !== 'object' || ${access} === null || Array.isArray(${access}))`;
    }
    return `typeof ${access} !== '${typeofStr}'`;
  }

  // ---------------------------------------------------------------------------
  // T109: emitDiscriminatorPredicate
  // ---------------------------------------------------------------------------

  /**
   * Emit `export function is<Child>(x: <Parent>): x is <Child>` discriminator predicate.
   * T109.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private emitDiscriminatorPredicate(child: Data, parent: Data): string {
    const childName = child.name;
    const parentName = parent.name;

    const childFields = child.attributes;

    if (childFields.length === 0) {
      return [
        `export function is${childName}(x: ${parentName}): x is ${childName} {`,
        `  return is${childName}(x as unknown);`,
        `}`
      ].join('\n');
    }

    const checks: string[] = [];
    for (const attr of childFields) {
      const card = attr.card;
      const typeofStr = this.resolveTypeofStr(attr);
      const isArray = TsNamespaceEmitter.isArrayCardinality(card);
      const isOpt = TsNamespaceEmitter.isOptionalCardinality(card);
      const obj = '(x as Record<string, unknown>)';

      if (isArray) {
        checks.push(`Array.isArray(${obj}.${attr.name})`);
      } else if (isOpt) {
        if (typeofStr) {
          const tsType = this.resolveBuiltinTsType(attr);
          checks.push(
            `(${obj}.${attr.name} === undefined || ${TsNamespaceEmitter.posTypeofGuard(`${obj}.${attr.name}`, typeofStr, tsType)})`
          );
        }
      } else {
        if (typeofStr) {
          const tsType = this.resolveBuiltinTsType(attr);
          checks.push(TsNamespaceEmitter.posTypeofGuard(`${obj}.${attr.name}`, typeofStr, tsType));
        } else {
          checks.push(`${obj}.${attr.name} !== undefined`);
        }
      }
    }

    const condition = checks.length === 0 ? 'true' : checks.join(' && ');

    return [
      `export function is${childName}(x: ${parentName}): x is ${childName} {`,
      `  return ${condition};`,
      `}`
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // T107: emitFromFactory
  // ---------------------------------------------------------------------------

  /**
   * Emit the `static from(json: unknown): <TypeName>` factory method.
   * T107.
   *
   * @param castThroughUnknown - Data-extends-Choice (direct or inherited via
   *   a Data parent, per T105's `findChoiceAncestor`): bare `<Name>Shape`
   *   is `<Choice> & {...}`, a union-rooted intersection. `json` (typed
   *   `unknown` at this point, after the `is<Name>` guard) does not
   *   structurally overlap with that union closely enough for a single
   *   `as` — real `tsc --strict` reports TS2352 ("neither type sufficiently
   *   overlaps with the other") on a direct `json as <Name>Shape`. An
   *   `unknown` intermediate cast is the standard, narrower escape hatch
   *   (still a real assertion, not a semantic change — `is<Name>` already
   *   validated the runtime shape immediately above). Plain Data-extends-
   *   Data keeps the direct cast (unchanged, non-goal).
   */
  private emitFromFactory(data: Data, castThroughUnknown: boolean): string {
    const name = this.typeName(data);
    const shapeName = this.typeName(data, `${data.name}Shape`);
    const castExpr = castThroughUnknown ? `json as unknown as ${shapeName}` : `json as ${shapeName}`;
    return [
      `  static from(json: unknown): ${name} {`,
      `    if (!${this.typeName(data, `is${data.name}`)}(json)) {`,
      `      throw new TypeError('not a ${data.name}: ' + JSON.stringify(json).slice(0, 100));`,
      `    }`,
      `    return new ${name}(${castExpr});`,
      `  }`
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Phase 8b: Func emission helpers (T120–T126) — static (FuncBodyContext, not EmissionContext)
  // ---------------------------------------------------------------------------

  /**
   * Build the TypeScript input object type for a func's input parameters.
   * T120, FR-028.
   */
  private static funcParamType(param: RuneFunc['output']): string {
    const type = param.shapeTypeName ? `RuneFuncData<${param.shapeTypeName}>` : resolveFuncTypeTs(param.typeName);
    return param.metadataKind
      ? `${param.metadataKind === 'reference' ? 'RuneReferenceWithMeta' : 'RuneFieldWithMeta'}<${type}>`
      : type;
  }

  private static parameterBindings(func: RuneFunc): Map<string, string> {
    const reserved = TYPESCRIPT_RESERVED_NAMES;
    const used = new Set([...reserved, ...func.inputs.map((input) => input.name)]);
    return new Map(
      func.inputs.map((input) => {
        if (!reserved.has(input.name)) return [input.name, input.name];
        let name = `${input.name}_input`;
        for (let suffix = 1; used.has(name); suffix++) name = `${input.name}_input${suffix}`;
        used.add(name);
        return [input.name, name];
      })
    );
  }

  private static buildFuncParameters(func: RuneFunc): string {
    const names = TsNamespaceEmitter.parameterBindings(func);
    const lastRequired = func.inputs.reduce((last, input, index) => (input.cardinality.lower > 0 ? index : last), -1);
    return func.inputs
      .map((input, index) => {
        const many = input.cardinality.upper === null || input.cardinality.upper > 1;
        const type = TsNamespaceEmitter.funcParamType(input) + (many ? '[]' : '');
        const optional = input.cardinality.lower === 0;
        return `${names.get(input.name)}${optional && index > lastRequired ? '?' : ''}: ${type}${optional && index <= lastRequired ? ' | undefined' : ''}`;
      })
      .join(', ');
  }

  /**
   * Build the TypeScript return type for a func's output parameter.
   * T120, FR-028.
   */
  private static buildFuncOutputType(func: RuneFunc): string {
    const tsType = TsNamespaceEmitter.funcParamType(func.output);
    const isArray = func.output.cardinality.upper === null || func.output.cardinality.upper > 1;
    return isArray ? `${tsType}[]` : func.output.cardinality.lower === 0 ? `${tsType} | undefined` : tsType;
  }

  /**
   * Build a FuncBodyContext for the given func.
   * T120–T124.
   */
  private static buildFuncBodyContext(
    func: RuneFunc,
    callGraph: Map<string, Set<string>>,
    diagnostics: GeneratorDiagnostic[]
  ): FuncBodyContext {
    const isArray = func.output.cardinality.upper === null || func.output.cardinality.upper > 1;

    const parameterBindings = TsNamespaceEmitter.parameterBindings(func);
    const inputNames = new Set([...parameterBindings.keys(), ...parameterBindings.values()]);
    let result = 'result';
    for (let suffix = 1; inputNames.has(result) || func.aliases.some((alias) => alias.name === result); suffix++)
      result = `result${suffix}`;
    const helperNames = TYPESCRIPT_RESERVED_NAMES;
    const reserved = new Set([...helperNames, result, ...inputNames, ...func.aliases.map((alias) => alias.name)]);
    const aliasBindings = new Map<string, string>();
    for (const alias of func.aliases) {
      let localName = alias.name;
      if (
        inputNames.has(alias.name) ||
        helperNames.has(alias.name) ||
        alias.name === 'input' ||
        alias.name === 'result'
      ) {
        const base = `${alias.name}_alias`;
        localName = base;
        for (let suffix = 1; reserved.has(localName); suffix++) localName = `${base}${suffix}`;
        reserved.add(localName);
      }
      aliasBindings.set(alias.name, localName);
    }

    const attributeTypes = new Map<string, string>();
    for (const p of func.inputs) {
      const many = p.cardinality.upper === null || p.cardinality.upper > 1;
      attributeTypes.set(p.name, p.typeName + (many ? '[]' : p.cardinality.lower === 0 ? ' | undefined' : ''));
    }
    attributeTypes.set(func.output.name, TsNamespaceEmitter.buildFuncOutputType(func));

    return {
      selfName: parameterBindings.values().next().value ?? 'undefined',
      emitMode: 'ts-expression',
      conditionName: func.name,
      typeName: func.name,
      attributeTypes,
      diagnostics,
      localBindings: new Map([...parameterBindings, [func.output.name, result], ...aliasBindings]),
      localMetadata: new Map(
        func.aliases.map((alias) => {
          const expression = alias.exprNode as RosettaExpression;
          const kind = expressionMetadataKind(expression);
          return [alias.name, kind ? { kind, many: expressionIsMany(expression) } : undefined];
        })
      ),
      metadataAttributes: new Set(
        [...func.inputs, func.output]
          .filter((param) => param.metadataKind && !func.aliases.some((alias) => alias.name === param.name))
          .map((param) => param.name)
      ),
      superFunction: func.superFunction,
      currentFunc: func,
      outputAccumulator: isArray ? 'array' : 'scalar',
      aliasBindings,
      callGraph
    };
  }

  /**
   * T120: Emit a single set or add assignment statement.
   */
  private static emitFuncSet(assignment: RuneFuncAssignment, ctx: FuncBodyContext): string {
    return renderFuncAssignment(assignment, ctx, (expr) =>
      transpileExpression(expr as Parameters<typeof transpileExpression>[0], {
        ...ctx,
        preserveMetadata: !!assignment.metadataKind
      })
    ).join('\n');
  }

  /**
   * T121: Emit a single alias (shortcut) binding.
   */
  private static emitFuncAlias(alias: RuneFuncAlias, ctx: FuncBodyContext): string {
    const localName = ctx.aliasBindings.get(alias.name) ?? alias.name;
    const exprStr = transpileExpression(alias.exprNode as RosettaExpression, {
      ...ctx,
      preserveMetadata: !!ctx.localMetadata?.get(alias.name)
    });
    return `  const ${localName} = ${exprStr};`;
  }

  private static emitFuncConditions(conditions: readonly unknown[], func: RuneFunc, ctx: FuncBodyContext): string[] {
    const lines: string[] = [];
    for (const cond of conditions) {
      const condNode = cond as Condition;
      const condName = condNode.name ?? func.name;
      const condCtx: ExpressionTranspilerContext = {
        ...ctx,
        conditionName: condName,
        typeName: func.name,
        emitMode: 'ts-method'
      };
      const body = transpileCondition(condNode, condCtx);
      const guard = body
        .replace(/errors\.push\('(.+?)'\);/g, ctx.projection ? 'return false;' : `throw new Error('Diagnostic: $1');`)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      ctx.onConditionProjection?.(
        condNode,
        guard,
        transpileCondition(condNode, {
          ...condCtx,
          emitMode: 'ts-expression',
          objectEquality: 'method',
          projection: true
        })
      );
      lines.push(guard);
    }
    return lines;
  }

  /**
   * T124: Compose the complete function body.
   */
  private static emitFuncOutputInitialization(func: RuneFunc, ctx: FuncBodyContext): string[] {
    const result = ctx.localBindings!.get(func.output.name)!;
    const outputTs = TsNamespaceEmitter.funcParamType(func.output);
    return ctx.outputAccumulator === 'array'
      ? [`  let ${result}${ctx.projection ? '' : `: ${outputTs}[]`} = [];`]
      : [`  let ${result}${ctx.projection ? '' : `: ${outputTs} | undefined`};`];
  }

  private static emitFuncInputChecks(func: RuneFunc, ctx: FuncBodyContext): string[] {
    return [
      ...(func.isAbstract ? [] : TsNamespaceEmitter.emitFuncOutputInitialization(func, ctx)),
      ...TsNamespaceEmitter.emitFuncPrelude(func, ctx)
    ];
  }

  private static emitFuncPrelude(func: RuneFunc, ctx: FuncBodyContext): string[] {
    return [
      ...func.aliases.map((alias) => TsNamespaceEmitter.emitFuncAlias(alias, ctx)),
      ...TsNamespaceEmitter.emitFuncConditions(func.preConditions, func, ctx)
    ];
  }

  private static emitFuncBody(func: RuneFunc, ctx: FuncBodyContext): string[] {
    const bodyLines: string[] = [];
    const result = ctx.localBindings!.get(func.output.name)!;
    const assignment = func.assignments[0];
    if (
      func.assignments.length === 1 &&
      assignment?.kind === 'set' &&
      !assignment.path?.length &&
      (!assignment.target || assignment.target === func.output.name) &&
      !func.output.metadataKind &&
      !func.aliases.length &&
      !func.preConditions.length &&
      !func.postConditions.length &&
      isRosettaExpression(assignment.exprNode) &&
      (ctx.projection || expressionFitsCardinality(assignment.exprNode, func.output.cardinality))
    ) {
      if (ctx.projection && isSwitchOperation(assignment.exprNode)) {
        const targetMany = assignment.targetMany ?? ctx.outputAccumulator === 'array';
        const statement = renderTranspiledSwitch(assignment.exprNode, ctx, {
          returnStatement: true,
          returnValue: (value, expression) =>
            expression ? renderAssignmentValue(value, expression, targetMany) : targetMany ? '[]' : value,
          selectorName: freshLocal(ctx, 'switchValue')
        });
        if (statement) return statement.split('\n').map((line) => `  ${line}`);
      }
      const statement = TsNamespaceEmitter.emitFuncSet(assignment, ctx);
      if (statement.startsWith(`  ${result} = `) && !statement.includes('\n')) {
        // A local preserves structural assignment for constructor literals with additional fields.
        return isRosettaConstructorExpression(assignment.exprNode)
          ? [statement.replace(`  ${result} = `, `  const ${result} = `), `  return ${result};`]
          : [statement.replace(`  ${result} = `, '  return ')];
      }
    }
    if (func.isAbstract) {
      // Same alias-before-precondition ordering as the non-abstract path
      // below — an abstract func (no set/add body) can still declare
      // aliases per the grammar, and a pre-condition may reference one.
      bodyLines.push(...TsNamespaceEmitter.emitFuncPrelude(func, ctx));
      bodyLines.push(`  throw new Error('Diagnostic: ${func.name} — not_implemented');`);
      ctx.diagnostics.push({
        severity: 'info',
        code: 'abstract-func',
        message: `Func '${func.name}' is abstract (no body). Add a set/add body to implement it.`
      });
      return bodyLines;
    }

    bodyLines.push(...TsNamespaceEmitter.emitFuncOutputInitialization(func, ctx));

    // Aliases before pre-conditions: the grammar (rune-dsl.langium's
    // RosettaFunction rule) fixes source order as shortcuts* conditions*
    // operations* postConditions* — a pre-condition MAY reference an
    // earlier alias (real corpus case: CDM's Create_Exercise declares
    // `alias optionPayout: ...` then `condition OptionPayoutExists:
    // optionPayout exists`). Emitting pre-conditions first referenced an
    // alias's `const` binding before its declaration (a TDZ ReferenceError
    // in the generated output).
    bodyLines.push(...TsNamespaceEmitter.emitFuncPrelude(func, ctx));

    for (const assignment of func.assignments) {
      bodyLines.push(TsNamespaceEmitter.emitFuncSet(assignment, ctx));
    }

    if (!ctx.projection)
      bodyLines.push(
        ...renderCardinalityChecks(
          result,
          func.output.cardinality,
          ctx.outputAccumulator === 'array',
          `Function '${func.name}' produced ${ctx.outputAccumulator === 'array' ? 'too few results' : 'no result'}`,
          `Function '${func.name}' produced too many results`
        ).map((line) => `  ${line}`)
      );

    const postConds = TsNamespaceEmitter.emitFuncConditions(func.postConditions, func, ctx);
    for (const block of postConds) {
      bodyLines.push(block);
    }

    bodyLines.push(`  return ${result};`);

    return bodyLines;
  }

  /**
   * Emit a single func as a TypeScript function declaration.
   * T124, T126, FR-028, FR-030.
   */
  private static emitFunc(
    func: RuneFunc,
    ctx: FuncBodyContext,
    _isHoisted: boolean,
    onBody: (body: string) => void
  ): string {
    const parameters = TsNamespaceEmitter.buildFuncParameters(func);
    const outputType = TsNamespaceEmitter.buildFuncOutputType(func);
    const signature = `export function ${func.name}(${parameters}): ${outputType}`;

    const bodyLines = TsNamespaceEmitter.emitFuncBody(func, ctx);
    const body = bodyLines.join('\n');
    onBody(
      TsNamespaceEmitter.emitFuncBody(func, {
        ...ctx,
        diagnostics: [],
        objectEquality: 'method',
        projection: true,
        onConditionProjection: undefined
      })
        .join('\n')
        .split('\n')
        .map((line) => line.slice(2))
        .join('\n')
    );

    return `${signature} {\n${body}\n}`;
  }
}
