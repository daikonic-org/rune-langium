// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getEnumValues,
  getOperationArgument,
  isChoice,
  isOneOfOperation,
  isChoiceOperation,
  isRosettaExistsExpression,
  isRosettaAbsentExpression,
  isRosettaOnlyExistsExpression,
  isRosettaSymbolReference,
  isRosettaEnumValue,
  isArithmeticOperation,
  isComparisonOperation,
  isEqualityOperation,
  isLogicalOperation,
  isRosettaContainsExpression,
  isRosettaDisjointExpression,
  isRosettaCountOperation,
  isDistinctOperation,
  isFilterOperation,
  isFirstOperation,
  isFlattenOperation,
  isLastOperation,
  isMapOperation,
  isMaxOperation,
  isMinOperation,
  isReverseOperation,
  isSortOperation,
  isSumOperation,
  isRosettaFeatureCall,
  isRosettaDeepFeatureCall,
  isRosettaConditionalExpression,
  isRosettaBooleanLiteral,
  isRosettaIntLiteral,
  isRosettaNumberLiteral,
  isRosettaStringLiteral,
  isRosettaImplicitVariable,
  isRosettaConstructorExpression,
  isListLiteral,
  isThenOperation,
  isAsKeyOperation,
  isWithMetaOperation,
  isDefaultOperation,
  isJoinOperation,
  isRosettaOnlyElement,
  isReduceOperation,
  isToStringOperation,
  isToNumberOperation,
  isToIntOperation,
  isToEnumOperation,
  isToDateOperation,
  isToTimeOperation,
  isToDateTimeOperation,
  isToZonedDateTimeOperation,
  isSwitchOperation,
  isRosettaSuperCall,
  isAttribute,
  isRosettaRecordType,
  isChoiceOption,
  type Attribute,
  type RosettaType,
  type Condition,
  type RosettaExpression,
  type ThenOperation
} from '@rune-langium/core';
import {
  fieldMetadataKind,
  hasFieldMetadata,
  isMetadataFeature,
  metadataPropertyPath,
  metadataType,
  unwrapMetadata,
  normalizeMetadataExpression,
  type FieldMetadataKind
} from './metadata-runtime.js';
import { renderMetadataOperation } from './metadata-operation.js';
import { adaptCardinalityValue } from './cardinality.js';
import { decodeCardinality } from '../emit/base-namespace-emitter.js';
import { expressionMetadataKind, choiceSelectionMetadata } from './metadata-type.js';
import { functionOutput, resolveFuncValueTypeTs, type FuncTypeNameResolver } from '../types/func.js';
import { renderAsExpression, renderSwitchExpression } from './switch-expression.js';
import { renderOnlyExists } from './only-exists.js';
import { arrowBody, freshLocal, inlineContext, bindImplicitFeatures } from './inline-function.js';
import { renderCardinalityOperation } from './cardinality-operations.js';
import {
  renderNavigation,
  renderCalendarField,
  expressionType,
  expressionIsMany,
  typeFeatures,
  featureName
} from './navigation.js';

/** Rune expressions shared by generated functions and validators. */

import { renderResolvedFunctionCall } from './function-call.js';
import { renderCollectionOperation } from './collection-operations.js';
import { callableExportName, type CallableDeclaration } from '../emit/callable-names.js';
import type { GeneratorDiagnostic } from '../types.js';
import {
  nativeEqualityOperands,
  nativeScalarOperands,
  scalarEqualityOperands,
  nativeTemporalOperands,
  temporalScalarTypes,
  requiredScalarKind
} from './scalar-operators.js';

// ---------------------------------------------------------------------------
// Operator precedence table — copied from expression-node-to-dsl.ts (prior art).
// Lower number = lower precedence = binds less tightly.
// ---------------------------------------------------------------------------
const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '=': 3,
  '<>': 3,
  contains: 3,
  disjoint: 3,
  default: 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6
};

/**
 * Context passed to the expression transpiler for a single condition block.
 * Not exposed in the public API. Per data-model §7.
 */
export interface ExpressionTranspilerContext {
  /** Capture an emitted condition without repeating resolution or rendering. */
  onConditionProjection?: (condition: Condition, code: string, predicate: string) => void;
  /**
   * The name of the `this` value in the emitted predicate.
   * In superRefine mode: `data` (the `.superRefine((data, ctx) =>` parameter).
   * In refine mode: `data` (the `.refine((data) =>` parameter).
   * In ts-method mode: `this` (the class instance).
   */
  selfName: string;
  implicitMetadata?: { kind: FieldMetadataKind; many: boolean };
  localMetadata?: ReadonlyMap<string, { kind: FieldMetadataKind; many: boolean } | undefined>;
  metadataAttributes?: ReadonlySet<string>;
  preserveMetadata?: boolean;
  typeNameResolver?: FuncTypeNameResolver;
  callableName?: (declaration: CallableDeclaration, forceAlias?: boolean) => string;
  /**
   * How to emit errors.
   * 'zod-refine': predicate returns a boolean.
   * 'zod-superRefine': predicate calls ctx.addIssue({...}).
   * 'ts-method': predicate pushes to a local `errors` array (no Zod dependency).
   */
  emitMode: 'zod-refine' | 'zod-superRefine' | 'ts-method' | 'ts-expression';
  /** Value expression context for a generated Rune function. */
  superFunction?: {
    name: string;
    inputs: readonly FunctionCallParameter[];
    output?: Attribute;
    source?: CallableDeclaration;
  };
  /**
   * The name of the condition being transpiled (for error messages).
   */
  conditionName: string;
  /**
   * The type name the condition is attached to (for error messages).
   */
  typeName: string;
  /**
   * Map of attribute names to their type strings (for existence checks).
   * Derived from the parent Data node's attribute list.
   */
  attributeTypes: Map<string, string>;
  /**
   * Accumulated diagnostics (mutated by the transpiler).
   */
  diagnostics: GeneratorDiagnostic[];
  /**
   * Optional map of local variable bindings (e.g., alias name → emitted TS variable name).
   * When a RosettaSymbolReference or other name lookup finds a key in this map,
   * the emitted name is the mapped value rather than `${selfName}.${name}`.
   * Resolves aliases in generated function bodies.
   */
  localBindings?: Map<string, string>;
  /**
   * Optional map of attribute name → the PROPERTY-ACCESS SUFFIX to use
   * instead of the bare name (i.e. `${selfName}.${attrAccessorNames.get(name)}`
   * instead of `${selfName}.${name}`), for attribute names that resolve to
   * a DIFFERENT emitted field key than the name a Rune condition literally
   * references.
   *
   * Data-extends-Choice is the sole current use: a condition like `Cash is
   * absent` (real corpus text: `Basket is absent`,
   * observable-asset-type.rosetta:231) is authored against the Choice
   * OPTION's Data-type name, capitalized (`Cash`) — that's what
   * `buildAttributeTypesMap`'s pseudo-attribute keys are, and it MUST stay
   * that way for `validateAttr` to match the condition's own AST text. But
   * the REAL emitted field key at that position is camelCase-first-letter
   * of the same name (`cash`) — `choiceOptionFieldName`'s established W2
   * convention, used identically by both the TS type alias's union member
   * keys (`{ cash: Cash }`) and the Zod arm's object key
   * (`z.strictObject({ cash: CashSchema })`). Without this remap, a
   * transpiled predicate reads `data.Cash` (undefined at runtime) instead
   * of `data.cash` (the actual populated field) — a silent false-negative
   * (the condition never fires because the read is always `undefined`).
   */
  attrAccessorNames?: Map<string, string>;
}

function diagnosticFallback(message: string): string {
  return `(() => { throw new Error(${JSON.stringify(message)}); })()`;
}

/**
 * Resolve the emitted property-access expression for an attribute name:
 * `${ctx.selfName}.${name}` by default, or `${ctx.selfName}.${accessor}`
 * when `ctx.attrAccessorNames` maps `name` to a different emitted field key
 * (Data-extends-Choice pseudo-attributes — see `attrAccessorNames`'s doc
 * comment on `ExpressionTranspilerContext`). Centralizing this resolution
 * (rather than inlining `${ctx.selfName}.${name}` at each of the many
 * Phase 4 emit* call sites) is what makes the remap apply uniformly to
 * every condition kind (exists/absent/one-of/only-exists/choice) without
 * touching each one's template separately.
 *
 * `ts-method` mode ONLY (`ctx.selfName === 'this'`, the class-instance
 * case): a remapped access (i.e. `name` IS a Choice-derived pseudo-
 * attribute — `attrAccessorNames` is NEVER populated for ordinary Data
 * attributes, see its doc comment) is cast through
 * `(this as unknown as Record<string, unknown>)` — the emitted class does
 * not statically declare the Choice's option keys as members (per T105/
 * T106's generic-intersection-alias / generic-child-class design, they
 * only exist on `this` at runtime via `Object.assign` in the constructor),
 * so a direct `this.cash` fails real `tsc --strict` (TS2339). The Zod
 * modes' `selfName` (`data`, a function parameter typed by the actual
 * `runeExtendChoice`-derived union) already carries the option keys
 * structurally and need no cast.
 */
export function attrAccessExpr(name: string, ctx: ExpressionTranspilerContext): string {
  const accessor = ctx.attrAccessorNames?.get(name);
  const raw =
    ctx.localBindings?.get(name) ??
    (accessor !== undefined && ctx.emitMode === 'ts-method'
      ? `(${ctx.selfName} as unknown as Record<string, unknown>).${accessor}`
      : `${ctx.selfName}.${accessor ?? name}`);
  if (ctx.localMetadata?.has(name)) {
    const metadata = ctx.localMetadata.get(name);
    return metadata && !ctx.preserveMetadata ? unwrapMetadata(raw, metadata.many) : raw;
  }
  return ctx.metadataAttributes?.has(name) && !ctx.preserveMetadata
    ? unwrapMetadata(raw, ctx.attributeTypes.get(name)?.includes('[]') ?? false)
    : raw;
}

