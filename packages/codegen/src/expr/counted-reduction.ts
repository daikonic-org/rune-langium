// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils } from 'langium';
import {
  isArithmeticOperation,
  isAttribute,
  isData,
  isEqualityOperation,
  isListLiteral,
  isMapOperation,
  isReduceOperation,
  isRosettaConditionalExpression,
  isRosettaConstructorExpression,
  isRosettaFeatureCall,
  isRosettaImplicitVariable,
  isRosettaIntLiteral,
  isRosettaSymbolReference,
  isShortcutDeclaration,
  isRosettaFunction,
  isRosettaExternalFunction,
  type ArithmeticOperation,
  type Attribute,
  type ClosureParameter,
  type Data,
  type ListLiteral,
  type ReduceOperation,
  type RosettaConstructorExpression,
  type RosettaConditionalExpression,
  type RosettaExpression,
  type RosettaFeatureCall,
  type RosettaFunction,
  type ShortcutDeclaration,
  type RosettaSymbolReference
} from '@rune-langium/core';
import { expressionType } from './navigation.js';
import { hasFieldMetadata } from './metadata-runtime.js';

interface CountedBase {
  source: RosettaExpression;
  sourceField: Attribute;
  seed: RosettaConstructorExpression;
  body: RosettaConstructorExpression;
  type: Data;
  counterUpdate: ArithmeticOperation;
  counterReads: readonly RosettaFeatureCall[];
  itemReads: readonly RosettaFeatureCall[];
}
export type CountedReduction = CountedBase &
  (
    | { kind: 'lookup'; selection: RosettaConditionalExpression; selectionField: Attribute; index: RosettaExpression }
    | { kind: 'collect'; collection: ListLiteral; field: Attribute; append: RosettaExpression }
  );
export interface CountedReductionPlans {
  reductions: ReadonlyMap<ReduceOperation, CountedReduction>;
  omittedAliases: ReadonlySet<ShortcutDeclaration>;
}

function literal(node: RosettaExpression | undefined, value: bigint): boolean {
  return isRosettaIntLiteral(node) && node.value === value;
}
function input(node: RosettaExpression | undefined, func: RosettaFunction): node is RosettaSymbolReference {
  return (
    isRosettaSymbolReference(node) &&
    !node.explicitArguments &&
    !node.rawArgs.length &&
    isAttribute(node.symbol.ref) &&
    func.inputs.includes(node.symbol.ref) &&
    !hasFieldMetadata(node.symbol.ref)
  );
}
function read(node: unknown, parameter: ClosureParameter, field: Attribute): node is RosettaFeatureCall {
  return (
    isRosettaFeatureCall(node) &&
    node.feature?.ref === field &&
    isRosettaSymbolReference(node.receiver) &&
    node.receiver.symbol.ref === parameter
  );
}
function plain(node: RosettaExpression | undefined): node is RosettaConstructorExpression {
  return (
    isRosettaConstructorExpression(node) &&
    !node.implicitEmpty &&
    node.values.every(({ key }) => isAttribute(key.ref) && !hasFieldMetadata(key.ref))
  );
}
function scalar(field: Attribute): boolean {
  return !field.card.unbounded && (field.card.sup ?? 1) <= 1;
}

