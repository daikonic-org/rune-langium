// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { AstNode } from 'langium';
import { typescriptProfile } from '../emit/typescript-profile.js';
import { isMetadataFeature, fieldMetadataKind, type FieldMetadataKind } from '../expr/metadata-runtime.js';
import { expressionIsMany, featureName } from '../expr/navigation.js';
import { expressionMetadataKind } from '../expr/metadata-type.js';
import {
  getFunctionSignature as functionSignature,
  getFunctionInputs as functionInputs,
  getFunctionOutput,
  isRosettaModel,
  isRosettaFunction,
  isAttribute,
  isShortcutDeclaration,
  isData,
  isChoice,
  isChoiceOption,
  isRosettaTypeAlias,
  type RosettaFunction,
  type Attribute,
  type TypeCall
} from '@rune-langium/core';

import type { ExpressionTranspilerContext } from '../expr/transpiler.js';
import type { GeneratorDiagnostic } from '../types.js';

// ---------------------------------------------------------------------------
// T118 — RuneFunc type definitions
// ---------------------------------------------------------------------------

export type FuncTypeNameResolver = (declaration: AstNode & { name: string }, exportedName: string) => string;

/**
 * A single input or output parameter of a Rune func declaration.
 * Extracted from the Langium Attribute AST node (RosettaFunction.inputs / output).
 */
export interface RuneFuncParam {
  /** The parameter name as declared in the Rune model. */
  name: string;
  /** Resolved type name; a target emitter may qualify declaration bindings. */
  typeName: string;
  /** Structural Shape type used by emitted TS funcs for plain Data values. */
  shapeTypeName?: string;
  metadataKind?: FieldMetadataKind;
  /**
   * Resolved cardinality.
   * lower: minimum cardinality (0 or 1).
   * upper: null = unbounded (*), otherwise the numeric upper bound.
   */
  cardinality: { lower: number; upper: number | null };
}

/**
 * A single `alias <name>: <expr>` declaration in a Rune func body.
 * Corresponds to ShortcutDeclaration in the Langium AST.
 */
export interface RuneFuncAlias {
  /** The alias identifier as declared. */
  name: string;
  /** The Langium AST expression node on the RHS (passed verbatim to transpileExpression). */
  exprNode: unknown;
}

/** A declared assignment feature, retaining its collection and wrapper boundaries. */
export interface RuneFuncAssignmentPathSegment {
  name: string;
  many: boolean;
  choiceOption?: boolean;
  metadataEntry?: string;
  metadataKind?: FieldMetadataKind;
}

/** A function's set/add operation, including the root and every explicit path segment. */
export interface RuneFuncAssignment {
  kind: 'set' | 'add';
  exprNode: unknown;
  target?: string;
  path?: RuneFuncAssignmentPathSegment[];
  rootMany?: boolean;
  rootMetadataKind?: FieldMetadataKind;
  metadataKind?: FieldMetadataKind;
  targetMany?: boolean;
  targetCardinality?: RuneFuncParam['cardinality'];
}

/**
 * A Rune `func` declaration ready for the TypeScript emitter.
 * Produced by extractFuncs() from RosettaFunction AST nodes.
 */
export interface RuneFunc {
  /** The func name as declared in the Rune model. */
  name: string;
  /** Qualified namespace string (e.g., 'cdm.base.math'). */
  namespace: string;
  /** Input parameters in declaration order. */
  inputs: RuneFuncParam[];
  /** The single output parameter. */
  output: RuneFuncParam;
  /** Name of the parent func if `extends` was used (superFunction). */
  source?: RosettaFunction;
  dispatchAttribute?: string;
  dispatchValue?: string;
  superFunc?: string;
  superFunction?: ExpressionTranspilerContext['superFunction'];
  /** Alias (shortcut) declarations in declaration order. */
  aliases: RuneFuncAlias[];
  /** Body assignments (set/add) in declaration order. */
  assignments: RuneFuncAssignment[];
  /** Pre-condition AST nodes (Condition[] from RosettaFunction.conditions). */
  preConditions: unknown[];
  /** Post-condition AST nodes (Condition[] from RosettaFunction.postConditions). */
  postConditions: unknown[];
  /** True when no set/add assignments exist (abstract func — FR-032). */
  isAbstract: boolean;
}