/**
 * Extract the attribute name from a RosettaSymbolReference argument.
 * Returns undefined if the argument is not a symbol reference.
 */
function extractAttrName(argument: RosettaExpression | undefined): string | undefined {
  if (!argument) return undefined;
  if (isRosettaSymbolReference(argument)) {
    return isChoiceOption(argument.symbol.ref) ? featureName(argument.symbol.ref) : argument.symbol.$refText;
  }
  return undefined;
}

/**
 * Validate that an attribute name exists in the context.
 * If not, emit a diagnostic and return false.
 *
 * A name is valid if it's either a real Data/func-input/output attribute
 * (`ctx.attributeTypes`) OR a func-scope alias binding (`ctx.localBindings`
 * — populated for `RosettaFunction.shortcuts` by ts-emitter's
 * `buildFuncBodyContext`; real corpus case: CDM's `Create_Exercise` func
 * declares `alias optionPayout: <navigation expr>` then
 * `condition OptionPayoutExists: optionPayout exists`). `attrAccessExpr`
 * (used to emit the actual access expression) already checks
 * `localBindings` first — this function is the validation gate that must
 * agree with it, or a valid alias reference in `exists`/`is absent`/
 * `one-of`/`choice`/`only-exists` incorrectly falls through to the
 * unknown-attribute DIAGNOSTIC even though the emitted access expression
 * would have resolved correctly.
 * FR-025.
 */
function validateAttr(attrName: string, ctx: ExpressionTranspilerContext): boolean {
  if (!ctx.attributeTypes.has(attrName) && !ctx.localBindings?.has(attrName)) {
    ctx.diagnostics.push({
      severity: 'error',
      code: 'unknown-attribute',
      message: `Condition '${ctx.conditionName}' on type '${ctx.typeName}' references unknown attribute '${attrName}'`
    });
    return false;
  }
  return true;
}

/**
 * Emit a one-of predicate.
 * Handles: OneOfOperation with argument being a ListLiteral (multiple attrs)
 * or a single SymbolReference (single attr — treated as one-of with just that attr).
 *
 * T053.
 */
export function emitOneOf(attrNames: string[], ctx: ExpressionTranspilerContext): string {
  const attrList = attrNames.map((n) => attrAccessExpr(n, ctx)).join(', ');
  const message = `${ctx.conditionName}: exactly one of [${attrNames.join(', ')}] must be present in ${ctx.typeName}`;

  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    return `rune.checkOneOf([${attrList}])`;
  }

  if (ctx.emitMode === 'ts-method') {
    return [`if (!rune.checkOneOf([${attrList}])) {`, `  errors.push('${message}');`, `}`].join('\n');
  }

  // superRefine mode
  return [
    `if (!rune.checkOneOf([${attrList}])) {`,
    `  ctx.addIssue({`,
    `    code: 'custom',`,
    `    message: '${message}',`,
    `    path: ['${ctx.conditionName}']`,
    `  });`,
    `}`
  ].join('\n');
}

/**
 * Emit a choice predicate (same semantics as one-of: exactly one present).
 * Uses rune.checkOneOf on the listed attribute refs.
 *
 * T053.
 */
export function emitChoice(attrNames: string[], ctx: ExpressionTranspilerContext): string {
  const attrList = attrNames.map((n) => attrAccessExpr(n, ctx)).join(', ');
  const message = `${ctx.conditionName}: exactly one of [${attrNames.join(', ')}] must be present in ${ctx.typeName}`;

  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    return `rune.checkOneOf([${attrList}])`;
  }

  if (ctx.emitMode === 'ts-method') {
    return [`if (!rune.checkOneOf([${attrList}])) {`, `  errors.push('${message}');`, `}`].join('\n');
  }

  // superRefine mode
  return [
    `if (!rune.checkOneOf([${attrList}])) {`,
    `  ctx.addIssue({`,
    `    code: 'custom',`,
    `    message: '${message}',`,
    `    path: ['${ctx.conditionName}']`,
    `  });`,
    `}`
  ].join('\n');
}

/**
 * Emit an exists predicate.
 * T054.
 */
export function emitExists(attrName: string, ctx: ExpressionTranspilerContext): string {
  if (!validateAttr(attrName, ctx)) {
    return `/* DIAGNOSTIC: unknown attribute "${attrName}" */`;
  }

  const access = attrAccessExpr(attrName, ctx);
  const message = `${ctx.conditionName}: ${attrName} must be present in ${ctx.typeName}`;

  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    return `rune.exists(${access})`;
  }

  if (ctx.emitMode === 'ts-method') {
    return [`if (!rune.exists(${access})) {`, `  errors.push('${message}');`, `}`].join('\n');
  }

  // superRefine mode
  return [
    `if (!rune.exists(${access})) {`,
    `  ctx.addIssue({`,
    `    code: 'custom',`,
    `    message: '${message}',`,
    `    path: ['${ctx.conditionName}']`,
    `  });`,
    `}`
  ].join('\n');
}

/**
 * Emit an is-absent predicate.
 * T054.
 */
export function emitIsAbsent(attrName: string, ctx: ExpressionTranspilerContext): string {
  if (!validateAttr(attrName, ctx)) {
    return `/* DIAGNOSTIC: unknown attribute "${attrName}" */`;
  }

  const access = attrAccessExpr(attrName, ctx);
  const message = `${ctx.conditionName}: ${attrName} must be absent in ${ctx.typeName}`;

  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    return `!rune.exists(${access})`;
  }

  if (ctx.emitMode === 'ts-method') {
    return [`if (rune.exists(${access})) {`, `  errors.push('${message}');`, `}`].join('\n');
  }

  // superRefine mode
  return [
    `if (rune.exists(${access})) {`,
    `  ctx.addIssue({`,
    `    code: 'custom',`,
    `    message: '${message}',`,
    `    path: ['${ctx.conditionName}']`,
    `  });`,
    `}`
  ].join('\n');
}

/**
 * Emit an only-exists predicate.
 * Semantics: all attributes NOT in attrNames must be absent.
 * T054.
 */
export function emitOnlyExists(allowedAttrNames: string[], ctx: ExpressionTranspilerContext): string {
  // Validate all allowed attrs exist on the type
  for (const name of allowedAttrNames) {
    validateAttr(name, ctx);
  }

  // Find all attributes on the type that are NOT in the allowed list
  const forbiddenAttrs = Array.from(ctx.attributeTypes.keys()).filter((name) => !allowedAttrNames.includes(name));

  const message = `${ctx.conditionName}: only [${allowedAttrNames.join(', ')}] may exist in ${ctx.typeName}`;

  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    if (forbiddenAttrs.length === 0) {
      return 'true';
    }
    if (forbiddenAttrs.length === 1) {
      return `!rune.exists(${attrAccessExpr(forbiddenAttrs[0]!, ctx)})`;
    }
    return forbiddenAttrs.map((n) => `!rune.exists(${attrAccessExpr(n, ctx)})`).join(' && ');
  }

  if (ctx.emitMode === 'ts-method') {
    if (forbiddenAttrs.length === 0) {
      return '// only-exists: no forbidden attributes';
    }
    const checks = forbiddenAttrs.map((n) =>
      [`if (rune.exists(${attrAccessExpr(n, ctx)})) {`, `  errors.push('${message}');`, `}`].join('\n')
    );
    return checks.join('\n');
  }

  // superRefine mode — emit one addIssue block per forbidden attr
  if (forbiddenAttrs.length === 0) {
    return '// only-exists: no forbidden attributes';
  }
  const checks = forbiddenAttrs.map((n) =>
    [
      `if (rune.exists(${attrAccessExpr(n, ctx)})) {`,
      `  ctx.addIssue({`,
      `    code: 'custom',`,
      `    message: '${message}',`,
      `    path: ['${ctx.conditionName}']`,
      `  });`,
      `}`
    ].join('\n')
  );
  return checks.join('\n');
}

/**
 * Build the descriptive error message for a condition.
 * Used by emitConditionBlock for the `.refine()` message argument.
 */