/** Recognize linked, non-escaping counted folds without depending on model or function names. */
function analyze(
  reduce: ReduceOperation,
  alias: ShortcutDeclaration,
  func: RosettaFunction
): CountedReduction | undefined {
  const list = alias.expression,
    fn = reduce.function;
  if (!isListLiteral(list) || list.elements.length !== 2 || !fn || fn.parameters.length !== 2 || !plain(fn.body))
    return;
  const [seed, mapped] = list.elements;
  if (
    !plain(seed) ||
    seed.values.length !== 1 ||
    !isMapOperation(mapped) ||
    !mapped.function ||
    mapped.function.parameters.length > 1 ||
    !plain(mapped.function.body) ||
    !input(mapped.argument, func)
  )
    return;
  const sourceField = mapped.argument.symbol.ref;
  if (!isAttribute(sourceField)) return;
  const step = mapped.function.body,
    body = fn.body;
  const type = expressionType(seed.typeRef);
  if (
    !isData(type) ||
    expressionType(step.typeRef) !== type ||
    expressionType(body.typeRef) !== type ||
    step.values.length !== 2 ||
    body.values.length !== 2
  )
    return;
  const counter = seed.values[0]!.key.ref;
  if (!isAttribute(counter) || !scalar(counter) || counter.card.inf !== 1 || !literal(seed.values[0]!.value, 0n))
    return;
  const stepCounter = step.values.find(({ key }) => key.ref === counter);
  const item = step.values.find(({ key }) => key.ref !== counter);
  if (
    !stepCounter ||
    !literal(stepCounter.value, 0n) ||
    !item ||
    !isAttribute(item.key.ref) ||
    !scalar(item.key.ref) ||
    item.key.ref.card.inf !== 0
  )
    return;
  const itemField = item.key.ref;
  const itemValue = item.value;
  if (
    mapped.function.parameters.length
      ? !isRosettaSymbolReference(itemValue) ||
        itemValue.symbol.ref !== mapped.function.parameters[0] ||
        itemValue.rawArgs.length > 0
      : !isRosettaImplicitVariable(itemValue)
  )
    return;
  const [previous, next] = fn.parameters;
  const counterUpdate = body.values.find(({ key }) => key.ref === counter)?.value;
  if (
    !isArithmeticOperation(counterUpdate) ||
    counterUpdate.operator !== '+' ||
    !read(counterUpdate.left, previous!, counter) ||
    !literal(counterUpdate.right, 1n)
  )
    return;
  const output = body.values.find(({ key }) => key.ref !== counter);
  if (!output || !isAttribute(output.key.ref)) return;
  const nodes = AstUtils.streamAllContents(body).toArray();
  const counterReads = nodes.filter((node): node is RosettaFeatureCall => read(node, previous!, counter));
  const itemReads = nodes.filter((node): node is RosettaFeatureCall => read(node, next!, itemField));
  const allowed = new Set([...counterReads, ...itemReads].map((node) => node.receiver));
  const base: CountedBase = {
    source: mapped.argument,
    sourceField,
    seed,
    body,
    type,
    counterUpdate,
    counterReads,
    itemReads
  };
  let plan: CountedReduction | undefined;
  const value = output.value;
  if (
    scalar(output.key.ref) &&
    output.key.ref.card.inf === 0 &&
    isRosettaConditionalExpression(value) &&
    isEqualityOperation(value.if) &&
    value.if.operator === '=' &&
    !value.if.cardMod &&
    read(value.if.left, previous!, counter) &&
    input(value.if.right, func) &&
    read(value.ifthen, next!, item.key.ref) &&
    read(value.elsethen, previous!, output.key.ref)
  ) {
    allowed.add(value.elsethen.receiver);
    plan = { ...base, kind: 'lookup', selection: value, selectionField: output.key.ref, index: value.if.right };
  } else if (
    !scalar(output.key.ref) &&
    output.key.ref.card.inf === 0 &&
    isListLiteral(value) &&
    value.elements.length === 2 &&
    read(value.elements[0], previous!, output.key.ref)
  ) {
    allowed.add(value.elements[0].receiver);
    plan = { ...base, kind: 'collect', collection: value, field: output.key.ref, append: value.elements[1]! };
  }
  if (!plan) return;
  if (
    nodes.some(
      (node) =>
        isRosettaImplicitVariable(node) ||
        (isRosettaSymbolReference(node) && isAttribute(node.symbol.ref) && !func.inputs.includes(node.symbol.ref))
    )
  )
    return;
  // A state or accumulated list passed elsewhere could observe intermediate identities.
  if (
    nodes.some(
      (node) =>
        isRosettaSymbolReference(node) &&
        (node.symbol.ref === previous || node.symbol.ref === next) &&
        !allowed.has(node)
    )
  )
    return;
  return plan;
}