/**
 * Extended transpiler context for a single func body emission pass.
 * Extends ExpressionTranspilerContext with function-specific state.
 * §13 per data-model.md.
 */
export interface FuncBodyContext extends ExpressionTranspilerContext {
  /** The RuneFunc being transpiled. */
  currentFunc: RuneFunc;
  /**
   * 'scalar' when output upper bound is 1 → `let result: T`
   * 'array'  when output is unbounded   → `const result: T[] = []`
   */
  outputAccumulator: 'scalar' | 'array';
  /**
   * Maps alias declared name → emitted local variable name.
   * Populated before body emission; suffixed with `_alias` when the alias
   * name shadows an input parameter.
   */
  aliasBindings: Map<string, string>;
  /**
   * Full call graph for the namespace: funcName → Set<funcName>.
   * Shared across all FuncBodyContext instances for the same namespace.
   */
  callGraph: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// T119 — Call-graph construction
// ---------------------------------------------------------------------------

/**
 * Walk a Rune expression AST node recursively, looking for symbol references
 * that resolve to RosettaFunction nodes (function calls in the body).
 * Populates the callees set with any callee func names found.
 *
 * The Langium AST encodes a function call as a RosettaSymbolReference whose
 * symbol.ref.$type === 'RosettaFunction', or as a RosettaFeatureCall whose
 * feature.ref is a RosettaFunction. We walk all recursive sub-expressions
 * to find them.
 *
 * The `visited` WeakSet breaks cycles that occur when cross-reference `.ref`
 * objects point back into the broader AST graph (e.g. via `$container` chains
 * in large CDM namespaces). Without this guard the generic walker can produce
 * a stack overflow on deeply interconnected models.
 *
 * T119.
 */
function collectCallees(expr: unknown, callees: Set<string>, visited: WeakSet<object> = new WeakSet()): void {
  if (!expr || typeof expr !== 'object') return;
  if (visited.has(expr)) return;
  visited.add(expr);

  const node = expr as Record<string, unknown>;

  // Direct symbol reference to a function
  if (node['$type'] === 'RosettaSymbolReference') {
    const sym = node['symbol'] as Record<string, unknown> | undefined;
    if (sym) {
      const ref = sym['ref'] as Record<string, unknown> | undefined;
      if (ref && ref['$type'] === 'RosettaFunction') {
        const name = ref['name'] as string | undefined;
        if (name) callees.add(name);
      }
    }
    for (const argument of (node['rawArgs'] as unknown[] | undefined) ?? []) collectCallees(argument, callees, visited);
    return;
  }

  // Feature call that might be a function call
  if (node['$type'] === 'RosettaFeatureCall' || node['$type'] === 'RosettaDeepFeatureCall') {
    const feature = node['feature'] as Record<string, unknown> | undefined;
    if (feature) {
      const ref = feature['ref'] as Record<string, unknown> | undefined;
      if (ref && ref['$type'] === 'RosettaFunction') {
        const name = ref['name'] as string | undefined;
        if (name) callees.add(name);
      }
    }
    // Also recurse into receiver
    collectCallees(node['receiver'], callees, visited);
    return;
  }

  // Constructor expression: only walk value expressions, not typeRef/key cross-references.
  // Walking typeRef or ConstructorKeyValuePair.key causes infinite recursion into the type AST.
  if (node['$type'] === 'RosettaConstructorExpression') {
    const values = node['values'];
    if (Array.isArray(values)) {
      for (const kv of values) {
        const kvNode = kv as Record<string, unknown>;
        collectCallees(kvNode['value'], callees, visited);
      }
    }
    return;
  }

  // Recursively walk all child properties that might contain expressions
  for (const key of Object.keys(node)) {
    if (key.startsWith('$') || key === 'symbol' || key === 'assignRoot') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          collectCallees(item, callees, visited);
        }
      } else {
        collectCallees(child, callees, visited);
      }
    }
  }
}