export function buildConditionMessage(cond: Condition, ctx: ExpressionTranspilerContext): string {
  const expr = cond.expression;
  if (!expr) return `${ctx.conditionName} failed`;

  if (isOneOfOperation(expr)) {
    if (expr.argument && typeFeatures(expressionType(expr.argument)).length)
      return wrapBoolExprForMode(transpileExpression(expr, ctx), ctx);
    const arg = expr.argument;
    let names: string[];
    if (!arg) {
      names = Array.from(ctx.attributeTypes.keys());
    } else {
      const listLiteral = arg as {
        $type?: string;
        elements?: Array<RosettaExpression>;
      };
      if (listLiteral.$type === 'ListLiteral' && Array.isArray(listLiteral.elements)) {
        names = listLiteral.elements.map((e) => extractAttrName(e)).filter((n): n is string => n !== undefined);
      } else {
        const name = extractAttrName(arg);
        names = name ? [name] : [];
      }
    }
    return `${ctx.conditionName}: exactly one of [${names.join(', ')}] must be present in ${ctx.typeName}`;
  }

  if (isChoiceOperation(expr)) {
    const attrNames = (expr.attributes ?? [])
      .map((ref) => ref.$refText ?? ref.ref?.name)
      .filter((n): n is string => n !== undefined);
    return `${ctx.conditionName}: exactly one of [${attrNames.join(', ')}] must be present in ${ctx.typeName}`;
  }

  if (isRosettaExistsExpression(expr)) {
    const name = extractAttrName(expr.argument);
    if (name !== undefined) {
      return `${ctx.conditionName}: ${name} must be present in ${ctx.typeName}`;
    }
    // Complex argument (navigation, filter, etc.) — fall through to default
  }

  if (isRosettaAbsentExpression(expr)) {
    const name = extractAttrName(expr.argument);
    if (name !== undefined) {
      return `${ctx.conditionName}: ${name} must be absent in ${ctx.typeName}`;
    }
    // Complex argument — fall through to default
  }

  if (isRosettaOnlyExistsExpression(expr)) {
    const arg = expr.argument as
      | {
          $type?: string;
          elements?: Array<RosettaExpression>;
        }
      | undefined;
    let names: string[] = [];
    if (arg && arg.$type === 'ListLiteral' && Array.isArray(arg.elements)) {
      names = arg.elements.map((e) => extractAttrName(e)).filter((n): n is string => n !== undefined);
    }
    return `${ctx.conditionName}: only [${names.join(', ')}] may exist in ${ctx.typeName}`;
  }

  return `${ctx.conditionName}: condition failed in ${ctx.typeName}`;
}

/**
 * Dispatcher: transpile a single Condition AST node into a JS predicate string.
 * Routes to the appropriate emitter based on the expression type.
 *
 * T052.
 */
export function transpileCondition(cond: Condition, ctx: ExpressionTranspilerContext): string {
  const expr = cond.expression;

  if (!expr) {
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'empty-condition',
      message: `Condition '${ctx.conditionName}' on type '${ctx.typeName}' has no expression`
    });
    return diagnosticFallback(`Condition '${ctx.conditionName}' has no expression`);
  }

  const cardinality = renderCardinalityOperation(expr, ctx, transpileExpression);
  if (cardinality !== undefined) return wrapBoolExprForMode(cardinality, ctx);
  if (isChoiceOperation(expr) && (expr.necessity === 'optional' || expr.argument)) {
    return wrapBoolExprForMode(transpileExpression(expr, ctx), ctx);
  }

  // one-of: `[a, b, c] one-of` → OneOfOperation with argument = ListLiteral
  if (isOneOfOperation(expr)) {
    const arg = expr.argument;
    if (!arg) {
      // Type-level one-of (no explicit argument): apply to all attrs
      const allAttrs = Array.from(ctx.attributeTypes.keys());
      return emitOneOf(allAttrs, ctx);
    }
    // arg is a ListLiteral
    if (isListLiteral(arg)) {
      const names = arg.elements.map((e) => extractAttrName(e)).filter((n): n is string => n !== undefined);
      // Validate each attr name
      for (const name of names) {
        validateAttr(name, ctx);
      }
      return emitOneOf(names, ctx);
    }
    // Single symbol reference
    const name = extractAttrName(arg);
    if (name) {
      validateAttr(name, ctx);
      return emitOneOf([name], ctx);
    }
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'unsupported-condition',
      message: `one-of argument type '${arg.$type}' is not supported`
    });
    return diagnosticFallback(`Unsupported one-of condition in '${ctx.conditionName}'`);
  }

  // choice: `required choice a, b, c` → ChoiceOperation with attributes list
  if (isChoiceOperation(expr)) {
    const attrNames = (expr.attributes ?? [])
      .map((ref) => ref.$refText ?? ref.ref?.name)
      .filter((n): n is string => n !== undefined);
    for (const name of attrNames) {
      validateAttr(name, ctx);
    }
    return emitChoice(attrNames, ctx);
  }

  // exists: `a exists` → RosettaExistsExpression
  if (isRosettaExistsExpression(expr)) {
    const name = extractAttrName(expr.argument);
    if (name) {
      // Direct attribute reference.
      return emitExists(name, ctx);
    }
    // Navigation or another value expression.
    // → transpile to boolean expression and wrap for mode
    if (expr.argument) {
      const boolExpr = `rune.exists(${transpileExpression(expr.argument, ctx)})`;
      return wrapBoolExprForMode(boolExpr, ctx);
    }
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'unsupported-condition',
      message: `exists condition in '${ctx.conditionName}' has no attribute reference`
    });
    return diagnosticFallback(`Unsupported exists condition in '${ctx.conditionName}'`);
  }

  // is absent: `a is absent` → RosettaAbsentExpression
  if (isRosettaAbsentExpression(expr)) {
    const name = extractAttrName(expr.argument);
    if (name) {
      // Direct attribute reference.
      return emitIsAbsent(name, ctx);
    }
    // Navigation or another value expression.
    if (expr.argument) {
      const boolExpr = `!rune.exists(${transpileExpression(expr.argument, ctx)})`;
      return wrapBoolExprForMode(boolExpr, ctx);
    }
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'unsupported-condition',
      message: `is-absent condition in '${ctx.conditionName}' has no attribute reference`
    });
    return diagnosticFallback(`Unsupported is-absent condition in '${ctx.conditionName}'`);
  }

  if (isRosettaOnlyExistsExpression(expr)) {
    const predicate = renderOnlyExists(
      expr,
      ctx,
      (node) => transpileExpression(node, ctx),
      (name) => attrAccessExpr(name, ctx)
    );
    if (predicate !== undefined) return wrapBoolExprForMode(predicate, ctx);
  }

  // only exists: `[a, b] only exists` or `(a, b) only exists` → RosettaOnlyExistsExpression
  if (isRosettaOnlyExistsExpression(expr)) {
    // Paren-tuple form: `(a, b, c) only exists` — grammar populates `args`
    // (NOT `argument`) via the PrimaryExpression multi-arg escape hatch
    // (`'(' Expression (',' args+=Expression)+ ')' 'only' 'exists'`).
    if (expr.args.length > 0) {
      const names = expr.args.map((e) => extractAttrName(e)).filter((n): n is string => n !== undefined);
      return emitOnlyExists(names, ctx);
    }
    const arg = expr.argument;
    if (!arg) {
      ctx.diagnostics.push({
        severity: 'warning',
        code: 'unsupported-condition',
        message: `only-exists condition in '${ctx.conditionName}' has no list argument`
      });
      return diagnosticFallback(`Unsupported only-exists condition in '${ctx.conditionName}'`);
    }
    if (isListLiteral(arg)) {
      const names = arg.elements.map((e) => extractAttrName(e)).filter((n): n is string => n !== undefined);
      return emitOnlyExists(names, ctx);
    }
    // Single attr
    const name = extractAttrName(arg);
    if (name) {
      return emitOnlyExists([name], ctx);
    }
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'unsupported-condition',
      message: `only-exists list in '${ctx.conditionName}' is not a list literal`
    });
    return diagnosticFallback(`Unsupported only-exists condition in '${ctx.conditionName}'`);
  }

  // Other conditions use the shared expression dispatcher.
  // transpileExpression returns a boolean JS expression string.
  const boolExpr = transpileExpression(expr, ctx);
  return wrapBoolExprForMode(boolExpr, ctx);
}

/**
 * Return true if `expr` is a bare function call with no top-level binary operators.
 * Used to decide whether `!expr` is safe (no redundant parens) vs `!(expr)` required.
 *
 * Examples:
 *   "rune.exists(x)"                 → true  → !rune.exists(x)
 *   "rune.exists(x) || something"    → false → !(rune.exists(x) || something)
 *   "rune.count(x) > 0"                  → false → !(rune.count(x) > 0)
 */
function isSimpleFuncCall(expr: string): boolean {
  // Walk the string, track paren/bracket depth.
  // If we find a top-level binary operator, it's not a simple call.
  let depth = 0;
  let inCall = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(' || ch === '[') {
      if (depth === 0 && i > 0) inCall = true;
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0) {
      // Top-level character — any space indicates a binary operator follows
      if (ch === ' ') return false;
    }
  }
  // Must start with an identifier and end with ) to be a function call
  return inCall && depth === 0 && /^\w/.test(expr) && expr.endsWith(')');
}

/**
 * Wrap a boolean JS expression string for the current emit mode.
 *
 * In zod-refine mode: return the expression as-is (used as predicate).
 * In zod-superRefine mode: wrap in an if(!expr) { ctx.addIssue({...}) } block.
 *
 * T074.
 */
function wrapBoolExprForMode(boolExpr: string, ctx: ExpressionTranspilerContext): string {
  if (ctx.emitMode === 'zod-refine' || ctx.emitMode === 'ts-expression') {
    return boolExpr;
  }

  const message = `${ctx.conditionName}: condition failed in ${ctx.typeName}`;
  const negation = isSimpleFuncCall(boolExpr) ? `!${boolExpr}` : `!(${boolExpr})`;

  if (ctx.emitMode === 'ts-method') {
    return [`if (${negation}) {`, `  errors.push('${message}');`, `}`].join('\n');
  }

  // superRefine mode
  // Omit redundant parens when the expression is a single function call with
  // no top-level binary operators — matching oxfmt's no-redundant-parens style.
  // Use !(expr) for binary/comparison/logical expressions to preserve semantics.
  return [
    `if (${negation}) {`,
    `  ctx.addIssue({`,
    `    code: 'custom',`,
    `    message: '${message}',`,
    `    path: ['${ctx.conditionName}']`,
    `  });`,
    `}`
  ].join('\n');
}