/** Only an adjacent, single-use step alias can disappear without moving other evaluations. */
export function countedReductionPlans(func: RosettaFunction | undefined): CountedReductionPlans {
  const reductions = new Map<ReduceOperation, CountedReduction>();
  const omittedAliases = new Set<ShortcutDeclaration>();
  if (!func) return { reductions, omittedAliases };
  const references = AstUtils.streamAllContents(func).filter(isRosettaSymbolReference).toArray();
  for (let index = 1; index < func.shortcuts.length; index++) {
    const reduce = func.shortcuts[index]!.expression;
    if (!isReduceOperation(reduce) || !isRosettaSymbolReference(reduce.argument)) continue;
    const alias = reduce.argument.symbol.ref;
    if (
      !isShortcutDeclaration(alias) ||
      func.shortcuts[index - 1] !== alias ||
      references.filter((node) => node.symbol.ref === alias).length !== 1 ||
      func.operations.some((operation) => operation.assignRoot.ref === alias)
    )
      continue;
    const plan = analyze(reduce, alias, func);
    if (plan) {
      reductions.set(reduce, plan);
      omittedAliases.add(alias);
    }
  }
  return { reductions, omittedAliases };
}

/** Only authored, single-result Rune expressions can share a captured input snapshot. */
function pureFunction(
  func: RosettaFunction,
  allowed: (func: RosettaFunction) => boolean,
  visiting = new Set<RosettaFunction>()
): boolean {
  if (
    !allowed(func) ||
    visiting.has(func) ||
    func.annotations.length ||
    func.conditions.length ||
    func.postConditions.length ||
    func.operations.length !== 1 ||
    func.superFunction ||
    func.dispatchAttribute
  )
    return false;
  const operation = func.operations[0]!;
  if (operation.add || operation.path || operation.assignRoot.ref !== func.output) return false;
  const next = new Set(visiting).add(func);
  return AstUtils.streamAllContents(func).every((node) => {
    if (node.$type === 'RosettaSuperCall') return false;
    if (!isRosettaSymbolReference(node)) return true;
    return isRosettaFunction(node.symbol.ref)
      ? pureFunction(node.symbol.ref, allowed, next)
      : !node.explicitArguments && !isRosettaExternalFunction(node.symbol.ref);
  });
}

export interface CountedLookupCall {
  call: RosettaSymbolReference;
  source: RosettaSymbolReference;
}

/** Fuse a pure counted lookup into its caller's counted collection, preparing each capture once. */
export function countedLookupCalls(
  plan: CountedReduction,
  allowed: ((func: RosettaFunction) => boolean) | undefined
): CountedLookupCall[] {
  if (plan.kind !== 'collect' || !allowed) return [];
  const nodes = [plan.append, ...AstUtils.streamAllContents(plan.append)];
  // Any externally implemented call can mutate a captured collection.
  if (
    nodes.some(
      (node) =>
        node.$type === 'RosettaSuperCall' ||
        (isRosettaSymbolReference(node) &&
          (isRosettaFunction(node.symbol.ref)
            ? !pureFunction(node.symbol.ref, allowed)
            : node.explicitArguments || isRosettaExternalFunction(node.symbol.ref)))
    )
  )
    return [];
  const result: CountedLookupCall[] = [];
  for (const call of nodes) {
    if (!isRosettaSymbolReference(call) || !call.explicitArguments || !isRosettaFunction(call.symbol.ref)) continue;
    const func = call.symbol.ref;
    if (
      func.inputs.length !== 2 ||
      call.rawArgs.length !== 2 ||
      func.shortcuts.length !== 2 ||
      !func.output ||
      func.output.card.inf !== 0 ||
      !scalar(func.output) ||
      hasFieldMetadata(func.output)
    )
      continue;
    const lookup = [...countedReductionPlans(func).reductions.values()][0];
    if (lookup?.kind !== 'lookup' || !isRosettaSymbolReference(lookup.index)) continue;
    const output = func.operations[0]?.expression;
    if (
      !isRosettaFeatureCall(output) ||
      output.feature?.ref !== lookup.selectionField ||
      !isRosettaSymbolReference(output.receiver) ||
      output.receiver.symbol.ref !== func.shortcuts[1]
    )
      continue;
    const sourceIndex = func.inputs.indexOf(lookup.sourceField);
    const indexInput = lookup.index.symbol.ref;
    const indexIndex = func.inputs.findIndex((field) => field === indexInput);
    const source = call.rawArgs[sourceIndex],
      position = call.rawArgs[indexIndex];
    const owner = plan.sourceField.$container;
    if (
      sourceIndex < 0 ||
      indexIndex < 0 ||
      !isRosettaFunction(owner) ||
      !input(source, owner) ||
      !plan.counterReads.some((read) => read === position)
    )
      continue;
    result.push({ call, source });
  }
  return result;
}