/**
 * Build a call-graph adjacency map for a set of RuneFunc declarations.
 * Returns: funcName → Set<funcName> of callees.
 * Direct self-calls (recursion) are included.
 *
 * T119.
 */
export function buildFuncCallGraph(funcs: RuneFunc[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const funcNames = new Set(funcs.map((f) => f.name));

  for (const func of funcs) {
    const callees = new Set<string>();

    // Walk assignments
    for (const assignment of func.assignments) {
      collectCallees(assignment.exprNode, callees);
    }
    // Walk aliases
    for (const alias of func.aliases) {
      collectCallees(alias.exprNode, callees);
    }

    // Only track calls to known funcs in the same namespace
    const filteredCallees = new Set<string>();
    for (const callee of callees) {
      if (funcNames.has(callee)) {
        filteredCallees.add(callee);
      }
    }

    graph.set(func.name, filteredCallees);
  }

  return graph;
}

/**
 * Determine which funcs are in a cyclic SCC (strongly-connected component).
 * A func is cyclic if it is reachable from itself in the call graph.
 * Uses a simple reachability approach (DFS).
 *
 * T119, FR-030.
 */
export function findCyclicFuncs(callGraph: Map<string, Set<string>>): Set<string> {
  const cyclic = new Set<string>();

  function isReachable(from: string, target: string, visited: Set<string>): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    for (const callee of callGraph.get(from) ?? []) {
      if (isReachable(callee, target, visited)) return true;
    }
    return false;
  }

  for (const [func] of callGraph) {
    const callees = callGraph.get(func) ?? new Set();
    for (const callee of callees) {
      // If callee can reach func, they're in a cycle
      if (isReachable(callee, func, new Set())) {
        cyclic.add(func);
        cyclic.add(callee);
      }
    }
  }

  return cyclic;
}

/**
 * Topologically sort funcs using Kahn's algorithm, mirroring topoSort() for types.
 * Cyclic funcs (mutual recursion / self-recursion) are appended at the end
 * in stable (source-declaration) order so they can be emitted as hoisted
 * `function` declarations (FR-030).
 *
 * T118.
 */