// ============================================================================
// Phase 5 — Full expression transpiler (T067–T075)
// ============================================================================

/**
 * T067: Transpile literal expressions to JS literal equivalents.
 *
 * RosettaBooleanLiteral → true / false
 * RosettaIntLiteral     → <number> (BigInt → Number conversion)
 * RosettaNumberLiteral  → <number>
 * RosettaStringLiteral  → '<escaped-string>'
 */
export function transpileLiteral(expr: RosettaExpression, _ctx: ExpressionTranspilerContext): string {
  if (isRosettaBooleanLiteral(expr)) {
    return expr.value ? 'true' : 'false';
  }
  if (isRosettaIntLiteral(expr)) {
    // BigInt → number (generator uses number literals in JS output)
    return String(Number(expr.value));
  }
  if (isRosettaNumberLiteral(expr)) {
    return String(expr.value);
  }
  if (isRosettaStringLiteral(expr)) {
    // JSON-escape and use single quotes
    const escaped = expr.value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }
  return diagnosticFallback('Invalid expression: unknown literal');
}

/**
 * T068: Transpile navigation chains (a -> b -> c) to optional-chain JS.
 *
 * RosettaFeatureCall { receiver, feature } → receiver?.feature
 * RosettaDeepFeatureCall { receiver, feature } → receiver?.feature  (deep is flat here)
 *
 * Uses ctx.selfName as the root binding (default 'data').
 * FR-013: optional chaining for path navigation.
 */
export function transpileNavigation(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (isRosettaFeatureCall(expr) || isRosettaDeepFeatureCall(expr)) {
    const feature = expr.feature?.ref;
    const calendarField = renderCalendarField(
      feature,
      () => transpileExpression(expr.receiver, { ...ctx, preserveMetadata: false }),
      expressionIsMany(expr.receiver),
      ctx.emitMode.startsWith('ts-'),
      requiredScalarKind(expr.receiver) !== undefined
    );
    if (calendarField !== undefined) return calendarField;
    if (ctx.emitMode.startsWith('ts-') && isRosettaEnumValue(feature)) {
      return `(${JSON.stringify(feature.name)} as const)`;
    }
    if (
      ctx.emitMode.startsWith('ts-') &&
      (isAttribute(feature) || feature?.$type === 'RosettaMetaType') &&
      isMetadataFeature(feature)
    ) {
      const receiver = expr.receiver
        ? transpileExpression(expr.receiver, { ...ctx, preserveMetadata: true })
        : ctx.selfName;
      const key = feature.name;
      const read = (value: string) => {
        const access = `(${value})${metadataPropertyPath(key)
          .map((key) => `?.${key}`)
          .join('')}`;
        return `(${access} as ${resolveFuncValueTypeTs(feature, undefined, ctx.typeNameResolver)} | undefined)`;
      };
      if (expr.receiver ? expressionIsMany(expr.receiver) : ctx.implicitMetadata?.many) {
        const item = freshLocal(ctx, '__metadataItem');
        return `(${receiver} ?? []).map((${item}) => ${read(item)}).filter((value) => value != null)`;
      }
      return read(receiver);
    }
  }
  const rendered = renderNavigation(expr, (child) => transpileExpression(child, { ...ctx, preserveMetadata: false }));
  if (rendered !== undefined) {
    const feature = isRosettaFeatureCall(expr) || isRosettaDeepFeatureCall(expr) ? expr.feature?.ref : undefined;
    return isAttribute(feature) && hasFieldMetadata(feature) && !ctx.preserveMetadata && ctx.emitMode.startsWith('ts-')
      ? unwrapMetadata(rendered, expressionIsMany(expr))
      : rendered;
  }
  const message = `Cannot resolve navigation in '${ctx.conditionName}'`;
  ctx.diagnostics.push({ severity: 'error', code: 'unresolved-navigation', message });
  return diagnosticFallback(message);
}

/**
 * T069: Transpile arithmetic operations (+, -, *, /).
 * Returns a JS infix expression string.
 *
 * Operator mapping: + → +, - → -, * → *, / → /
 */
export function transpileArithmetic(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isArithmeticOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ArithmeticOperation');
  }
  const left = transpileExpression(expr.left, ctx);
  const right = transpileExpression(expr.right, ctx);
  const scalar = nativeScalarOperands(expr.left, expr.right);
  if (scalar === 'number' || (scalar === 'string' && expr.operator === '+'))
    return `(${left} ${expr.operator} ${right})`;
  if (requiredScalarKind(expr.left) === 'date') {
    const rightKind = requiredScalarKind(expr.right);
    if (rightKind === 'date' && expr.operator === '-')
      return ctx.emitMode.startsWith('ts-')
        ? `${right}.until(${left}).days`
        : `Temporal.PlainDate.from(${right}).until(${left}).days`;
    if (rightKind === 'time' && expr.operator === '+')
      return ctx.emitMode.startsWith('ts-')
        ? `${left}.toPlainDateTime(${right})`
        : `Temporal.PlainDate.from(${left}).toPlainDateTime(Temporal.PlainTime.from(${right})).toString()`;
  }
  const leftType = expressionType(expr.left)?.name;
  const rightType = expressionType(expr.right)?.name;
  const operation =
    leftType === 'date' && rightType === 'date' && expr.operator === '-'
      ? ctx.emitMode.startsWith('ts-')
        ? 'b.until(a).days'
        : 'Temporal.PlainDate.from(String(b)).until(Temporal.PlainDate.from(String(a))).days'
      : leftType === 'date' && rightType === 'time' && expr.operator === '+'
        ? ctx.emitMode.startsWith('ts-')
          ? 'a.toPlainDateTime(b)'
          : 'Temporal.PlainDate.from(String(a)).toPlainDateTime(Temporal.PlainTime.from(String(b))).toString()'
        : `a ${expr.operator} b`;
  return `rune.binary(${left}, ${right}, (a, b) => ${operation})`;
}

/**
 * T069: Transpile comparison operations (<, <=, >, >=) and equality (=, <>).
 * Returns a JS boolean expression string.
 *
 * Operator mapping: = → ===, <> → !==, <, <=, >, >= → direct.
 */
export function transpileComparison(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (isEqualityOperation(expr)) {
    const left = expr.left ? transpileExpression(expr.left, ctx) : ctx.selfName;
    const right = transpileExpression(expr.right, ctx);
    if (ctx.emitMode.startsWith('ts-') && nativeTemporalOperands(expr.left, expr.right))
      return `${expr.operator === '<>' ? '!' : ''}${left}.equals(${right})`;
    const isoDates = !ctx.emitMode.startsWith('ts-');
    if (nativeEqualityOperands(expr.left, expr.right, isoDates)) {
      // Widen the proven primitive so nested predicates do not trigger TS2367.
      const kind = scalarEqualityOperands(expr.left, expr.right, isoDates)!;
      const type = nativeScalarOperands(expr.left, expr.right) ? kind : `${kind} | undefined`;
      return `((${left} as ${type}) ${expr.operator === '<>' ? '!==' : '==='} ${right})`;
    }
    return `(rune.valueKey(${left}) ${expr.operator === '<>' ? '!==' : '==='} rune.valueKey(${right}))`;
  }
  if (isComparisonOperation(expr)) {
    const left = expr.left ? transpileExpression(expr.left, ctx) : ctx.selfName;
    const right = transpileExpression(expr.right, ctx);
    const scalar = nativeScalarOperands(expr.left, expr.right);
    if (scalar === 'number' || scalar === 'string') return `(${left} ${expr.operator} ${right})`;
    const nativeTemporal = nativeTemporalOperands(expr.left, expr.right);
    if (nativeTemporal)
      return `(Temporal.${nativeTemporal === 'zonedDateTime' && !ctx.emitMode.startsWith('ts-') ? 'Instant' : temporalScalarTypes[nativeTemporal]}.compare(${left}, ${right}) ${expr.operator} 0)`;
    const name = expressionType(expr.left ?? getOperationArgument(expr))?.name;
    const kind =
      name && name in temporalScalarTypes ? temporalScalarTypes[name as keyof typeof temporalScalarTypes] : undefined;
    const parser = kind === 'ZonedDateTime' ? 'rune.parseZonedDateTime' : `Temporal.${kind}.from`;
    const comparison = kind
      ? ctx.emitMode.startsWith('ts-')
        ? `Temporal.${kind}.compare(a, b) ${expr.operator} 0`
        : `Temporal.${kind}.compare(${parser}(String(a)), ${parser}(String(b))) ${expr.operator} 0`
      : `a ${expr.operator} b`;
    return `rune.compare(${left}, ${right}, (a, b) => ${comparison}, ${JSON.stringify(expr.cardMod ?? 'all')})`;
  }
  return diagnosticFallback('Invalid expression: not a comparison');
}

/**
 * T070: Transpile boolean logical operations (and → &&, or → ||).
 * Parenthesizes children when child precedence is lower than parent.
 */
export function transpileBoolean(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isLogicalOperation(expr)) {
    return diagnosticFallback('Invalid expression: not LogicalOperation');
  }
  const jsOp = expr.operator === 'and' ? '&&' : '||';
  const left = transpileWithPrecedence(expr.left, expr.operator, ctx, 'left');
  const right = transpileWithPrecedence(expr.right, expr.operator, ctx, 'right');
  return `${left} ${jsOp} ${right}`;
}

/** Compare collection membership using Rune value equality. */
export function transpileSetOps(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (isRosettaContainsExpression(expr)) {
    const right = transpileExpression(expr.right, ctx);
    const left = expr.left ? transpileExpression(expr.left, ctx) : `(${ctx.selfName} ?? [])`;
    return `rune.contains(${left}, ${right})`;
  }
  if (isRosettaDisjointExpression(expr)) {
    const right = transpileExpression(expr.right, ctx);
    const left = expr.left ? transpileExpression(expr.left, ctx) : `(${ctx.selfName} ?? [])`;
    return `rune.disjoint(${left}, ${right})`;
  }
  return diagnosticFallback('Invalid expression: not a set-op');
}

/** Lower aggregates, preserving collection order and empty-value behavior. */
export function transpileAggregation(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  const collection = renderCollectionOperation(expr, ctx, transpileExpression);
  if (collection !== undefined) return collection;
  // Helper: get the argument expression (or ctx.selfName if no argument)
  const getArg = (arg: RosettaExpression | undefined): string => (arg ? transpileExpression(arg, ctx) : ctx.selfName);

  if (isRosettaCountOperation(expr)) {
    return `rune.count(${getArg(expr.argument)})`;
  }
  if (isSumOperation(expr)) {
    const arr = getArg(expr.argument);
    return `rune.list(${arr}).reduce((a, b) => a + b, 0)`;
  }
  if (isDistinctOperation(expr)) {
    const arr = getArg(expr.argument);
    const kind = ctx.preserveMetadata ? expressionMetadataKind(expr.argument) : undefined;
    const value = kind ? unwrapMetadata('value', false) : 'value';
    return `rune.distinct(${arr}${kind ? `, (value) => rune.valueKey(${value})` : ''})`;
  }
  if (isFirstOperation(expr)) {
    const arr = getArg(expr.argument);
    return `rune.list(${arr})[0]`;
  }
  if (isLastOperation(expr)) {
    const arr = getArg(expr.argument);
    return `rune.list(${arr}).at(-1)`;
  }
  if (isFlattenOperation(expr)) {
    const arr = getArg(expr.argument);
    return `rune.list(${arr}).flat()`;
  }
  if (isReverseOperation(expr)) {
    const arr = getArg(expr.argument);
    return `rune.list(${arr}).slice().reverse()`;
  }
  return diagnosticFallback('Invalid expression: unknown aggregation');
}

/**
 * T073: Transpile higher-order operations (filter, map/extract).
 *
 * filter: (arr ?? []).filter((item) => <body>)
 * map:    (arr ?? []).map((item) => <body>)
 *
 * The lambda body is transpiled with a child context where selfName = lambda param name.
 */
export function transpileHigherOrder(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  return (
    renderCollectionOperation(expr, ctx, transpileExpression) ?? diagnosticFallback('Expected a collection operation')
  );
}

/**
 * Transpile a ThenOperation (pipeline/pipe operator).
 *
 * Grammar: `argument then [ImplicitInlineFunction]`
 * Semantics: apply the inline function to the argument.
 *   No function → identity (return argument unchanged).
 *   With function → `((param) => body)(arg)`
 */
export function transpileThenOperation(expr: ThenOperation, ctx: ExpressionTranspilerContext): string {
  const argumentCtx = expr.function && ctx.emitMode.startsWith('ts-') ? { ...ctx, preserveMetadata: true } : ctx;
  const argument = expr.argument ? transpileExpression(expr.argument, argumentCtx) : ctx.selfName;
  if (!expr.function) return argument;
  const kind = argumentCtx.preserveMetadata ? expressionMetadataKind(expr.argument) : undefined;
  const parameter = freshLocal(ctx, '__pipe');
  const body = transpileExpression(
    expr.function.body,
    inlineContext(expr.function, ctx, [parameter], kind ? { kind, many: expressionIsMany(expr.argument) } : undefined)
  );
  return `((${parameter}) => (${body}))(${argument})`;
}

/** Emit a value ternary; condition callers wrap the resulting predicate. */
export function transpileConditional(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isRosettaConditionalExpression(expr)) {
    return diagnosticFallback('Expected a conditional expression');
  }
  const kind = ctx.preserveMetadata ? expressionMetadataKind(expr) : undefined;
  const antecedent = transpileExpression(expr.if, { ...ctx, preserveMetadata: false });
  const branch = (node: RosettaExpression | undefined) =>
    isListLiteral(node) && node.elements.length === 0 && !expressionIsMany(expr)
      ? 'undefined'
      : transpileMetadataBranch(node, kind, ctx);
  const consequent = branch(expr.ifthen);
  const alternative = expr.elsethen ? branch(expr.elsethen) : ctx.emitMode === 'ts-expression' ? 'undefined' : 'true';
  return `(${antecedent} ? ${consequent} : ${alternative})`;
}

/** Emit declared constructor fields; an empty constructor becomes an empty object. */
export function transpileConstructor(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isRosettaConstructorExpression(expr)) {
    return diagnosticFallback('Invalid expression: not RosettaConstructorExpression');
  }
  if (expr.values.length === 0) {
    return expressionType(expr.typeRef)?.$type === 'Choice' ? 'undefined' : '{}';
  }
  const pairs = expr.values
    .map((kv) => {
      const field = kv.key.ref;
      const key = isChoiceOption(field) ? featureName(field) : (kv.key.$refText ?? '?');
      const val =
        isAttribute(field) || isChoiceOption(field)
          ? prepareFunctionArgument(
              transpileExpression(kv.value, {
                ...ctx,
                preserveMetadata: ctx.emitMode.startsWith('ts-') && hasFieldMetadata(field)
              }),
              isChoiceOption(field)
                ? { name: key, annotations: field.annotations, cardinality: { lower: 1, upper: 1 } }
                : field,
              ctx,
              kv.value
            )
          : transpileExpression(kv.value, ctx);
      return `${key}: ${val}`;
    })
    .join(', ');
  const type = expressionType(expr.typeRef);
  return isRosettaRecordType(type) && ['date', 'dateTime', 'zonedDateTime'].includes(type.name)
    ? `rune.${ctx.emitMode.startsWith('ts-') ? 'dateConstructTemporal' : 'dateConstruct'}(${JSON.stringify(type.name)}, { ${pairs} })`
    : `{ ${pairs} }`;
}

/**
 * T077: Transpile a list literal to a JS array literal.
 *
 * ListLiteral { elements } → [ elem1, elem2, ... ]
 */
export function transpileListLiteral(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isListLiteral(expr)) {
    return diagnosticFallback('Invalid expression: not ListLiteral');
  }
  const kind = ctx.preserveMetadata ? expressionMetadataKind(expr) : undefined;
  const elements = expr.elements.map((element) => transpileMetadataBranch(element, kind, ctx));
  const list = `[${elements.map((element) => `...rune.list(${element})`).join(', ')}]`;
  return kind ? `${list}.filter((value) => value != null)` : list;
}

/** Preserve metadata wrappers when the receiving context requires them. */
export function transpilePassthrough(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isAsKeyOperation(expr) && !isWithMetaOperation(expr))
    return diagnosticFallback('Expected a metadata expression');
  if (!ctx.emitMode.startsWith('ts-') || (isAsKeyOperation(expr) && !ctx.preserveMetadata))
    return transpileExpression(expr.argument, ctx);
  const value = renderMetadataOperation(expr, ctx, (node) => {
    const rendered = transpileExpression(node, { ...ctx, preserveMetadata: node === expr.argument });
    return node === expr.argument && expressionIsMany(node) ? `(${rendered} ?? [])` : rendered;
  });
  if (value === undefined) return diagnosticFallback('Expected a metadata expression');
  const fieldMetadata =
    isWithMetaOperation(expr) && expr.entries.some((entry) => !['key', 'template'].includes(entry.key.$refText));
  return fieldMetadata && !ctx.preserveMetadata ? unwrapMetadata(value, expressionIsMany(expr.argument)) : value;
}

function transpileMetadataBranch(
  node: RosettaExpression | undefined,
  kind: FieldMetadataKind | undefined,
  ctx: ExpressionTranspilerContext
): string {
  const value = node ? transpileExpression(node, ctx) : ctx.selfName;
  const sourceKind = node ? expressionMetadataKind(node) : ctx.implicitMetadata?.kind;
  return normalizeMetadataExpression(value, sourceKind, kind);
}

/** Use the right operand lazily when the left operand is absent or empty. */
export function transpileDefault(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isDefaultOperation(expr)) {
    return diagnosticFallback('Invalid expression: not DefaultOperation');
  }
  const kind = ctx.preserveMetadata ? expressionMetadataKind(expr) : undefined;
  const left = transpileMetadataBranch(expr.left, kind, ctx);
  const right = transpileMetadataBranch(expr.right, kind, ctx);
  const value = freshLocal(ctx, '__default');
  return `((${value}) => ${value} == null || (Array.isArray(${value}) && ${value}.length === 0) ? ${right} : ${value})(${left})`;
}

export function transpileJoin(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isJoinOperation(expr)) {
    return diagnosticFallback('Invalid expression: not JoinOperation');
  }
  const left = expr.left ? transpileExpression(expr.left, ctx) : ctx.selfName;
  const right = expr.right ? transpileExpression(expr.right, ctx) : "''";
  return `(${left} ?? []).join(${right})`;
}

export function transpileOnlyElement(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isRosettaOnlyElement(expr)) {
    return diagnosticFallback('Invalid expression: not RosettaOnlyElement');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return `((__oe) => (__oe.length === 1 ? __oe[0] : undefined))(rune.list(${arg}))`;
}