export function topoSortFuncs(funcs: RuneFunc[], callGraph: Map<string, Set<string>>): RuneFunc[] {
  const cyclicNames = findCyclicFuncs(callGraph);

  const dacFuncs = funcs.filter((f) => !cyclicNames.has(f.name));
  const cyclicFuncs = funcs.filter((f) => cyclicNames.has(f.name));

  // Build in-degree and reversed adjacency for non-cyclic funcs
  const inDegree = new Map<string, number>();
  const reversedAdj = new Map<string, string[]>();

  for (const func of dacFuncs) {
    inDegree.set(func.name, 0);
    reversedAdj.set(func.name, []);
  }

  const dacNames = new Set(dacFuncs.map((f) => f.name));

  for (const func of dacFuncs) {
    const callees = callGraph.get(func.name) ?? new Set();
    for (const callee of callees) {
      if (!dacNames.has(callee)) continue;
      // func depends on callee → func must come after callee
      inDegree.set(func.name, (inDegree.get(func.name) ?? 0) + 1);
      reversedAdj.get(callee)!.push(func.name);
    }
  }

  // Seed queue with in-degree 0 in original declaration order
  const queue: string[] = [];
  for (const func of dacFuncs) {
    if ((inDegree.get(func.name) ?? 0) === 0) {
      queue.push(func.name);
    }
  }

  const sortedNames: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sortedNames.push(name);
    for (const dependent of reversedAdj.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) {
        queue.push(dependent);
      }
    }
  }

  // Defensive: any DAC funcs not covered (shouldn't happen)
  for (const func of dacFuncs) {
    if (!sortedNames.includes(func.name)) {
      sortedNames.push(func.name);
    }
  }

  // Reconstruct in sorted order
  const nameToFunc = new Map(funcs.map((f) => [f.name, f]));
  const result: RuneFunc[] = [];
  for (const name of sortedNames) {
    const func = nameToFunc.get(name);
    if (func) result.push(func);
  }
  // Append cyclic funcs in original declaration order
  for (const func of cyclicFuncs) {
    result.push(func);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extraction helpers (used by ts-emitter.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve a Rune type name to a TypeScript type name.
 */
export function resolveFuncTypeTs(typeName: string): string {
  const mapped =
    typescriptProfile.basicTypeMap[typeName] ??
    typescriptProfile.recordTypeMap[typeName] ??
    typescriptProfile.typeAliasMap[typeName];
  return typeof mapped === 'string' ? mapped : typeName;
}

/**
 * Build a RuneFuncParam from a Langium Attribute node.
 */
function funcTypeInfo(
  typeCall: TypeCall | undefined,
  plainDataTypeNames?: ReadonlySet<string>,
  typeNameResolver?: FuncTypeNameResolver
): { typeName: string; shapeTypeName?: string } {
  const ref = typeCall?.type?.ref;
  const typeName = ref?.name ?? typeCall?.type?.$refText ?? 'unknown';
  const shapeTypeName =
    isData(ref) || isChoice(ref) || plainDataTypeNames?.has(typeName)
      ? `${typeName}Shape`
      : isRosettaTypeAlias(ref)
        ? typeName
        : undefined;
  return {
    typeName: ref && typeNameResolver ? typeNameResolver(ref, typeName) : typeName,
    shapeTypeName: ref && shapeTypeName && typeNameResolver ? typeNameResolver(ref, shapeTypeName) : shapeTypeName
  };
}

function extractParam(
  attr: Attribute,
  plainDataTypeNames?: ReadonlySet<string>,
  typeNameResolver?: FuncTypeNameResolver
): RuneFuncParam {
  const { typeName, shapeTypeName } = funcTypeInfo(attr.typeCall, plainDataTypeNames, typeNameResolver);
  const card = attr.card;
  const lower = card?.inf ?? 1;
  const upper: number | null = card?.unbounded ? null : (card?.sup ?? lower);
  return {
    name: attr.name,
    typeName,
    shapeTypeName,
    metadataKind: fieldMetadataKind(attr),
    cardinality: { lower, upper }
  };
}

/** Resolve an Attribute's plain-data TypeScript value type at a func boundary. */
export function resolveFuncValueTypeTs(
  attr: { typeCall?: TypeCall },
  plainDataTypeNames?: ReadonlySet<string>,
  typeNameResolver?: FuncTypeNameResolver
): string {
  const param = funcTypeInfo(attr.typeCall, plainDataTypeNames, typeNameResolver);
  return param.shapeTypeName ? `RuneFuncData<${param.shapeTypeName}>` : resolveFuncTypeTs(param.typeName);
}

/**
 * Extract all RosettaFunction elements from Langium documents as RuneFunc records.
 * Called by the TS emitter before func emission.
 *
 * @param docs - Langium documents for a namespace.
 * @param namespace - The namespace string.
 * @param diagnostics - Diagnostics accumulator.
 */
export function extractFuncs(
  docs: { parseResult?: { value?: unknown } }[],
  namespace: string,
  diagnostics: GeneratorDiagnostic[],
  plainDataTypeNames?: ReadonlySet<string>,
  typeNameResolver?: FuncTypeNameResolver
): RuneFunc[] {
  const funcs: RuneFunc[] = [];
  const declarations = docs.flatMap((doc) => {
    const model = doc.parseResult?.value;
    return isRosettaModel(model) ? model.elements.filter(isRosettaFunction) : [];
  });
  for (const doc of docs) {
    const model = doc.parseResult?.value;
    if (!isRosettaModel(model)) continue;
    for (const node of model.elements) {
      if (!isRosettaFunction(node)) continue;
      const signature = functionSignature(node, declarations);
      const inputs = functionInputs(signature).map((attr) => extractParam(attr, plainDataTypeNames, typeNameResolver));
      const outputNode = functionOutput(signature);
      if (!outputNode) {
        diagnostics.push({
          severity: 'warning',
          code: 'func-no-output',
          message: `Func '${node.name}' in namespace '${namespace}' has no output declaration`
        });
      }
      const output = outputNode
        ? extractParam(outputNode, plainDataTypeNames, typeNameResolver)
        : { name: 'result', typeName: 'unknown', cardinality: { lower: 1, upper: 1 } };
      const parent = node.superFunction?.ref;
      const assignments = node.operations.map((operation): RuneFuncAssignment => {
        const path: RuneFuncAssignmentPathSegment[] = [];
        const root = operation.assignRoot.ref ?? functionAttribute(signature, operation.assignRoot.$refText);
        const rootMany = isAttribute(root)
          ? root.card.unbounded || (root.card.sup ?? 1) > 1
          : isShortcutDeclaration(root) && expressionIsMany(root.expression);
        const rootMetadataKind = isAttribute(root)
          ? fieldMetadataKind(root)
          : isShortcutDeclaration(root)
            ? expressionMetadataKind(root.expression)
            : undefined;
        let target: AstNode | undefined = root;
        for (let segment = operation.path; segment; segment = segment.next) {
          target = segment.feature.ref;
          path.push({
            name: isChoiceOption(target)
              ? featureName(target)
              : (segment.feature.ref?.name ?? segment.feature.$refText),
            ...(isChoiceOption(target) ? { choiceOption: true } : {}),
            ...(isMetadataFeature(target) ? { metadataEntry: segment.feature.$refText } : {}),
            many: isAttribute(target) && (target.card.unbounded || (target.card.sup ?? 1) > 1),
            metadataKind: isAttribute(target) || isChoiceOption(target) ? fieldMetadataKind(target) : undefined
          });
        }
        return {
          kind: operation.add ? 'add' : 'set',
          exprNode: operation.expression,
          target: operation.assignRoot.ref?.name ?? operation.assignRoot.$refText,
          rootMany,
          rootMetadataKind,
          metadataKind: isAttribute(target) || isChoiceOption(target) ? fieldMetadataKind(target) : undefined,
          targetMany: isAttribute(target) ? target.card.unbounded || (target.card.sup ?? 1) > 1 : undefined,
          ...(path.length > 0 && (isAttribute(target) || isChoiceOption(target))
            ? { targetCardinality: isAttribute(target) ? extractParam(target).cardinality : { lower: 1, upper: 1 } }
            : {}),
          path
        };
      });
      funcs.push({
        name: node.name,
        namespace,
        source: node,
        inputs,
        output,
        dispatchAttribute: node.dispatchAttribute?.ref?.name ?? node.dispatchAttribute?.$refText,
        dispatchValue: node.dispatchValue?.value.ref?.name ?? node.dispatchValue?.value.$refText,
        superFunc: parent?.name ?? node.superFunction?.$refText,
        superFunction: parent
          ? { name: parent.name, inputs: functionInputs(parent), output: functionOutput(parent), source: parent }
          : undefined,
        aliases: node.shortcuts.map((alias) => ({ name: alias.name, exprNode: alias.expression })),
        assignments,
        preConditions: node.conditions,
        postConditions: node.postConditions,
        isAbstract: assignments.length === 0
      });
    }
  }
  return funcs;
}

export function functionOutput(node: RosettaFunction, seen: Set<RosettaFunction> = new Set()): Attribute | undefined {
  return getFunctionOutput(node, seen);
}

export { functionSignature, functionInputs };

/** Resolve a signature attribute, including inherited inputs and output. */
export function functionAttribute(func: RosettaFunction, name: string): Attribute | undefined {
  const output = functionOutput(func);
  return output?.name === name ? output : functionInputs(func).find((input) => input.name === name);
}