export function transpileReduce(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isReduceOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ReduceOperation');
  }
  const fn = expr.function;
  const argumentCtx = fn && ctx.emitMode.startsWith('ts-') ? { ...ctx, preserveMetadata: true } : ctx;
  const arr = expr.argument ? transpileExpression(expr.argument, argumentCtx) : ctx.selfName;
  if (!fn) {
    return `(${arr} ?? [])`;
  }
  const inputKind = argumentCtx.preserveMetadata ? expressionMetadataKind(expr.argument) : undefined;
  const resultKind = argumentCtx.preserveMetadata ? expressionMetadataKind(fn.body) : undefined;
  const accName = freshLocal(ctx, fn.parameters[0]?.name ?? 'a');
  const itemName = freshLocal({ ...ctx, selfName: accName }, fn.parameters[1]?.name ?? 'b');
  const childCtx = inlineContext(
    fn,
    { ...ctx, preserveMetadata: argumentCtx.preserveMetadata },
    [accName, itemName],
    inputKind ? { kind: inputKind, many: false } : undefined
  );
  const localMetadata = new Map(childCtx.localMetadata);
  if (fn.parameters[0])
    localMetadata.set(fn.parameters[0].name, resultKind ? { kind: resultKind, many: false } : undefined);
  const body = transpileExpression(fn.body, {
    ...childCtx,
    localMetadata,
    implicitMetadata: resultKind ? { kind: resultKind, many: false } : undefined
  });
  const values = freshLocal(ctx, '__reduce');
  let initial = `${values}[0]`;
  if (inputKind !== resultKind) {
    initial = resultKind
      ? `${resultKind === 'reference' ? 'rune.toReference' : 'rune.toField'}(${initial}, ${JSON.stringify(inputKind ?? 'value')})`
      : unwrapMetadata(initial, false);
  }
  const input =
    inputKind === 'reference' && !resultKind
      ? `(${arr} ?? []).filter((value): value is typeof value & { value: NonNullable<typeof value.value> } => value.value != null)`
      : `rune.list(${arr})`;
  const reduced = `((${values}) => ${values}.length === 0 ? undefined : ${values}.slice(1).reduce((${accName}, ${itemName}) => ${arrowBody(body)}, ${initial}))(${input})`;
  return resultKind && !ctx.preserveMetadata ? unwrapMetadata(reduced, false) : reduced;
}

/**
 * TypeScript calendar conversions construct Temporal values; Zod predicates
 * retain ISO strings to match their JSON schema representation.
 *
 * ToStringOperation / ToNumberOperation / ToIntOperation are undefined-guarded
 * per sibling conventions (see transpileLiteral / transpileAggregation).
 *
 * ToIntOperation semantics: Rune's reference generator (TypeCoercionService,
 * BigDecimal→int coercion) fails when the value has a fractional part —
 * verified against `.resources/rune-dsl-src`; mirrored here via
 * `Number.isInteger`.
 *
 * ToEnumOperation resolves against the emitted enum shape. ts-emitter's
 * `emitEnumDeclaration` emits enums as a plain string-literal union
 * (`export type Foo = 'A' | 'B'`), i.e. the member NAME is its own runtime
 * value — so enum resolution is a membership check against the reference
 * enum's `enumValues` names, not a display-name lookup or const-object index.
 */
export function transpileToString(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToStringOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToStringOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  // Bind once via IIFE — matches to-number/to-int; avoids double-evaluating
  // a non-trivial argument (switch IIFE, function call).
  return `((__s) => (__s === undefined ? undefined : String(__s)))(${arg})`;
}

export function transpileToNumber(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToNumberOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToNumberOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return `((__n) => (__n === undefined ? undefined : Number.isNaN(Number(__n)) ? undefined : Number(__n)))(${arg})`;
}

export function transpileToInt(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToIntOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToIntOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return `((__i) => (__i === undefined ? undefined : Number.isInteger(Number(__i)) ? Number(__i) : undefined))(${arg})`;
}

export function transpileToEnum(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToEnumOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToEnumOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  const enumRef = expr.enumeration?.ref;
  if (!enumRef) {
    ctx.diagnostics.push({
      severity: 'error',
      code: 'unresolved-enum-reference',
      message: `to-enum in '${ctx.conditionName}' references an unresolved enumeration '${expr.enumeration?.$refText ?? '?'}'`
    });
    return diagnosticFallback(
      `Unresolved enum reference '${expr.enumeration?.$refText ?? '?'}' in '${ctx.conditionName}'`
    );
  }
  const memberList = getEnumValues(enumRef)
    .map((v) => `'${v.name}'`)
    .join(', ');
  return `((__e) => ([${memberList}]${ctx.emitMode.startsWith('ts-') ? ' as const' : ''}).find((value) => value === __e))(${arg})`;
}

export function transpileToDate(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToDateOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToDateOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return ctx.emitMode.startsWith('ts-')
    ? `((value) => value === undefined ? undefined : Temporal.PlainDate.from(value))(rune.toDate(${arg}))`
    : `rune.toDate(${arg})`;
}

export function transpileToTime(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToTimeOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToTimeOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return ctx.emitMode.startsWith('ts-')
    ? `((value) => value === undefined ? undefined : Temporal.PlainTime.from(value))(rune.toTime(${arg}))`
    : `rune.toTime(${arg})`;
}

export function transpileToDateTime(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToDateTimeOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToDateTimeOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return ctx.emitMode.startsWith('ts-')
    ? `((value) => value === undefined ? undefined : Temporal.PlainDateTime.from(value))(rune.toDateTime(${arg}))`
    : `rune.toDateTime(${arg})`;
}

export function transpileToZonedDateTime(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isToZonedDateTimeOperation(expr)) {
    return diagnosticFallback('Invalid expression: not ToZonedDateTimeOperation');
  }
  const arg = expr.argument ? transpileExpression(expr.argument, ctx) : ctx.selfName;
  return ctx.emitMode.startsWith('ts-')
    ? `((value) => value === undefined ? undefined : rune.parseZonedDateTime(value))(rune.toZonedDateTime(${arg}))`
    : `rune.toZonedDateTime(${arg})`;
}

function typedDataGuard(ctx: ExpressionTranspilerContext, kind?: FieldMetadataKind) {
  return ctx.emitMode.startsWith('ts-')
    ? (value: string, type: RosettaType, guard: string, wrapped: boolean) => {
        const shape = ctx.typeNameResolver?.(type, `${type.name}Shape`) ?? `${type.name}Shape`;
        const target = metadataType(
          ctx.emitMode === 'ts-method' ? shape : `RuneFuncData<${shape}>`,
          wrapped ? kind : undefined
        );
        return `((${value}: unknown): ${value} is ${target} => ${guard})(${value})`;
      }
    : undefined;
}

/** Select a declared switch branch and bind its implicit item. */
export function transpileSwitch(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  const kind = ctx.preserveMetadata ? expressionMetadataKind(expr) : undefined;
  const argument = isSwitchOperation(expr) ? getOperationArgument(expr) : undefined;
  const inputType = expressionType(argument);
  const selectorKind = ctx.emitMode.startsWith('ts-') ? expressionMetadataKind(argument) : undefined;
  const selectorMany = expressionIsMany(argument);
  const result = renderSwitchExpression(expr, {
    typeGuard: typedDataGuard(ctx, selectorKind),
    selfName: ctx.selfName,
    ...(selectorKind
      ? {
          selector: {
            name: freshLocal(ctx, '__switchSource'),
            unwrap: (selector: string) => unwrapMetadata(selector, selectorMany)
          }
        }
      : {}),
    renderExpression: (node, options) => {
      if (!options?.selfName)
        return transpileExpression(node, { ...ctx, preserveMetadata: node === argument && !!selectorKind });
      if (isListLiteral(node) && node.elements.length === 0 && !expressionIsMany(expr)) return 'undefined';
      return transpileMetadataBranch(
        node,
        kind,
        bindImplicitFeatures(
          {
            ...ctx,
            selfName: options.selfName,
            implicitMetadata: (() => {
              const branchKind =
                options.projected && isChoice(inputType) && options.target
                  ? choiceSelectionMetadata(inputType, options.target)
                  : selectorKind;
              return branchKind ? { kind: branchKind, many: options.projected ? false : selectorMany } : undefined;
            })()
          },
          options.target
        )
      );
    },
    report: (message) => ctx.diagnostics.push({ severity: 'error', code: 'unresolved-switch-guard', message })
  });
  return result ?? diagnosticFallback(`Invalid switch expression in '${ctx.conditionName}'`);
}

type FunctionCallParameter = Pick<Attribute, 'name'> &
  Partial<Pick<Attribute, 'annotations' | 'card'>> & { cardinality?: { lower: number; upper: number | null } };

function prepareFunctionArgument(
  value: string,
  parameter: FunctionCallParameter,
  ctx: ExpressionTranspilerContext,
  argument?: RosettaExpression
): string {
  const kind = ctx.emitMode.startsWith('ts-') ? fieldMetadataKind(parameter) : undefined;
  const cardinality = parameter.cardinality ?? (parameter.card ? decodeCardinality(parameter.card) : undefined);
  const many = cardinality?.upper === null || (cardinality?.upper ?? 1) > 1;
  const sourceKind = argument
    ? isRosettaImplicitVariable(argument)
      ? ctx.implicitMetadata?.kind
      : isRosettaSymbolReference(argument) && ctx.localMetadata?.has(argument.symbol.$refText)
        ? ctx.localMetadata.get(argument.symbol.$refText)?.kind
        : expressionMetadataKind(argument)
    : ctx.implicitMetadata?.kind;
  if (!argument && sourceKind && !kind) value = unwrapMetadata(value, ctx.implicitMetadata?.many ?? false);
  if (ctx.emitMode.startsWith('ts-') && (cardinality || (sourceKind === 'reference' && !kind))) {
    value = adaptCardinalityValue(
      value,
      cardinality ?? { lower: 1, upper: 1 },
      `Argument '${parameter.name}'`,
      argument
    );
  } else if (many) {
    value = `((value) => value == null ? [] : Array.isArray(value) ? value : [value])(${value})`;
  }
  if (kind && sourceKind !== kind) {
    const helper = kind === 'reference' ? 'rune.toReference' : 'rune.toField';
    const inputKind = JSON.stringify(sourceKind ?? 'value');
    value =
      !many && cardinality?.lower === 0
        ? `((value) => value == null ? undefined : ${helper}(value, ${inputKind}))(${value})`
        : `${helper}(${value}, ${inputKind})`;
  }
  return value;
}

/** Call the enclosing function's parent with explicit or forwarded arguments. */
export function transpileSuperCall(expr: RosettaExpression, ctx: ExpressionTranspilerContext): string {
  if (!isRosettaSuperCall(expr)) {
    return diagnosticFallback('Invalid expression: not RosettaSuperCall');
  }
  if (ctx.superFunction) {
    const parent = ctx.superFunction;
    if (expr.explicitArguments && expr.rawArgs.length !== parent.inputs.length) {
      const message = `super() expects ${parent.inputs.length} arguments, received ${expr.rawArgs.length}`;
      ctx.diagnostics.push({ severity: 'error', code: 'invalid-super-call', message });
      return diagnosticFallback(message);
    }
    const args = parent.inputs.map((input, index) => {
      const argumentCtx = { ...ctx, preserveMetadata: ctx.emitMode.startsWith('ts-') && hasFieldMetadata(input) };
      const arg = expr.rawArgs[index];
      return expr.explicitArguments && arg
        ? prepareFunctionArgument(transpileExpression(arg, argumentCtx), input, ctx, arg)
        : attrAccessExpr(input.name, argumentCtx);
    });
    const name = parent.source
      ? (ctx.callableName?.(parent.source, ctx.localBindings?.has(parent.name) || ctx.selfName === parent.name) ??
        parent.name)
      : parent.name;
    const call = `${name}({ ${parent.inputs.map((input, i) => `${input.name}: ${args[i]}`).join(', ')} })`;
    const output = parent.output;
    return output && hasFieldMetadata(output) && !ctx.preserveMetadata && ctx.emitMode.startsWith('ts-')
      ? unwrapMetadata(call, output.card.unbounded || (output.card.sup ?? 1) > 1)
      : call;
  }
  ctx.diagnostics.push({
    severity: 'error',
    code: 'unsupported-super-call',
    message: `Condition '${ctx.conditionName}' on type '${ctx.typeName}' calls super(), which has no meaning in a transpiled validation predicate`
  });
  return diagnosticFallback(
    `Condition '${ctx.conditionName}' on type '${ctx.typeName}' calls super(), which has no meaning in a transpiled validation predicate`
  );
}

/** Lower an expression to JavaScript or TypeScript source; invalid nodes produce diagnostics. */
export function transpileExpression(
  expr: RosettaExpression | undefined | null,
  ctx: ExpressionTranspilerContext
): string {
  if (!expr) {
    return diagnosticFallback(`Null expression in '${ctx.conditionName}'`);
  }

  if (expr.$type === 'AsOperation') {
    const kind = expressionMetadataKind(expr);
    const inputKind = expressionMetadataKind(getOperationArgument(expr));
    const result = renderAsExpression(expr, {
      typeGuard: typedDataGuard(ctx, inputKind),
      selfName: ctx.selfName,
      renderExpression: (node) => transpileExpression(node, { ...ctx, preserveMetadata: true }),
      ...(inputKind
        ? { selector: { name: '__asSource', unwrap: (value: string) => unwrapMetadata(value, false) } }
        : {}),
      report: (message) => ctx.diagnostics.push({ severity: 'error', code: 'invalid-type-narrowing', message })
    });
    if (result === undefined) return diagnosticFallback(`Invalid narrowing in '${ctx.conditionName}'`);
    return kind && !ctx.preserveMetadata ? unwrapMetadata(result, expressionIsMany(expr)) : result;
  }

  // Literals (T067)
  if (
    isRosettaBooleanLiteral(expr) ||
    isRosettaIntLiteral(expr) ||
    isRosettaNumberLiteral(expr) ||
    isRosettaStringLiteral(expr)
  ) {
    return transpileLiteral(expr, ctx);
  }

  // Symbol reference — attribute or lambda parameter (T068 / T075)
  if (isRosettaSymbolReference(expr)) {
    const name = isChoiceOption(expr.symbol.ref)
      ? featureName(expr.symbol.ref)
      : (expr.symbol?.$refText ?? expr.symbol?.ref?.name ?? '?');
    const target = expr.symbol?.ref;
    const calendarField = renderCalendarField(
      target,
      () => ctx.selfName,
      expressionIsMany(expr),
      ctx.emitMode.startsWith('ts-')
    );
    if (calendarField !== undefined) return calendarField;
    // Aliases and parameters shadow model symbols.
    if (ctx.localBindings?.has(name)) {
      return attrAccessExpr(name, ctx);
    }
    if (target?.$type === 'RosettaFunction') {
      let failure = `Function '${target.name}' requires arguments`;
      const call = renderResolvedFunctionCall(
        expr,
        (arg, parameter) =>
          transpileExpression(arg, {
            ...ctx,
            preserveMetadata: ctx.emitMode.startsWith('ts-') && hasFieldMetadata(parameter)
          }),
        (message) => {
          failure = message;
        },
        ctx.selfName,
        (value, parameter, argument) => prepareFunctionArgument(value, parameter, ctx, argument),
        ctx.callableName?.(target, ctx.localBindings?.has(target.name) || ctx.selfName === target.name)
      );
      if (call !== undefined) {
        const output = functionOutput(target);
        return output && hasFieldMetadata(output) && !ctx.preserveMetadata && ctx.emitMode.startsWith('ts-')
          ? unwrapMetadata(call, output.card.unbounded || (output.card.sup ?? 1) > 1)
          : call;
      }
      ctx.diagnostics.push({ severity: 'error', code: 'invalid-function-call', message: failure });
      return diagnosticFallback(failure);
    }
    if (target?.$type === 'RosettaExternalFunction' || target?.$type === 'RosettaRule') {
      const inputCount = target.$type === 'RosettaRule' ? (target.input ? 1 : 0) : target.parameters.length;
      const prepare = (argument: RosettaExpression | undefined, index: number) =>
        prepareFunctionArgument(
          argument ? transpileExpression(argument, { ...ctx, preserveMetadata: false }) : ctx.selfName,
          {
            name: target.$type === 'RosettaExternalFunction' ? (target.parameters[index]?.name ?? 'input') : 'input',
            cardinality:
              target.$type === 'RosettaExternalFunction' && target.parameters[index]?.isArray
                ? { lower: 0, upper: null }
                : { lower: 1, upper: 1 }
          },
          ctx,
          argument
        );
      const args = expr.explicitArguments ? expr.rawArgs.map(prepare) : inputCount === 1 ? [prepare(undefined, 0)] : [];
      if (args.length !== inputCount) {
        const message = `Function '${target.name}' expects ${inputCount} arguments, received ${args.length}`;
        ctx.diagnostics.push({ severity: 'error', code: 'invalid-function-call', message });
        return diagnosticFallback(message);
      }
      const exported = callableExportName(target);
      const callable =
        ctx.callableName?.(target, ctx.localBindings?.has(exported) || ctx.selfName === exported) ?? exported;
      return `${callable}(${args.join(', ')})`;
    }
    if (target?.$type === 'RosettaEnumeration') return target.name;
    if (isRosettaEnumValue(target)) {
      return ctx.emitMode.startsWith('ts-') ? `(${JSON.stringify(target.name)} as const)` : JSON.stringify(target.name);
    }
    return attrAccessExpr(name, ctx);
  }

  // Implicit variable (lambda parameter 'item')
  if (isRosettaImplicitVariable(expr)) {
    return ctx.implicitMetadata && !ctx.preserveMetadata
      ? unwrapMetadata(ctx.selfName, ctx.implicitMetadata.many)
      : ctx.selfName;
  }

  // Navigation (T068)
  if (isRosettaFeatureCall(expr) || isRosettaDeepFeatureCall(expr)) {
    return transpileNavigation(expr, ctx);
  }

  const collection = renderCollectionOperation(expr, ctx, (node, childCtx) =>
    transpileExpression(node, { ...ctx, ...childCtx })
  );
  if (collection !== undefined) return collection;

  const valueCtx = ctx.preserveMetadata ? { ...ctx, preserveMetadata: false } : ctx;
  const cardinality = renderCardinalityOperation(expr, valueCtx, transpileExpression);
  if (cardinality !== undefined) return cardinality;

  if (isOneOfOperation(expr)) {
    if (!expr.argument) return emitOneOf([...ctx.attributeTypes.keys()], { ...valueCtx, emitMode: 'zod-refine' });
    if (isListLiteral(expr.argument)) return `rune.checkOneOf(${transpileExpression(expr.argument, valueCtx)})`;
    const argument = transpileExpression(expr.argument, valueCtx);
    const fields = typeFeatures(expressionType(expr.argument)).map(featureName);
    if (fields.length)
      return `((__one) => __one != null && rune.checkOneOf([${fields.map((name) => `__one[${JSON.stringify(name)}]`).join(', ')}]))(${argument})`;
    return `((__one) => rune.checkOneOf(Array.isArray(__one) ? __one : [__one]))(${argument})`;
  }
  if (isChoiceOperation(expr)) {
    const names = expr.attributes
      .map((attribute) => attribute.$refText ?? attribute.ref?.name)
      .filter((name): name is string => name !== undefined);
    const value = expr.argument ? transpileExpression(expr.argument, valueCtx) : undefined;
    const values = names
      .map((name) => (value ? `__choice[${JSON.stringify(name)}]` : attrAccessExpr(name, valueCtx)))
      .join(', ');
    const predicate =
      expr.necessity === 'optional'
        ? `[${values}].filter((value) => rune.exists(value)).length <= 1`
        : `rune.checkOneOf([${values}])`;
    return value ? `((__choice) => __choice != null && (${predicate}))(${value})` : predicate;
  }

  // Arithmetic (T069)
  if (isArithmeticOperation(expr)) {
    return transpileArithmetic(expr, valueCtx);
  }

  // Comparison and equality (T069)
  if (isComparisonOperation(expr) || isEqualityOperation(expr)) {
    return transpileComparison(expr, valueCtx);
  }

  // Boolean logical (T070)
  if (isLogicalOperation(expr)) {
    return transpileBoolean(expr, valueCtx);
  }

  // Set operations (T071)
  if (isRosettaContainsExpression(expr) || isRosettaDisjointExpression(expr)) {
    return transpileSetOps(expr, valueCtx);
  }

  // Aggregations (T072)
  if (
    isRosettaCountOperation(expr) ||
    isSumOperation(expr) ||
    isMinOperation(expr) ||
    isMaxOperation(expr) ||
    isSortOperation(expr) ||
    isDistinctOperation(expr) ||
    isFirstOperation(expr) ||
    isLastOperation(expr) ||
    isFlattenOperation(expr) ||
    isReverseOperation(expr)
  ) {
    return transpileAggregation(expr, isSumOperation(expr) || isRosettaCountOperation(expr) ? valueCtx : ctx);
  }

  // Higher-order (T073)
  if (isFilterOperation(expr) || isMapOperation(expr)) {
    return transpileHigherOrder(expr, ctx);
  }

  // ThenOperation — pipeline/pipe: `arg then fn`
  if (isThenOperation(expr)) {
    return transpileThenOperation(expr, ctx);
  }

  // Presence predicates.
  if (isRosettaExistsExpression(expr)) {
    const arg = expr.argument;
    if (arg) {
      const argStr = transpileExpression(arg, valueCtx);
      return `rune.exists(${argStr})`;
    }
    return `rune.exists(${ctx.selfName})`;
  }

  if (isRosettaAbsentExpression(expr)) {
    const arg = expr.argument;
    if (arg) {
      const argStr = transpileExpression(arg, valueCtx);
      return `!rune.exists(${argStr})`;
    }
    return `!rune.exists(${ctx.selfName})`;
  }

  // only exists, in a NESTED (non-top-level-Condition) position — e.g. as
  // the consequent of an if/then. transpileCondition's dispatcher handles
  // the top-level Condition.expression case (with attribute-name validation
  // and mode-specific statement-block emission via emitOnlyExists); here we
  // need a pure boolean expression, so inline the same "every attr NOT
  // listed must be absent" semantics without the attributeTypes validation
  // (attribute existence was already checked when this expression's
  // attributeTypes were built at the top-level dispatch).
  if (isRosettaOnlyExistsExpression(expr)) {
    const predicate = renderOnlyExists(
      expr,
      valueCtx,
      (node) => transpileExpression(node, valueCtx),
      (name) => attrAccessExpr(name, valueCtx)
    );
    if (predicate !== undefined) return predicate;
    const message = `only-exists requires fields of a common parent in '${ctx.conditionName}'`;
    ctx.diagnostics.push({ severity: 'error', code: 'invalid-only-exists', message });
    return diagnosticFallback(message);
  }

  // Conditional if/then/else (T074)
  if (isRosettaConditionalExpression(expr)) {
    return transpileConditional(expr, ctx);
  }

  // Constructor expression (T076)
  if (isRosettaConstructorExpression(expr)) {
    return transpileConstructor(expr, ctx);
  }

  // List literal (T077)
  if (isListLiteral(expr)) {
    return transpileListLiteral(expr, ctx);
  }

  // Metadata operations.
  if (isAsKeyOperation(expr) || isWithMetaOperation(expr)) {
    return transpilePassthrough(expr, ctx);
  }

  // Collection and default operations.
  if (isDefaultOperation(expr)) {
    return transpileDefault(expr, ctx);
  }
  if (isJoinOperation(expr)) {
    return transpileJoin(expr, valueCtx);
  }
  if (isRosettaOnlyElement(expr)) {
    return transpileOnlyElement(expr, ctx);
  }
  if (isReduceOperation(expr)) {
    return transpileReduce(expr, ctx);
  }

  // Value conversions.
  if (isToStringOperation(expr)) {
    return transpileToString(expr, valueCtx);
  }
  if (isToNumberOperation(expr)) {
    return transpileToNumber(expr, valueCtx);
  }
  if (isToIntOperation(expr)) {
    return transpileToInt(expr, valueCtx);
  }
  if (isToEnumOperation(expr)) {
    return transpileToEnum(expr, valueCtx);
  }
  if (isToDateOperation(expr)) {
    return transpileToDate(expr, valueCtx);
  }
  if (isToTimeOperation(expr)) {
    return transpileToTime(expr, valueCtx);
  }
  if (isToDateTimeOperation(expr)) {
    return transpileToDateTime(expr, valueCtx);
  }
  if (isToZonedDateTimeOperation(expr)) {
    return transpileToZonedDateTime(expr, valueCtx);
  }

  // Switch expressions.
  if (isSwitchOperation(expr)) {
    return transpileSwitch(expr, ctx);
  }

  // The one exception — RosettaSuperCall (deliberate loud diagnostic)
  if (isRosettaSuperCall(expr)) {
    return transpileSuperCall(expr, ctx);
  }

  // Unknown expression type — emit diagnostic and placeholder
  ctx.diagnostics.push({
    severity: 'error',
    code: 'unknown-expression-type',
    message: `Unknown expression type: ${(expr as { $type?: string }).$type}`
  });
  return diagnosticFallback(`Unknown expression type '${(expr as { $type?: string }).$type}'`);
}

// ---------------------------------------------------------------------------
// Precedence helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Get the precedence of an expression node for parenthesization decisions.
 */
function getExprPrecedence(expr: RosettaExpression): number | undefined {
  if (isArithmeticOperation(expr)) return PRECEDENCE[expr.operator];
  if (isLogicalOperation(expr)) return PRECEDENCE[expr.operator];
  if (isEqualityOperation(expr)) return PRECEDENCE[expr.operator];
  if (isComparisonOperation(expr)) return PRECEDENCE[expr.operator];
  if (isRosettaContainsExpression(expr)) return PRECEDENCE['contains'];
  if (isRosettaDisjointExpression(expr)) return PRECEDENCE['disjoint'];
  return undefined;
}

/**
 * Operators whose JS equivalent is NOT left-associative in a way that
 * preserves Rune semantics when re-nested without parens — chaining these
 * at the same tier changes meaning (`a === b === c` is `(a===b)===c` in JS,
 * comparing a boolean to `c`, not the Rune-intended `a===(b===c)`).
 * Rune's own grammar only allows same-tier nesting on these via an explicit
 * parenthesized sub-expression (PrimaryExpression's `'(' Expression ')'`
 * escape hatch — EqualityOperation.right is otherwise AdditiveOperation,
 * not another EqualityOperation), so a same-tier RIGHT child of one of
 * these operators must always keep its parens. Arithmetic (+,-,*,/) and
 * logical (and/or → &&/||) chain left-associatively in both Rune and JS,
 * so dropping redundant right-side parens there is semantics-preserving.
 *
 * Note: `contains`/`disjoint`/`default` are grammatically same-tier too, but
 * never reach transpileWithPrecedence as parentOp — their transpile sites use
 * structural templates (`.includes()`/`.some()`/self-wrapped `??`) that are
 * immune by construction — so only the six eq/cmp operators are listed here.
 */
const NON_ASSOCIATIVE_OPERATORS = new Set(['=', '<>', '<', '<=', '>', '>=']);

/**
 * Transpile a sub-expression, wrapping in parentheses if needed for precedence.
 * Used by binary operators (T069, T070).
 *
 * @param expr      The sub-expression to transpile.
 * @param parentOp  The operator of the parent expression.
 * @param ctx       Transpiler context.
 * @param side      Whether this is the left or right operand. Same-tier
 *                  RIGHT children of a non-associative parentOp are always
 *                  parenthesized (see NON_ASSOCIATIVE_OPERATORS); same-tier
 *                  LEFT children never need parens (JS left-associativity
 *                  matches evaluation order either way).
 */
function transpileWithPrecedence(
  expr: RosettaExpression,
  parentOp: string,
  ctx: ExpressionTranspilerContext,
  side: 'left' | 'right'
): string {
  const result = transpileExpression(expr, ctx);
  const myPrec = getExprPrecedence(expr);
  const parentPrec = PRECEDENCE[parentOp];
  if (myPrec === undefined || parentPrec === undefined) {
    return result;
  }
  if (myPrec < parentPrec) {
    return `(${result})`;
  }
  if (side === 'right' && myPrec === parentPrec && NON_ASSOCIATIVE_OPERATORS.has(parentOp)) {
    return `(${result})`;
  }
  return result;
}
