// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode, type AstNodeDescription } from 'langium';
import {
  isData,
  isChoice,
  isRosettaBasicType,
  isRosettaFunction,
  isRosettaModel,
  isRosettaExternalFunction,
  isRosettaRule,
  isAttribute,
  isChoiceOption,
  isClosureParameter,
  isCondition,
  isConstructorKeyValuePair,
  isInlineFunction,
  isOperation,
  isRosettaEnumeration,
  isRosettaEnumValue,
  isRosettaExpression,
  isRosettaRecordType,
  isRosettaParameter,
  isRosettaRecordFeature,
  isRosettaSymbolReference,
  isRosettaType,
  isShortcutDeclaration,
  type RosettaExpression,
  type RosettaFeature,
  type RosettaType
} from '../generated/ast.js';
import type { RuneDslServices } from '../services/rune-dsl-module.js';
import {
  getFunctionSignature,
  getFunctionInputs,
  getFunctionOutput,
  getOperationArgument,
  resolveOperationType,
  resolveTypeAliases
} from './expression-utils.js';
import { getEnumValues } from './enum-utils.js';
import { getChoiceOptionPaths } from './choice-utils.js';
import { cardinalityFits, toConstraintString, type CardinalityBounds } from './cardinality-utils.js';
import { escapeRuneIdentifier } from './rune-identifiers.js';
import { getNodeSourceRegion, type ExpressionAddress } from './source-regions.js';
import { namespaceFromModelName } from '../naming/namespace.js';
import { qualifiedExportPath } from '../naming/qualified-export-path.js';
import { getLinkedReferenceTarget } from '../api/parse.js';

export interface ExpressionScopeEntry {
  name: string;
  declarationId: string;
  kind: 'input' | 'output' | 'alias' | 'attribute' | 'local' | 'callable' | 'enum' | 'choice';
  typeName?: string;
  cardinality?: string;
  /** Owning namespace of a callable, including when it is visible by its short name. */
  namespace?: string;
  argumentCount?: number;
  /** Input names in the same authoritative order as the callable arity. */
  argumentNames?: string[];
  /** Source spelling produced by the linked picker for a reference value. */
  referenceText?: string;
  canBrowse?: boolean;
  compatibility?: ExpressionCompatibility;
}

export type ExpressionPickerTarget =
  | ExpressionAddress
  | (({ draftAlias: true } | { draftCondition: 'precondition' | 'postcondition' }) & {
      /** Coordinates within the draft expression, before insertion into a private document. */
      draftAddress?: ExpressionAddress;
    });
export interface ExpressionPickerRequest {
  target: ExpressionPickerTarget;
  trail: readonly string[];
  candidateSource?: string;
  draftSource?: string;
}
type ExpressionCompatibility = 'compatible' | 'incompatible' | 'unknown';
export interface ExpressionReferenceDetails {
  name: string;
  typeName?: string;
  cardinality?: string;
  declaration?: { name: string; namespace: string; kind: string };
}
export interface ExpressionReferenceSegment extends ExpressionReferenceDetails {
  browseId?: string;
  deep?: boolean;
}
export interface ExpressionMemberChoice {
  declarationId: string;
  name: string;
  expressionText: string;
  typeName?: string;
  cardinality?: string;
  canBrowse: boolean;
  compatibility: ExpressionCompatibility;
}
export interface ExpressionPickerContext {
  entries: ExpressionScopeEntry[];
  members: ExpressionMemberChoice[];
  expected?: Partial<Pick<ExpressionScopeEntry, 'name' | 'typeName' | 'cardinality'>>;
  referencePath?: ExpressionReferenceSegment[];
  inspected?: ExpressionReferenceDetails;
  enumValues?: ExpressionMemberChoice[];
}

function declarationId(description: AstNodeDescription): string {
  return `${description.documentUri.toString()}#${description.path}`;
}

const callableTypes = new Set(['RosettaFunction', 'RosettaExternalFunction', 'RosettaRule']);

/** Shared canonical scope enumeration for expression editing and composition discovery. */
export function expressionScopeSymbols(expression: RosettaExpression, services: RuneDslServices) {
  const probe = {
    $type: 'RosettaSymbolReference',
    $container: expression.$container,
    symbol: { $refText: '', ref: undefined },
    args: [],
    rawArgs: [],
    explicitArguments: false
  };
  const scope = services.references.ScopeProvider.getScope({
    container: probe,
    property: 'symbol',
    reference: probe.symbol
  });
  return scope
    .getAllElements()
    .map((description) => ({
      description,
      node:
        description.node ??
        (callableTypes.has(description.type) ? services.references.Linker.loadAstNode(description) : undefined)
    }))
    .toArray();
}

/** Describe the existing language-service scope at an expression, without a second resolver. */
export function getExpressionScope(expression: RosettaExpression, services: RuneDslServices): ExpressionScopeEntry[] {
  return scopeEntries(expression, services, expressionScopeSymbols(expression, services));
}

function scopeEntries(
  expression: RosettaExpression,
  services: RuneDslServices,
  resolved: ReturnType<typeof expressionScopeSymbols>
): ExpressionScopeEntry[] {
  const owner = AstUtils.getContainerOfType(expression, isRosettaFunction);
  const declarations = services.shared.workspace.LangiumDocuments.all
    .flatMap((doc) => {
      const root = doc.parseResult.value;
      return root.$type === 'RosettaModel' && 'elements' in root
        ? (root.elements as unknown[]).filter(isRosettaFunction)
        : [];
    })
    .toArray();
  const signature = owner ? getFunctionSignature(owner, declarations) : undefined;
  const currentAlias = AstUtils.getContainerOfType(expression, isShortcutDeclaration);
  const aliasIndex = owner && currentAlias ? owner.shortcuts.indexOf(currentAlias) : -1;
  const entries: ExpressionScopeEntry[] = [];
  const names = new Set<string>();
  const closure = AstUtils.getContainerOfType(expression, isInlineFunction);
  if (closure?.parameters.length === 0) {
    const path = services.workspace.AstNodeLocator.getAstNodePath(closure);
    entries.push({
      name: 'item',
      kind: 'local',
      cardinality: '(1..1)',
      declarationId: `${AstUtils.getDocument(closure).uri.toString()}#${path}/item`
    });
    names.add('item');
  }
  for (const { description, node } of resolved) {
    if (names.has(description.name)) continue;
    let kind: ExpressionScopeEntry['kind'];
    if (node && isShortcutDeclaration(node)) {
      if (aliasIndex >= 0 && owner && owner.shortcuts.includes(node) && owner.shortcuts.indexOf(node) >= aliasIndex)
        continue;
      kind = 'alias';
    } else if (node && isAttribute(node)) {
      kind =
        signature && getFunctionOutput(signature) === node
          ? 'output'
          : signature && getFunctionInputs(signature).includes(node)
            ? 'input'
            : 'attribute';
    } else if (node && isClosureParameter(node)) kind = 'local';
    else if (callableTypes.has(description.type)) kind = 'callable';
    else if (description.type === 'RosettaEnumValue') kind = 'enum';
    else if (description.type === 'Choice') kind = 'choice';
    else continue;
    names.add(description.name);
    const typed = node && isAttribute(node) ? node : undefined;
    const parameters =
      node && isRosettaFunction(node)
        ? getFunctionInputs(node, new Set(), declarations)
        : node && isRosettaExternalFunction(node)
          ? node.parameters
          : undefined;
    const model = kind === 'callable' && node ? AstUtils.getContainerOfType(node, isRosettaModel) : undefined;
    entries.push({
      name: description.name,
      ...(model ? { namespace: namespaceFromModelName(model.name) } : {}),
      kind,
      declarationId: declarationId(description),
      ...(typed ? { typeName: typed.typeCall.type.$refText, cardinality: toConstraintString(typed.card) } : {}),
      ...(parameters
        ? { argumentCount: parameters.length, argumentNames: parameters.map((parameter) => parameter.name) }
        : node && isRosettaRule(node)
          ? { argumentCount: node.input ? 1 : 0 }
          : {})
    });
  }
  return entries;
}

type ValueShape = {
  type?: RosettaType;
  typeName?: string;
  bounds?: CardinalityBounds;
};

type PickerReceiver = {
  receiver: RosettaExpression;
  shape: ValueShape;
  text: string;
  reference: ExpressionReferenceDetails;
};
const single: CardinalityBounds = { inf: 1, sup: 1, unbounded: false };
const optional: CardinalityBounds = { ...single, inf: 0 };
const many: CardinalityBounds = { inf: 0, sup: undefined, unbounded: true };

function valueShape(node?: AstNode, seen = new Set<AstNode>()): ValueShape {
  if (!node || seen.has(node)) return {};
  seen.add(node);
  if (isRosettaFunction(node)) return valueShape(getFunctionOutput(node), seen);
  if (isRosettaRule(node) && node.expression) return expressionShape(node.expression, seen);
  if (isShortcutDeclaration(node)) return expressionShape(node.expression, seen);
  if (isRosettaEnumValue(node)) return { type: node.$container, typeName: node.$container.name, bounds: single };
  if (isRosettaType(node)) return { type: node, typeName: node.name, bounds: single };
  if (isClosureParameter(node)) return collectionElementShape(node.$container, seen, node.$containerIndex);
  if (
    isAttribute(node) ||
    isChoiceOption(node) ||
    isRosettaRecordFeature(node) ||
    isRosettaParameter(node) ||
    isRosettaExternalFunction(node)
  ) {
    return {
      type: getLinkedReferenceTarget(node.typeCall, node.typeCall.type),
      typeName: node.typeCall.type.$refText,
      bounds: isAttribute(node)
        ? node.card
        : isChoiceOption(node)
          ? optional
          : isRosettaParameter(node) && node.isArray
            ? many
            : single
    };
  }
  return {};
}

function collectionElementShape(closure?: AstNode, seen = new Set<AstNode>(), index?: number): ValueShape {
  if (!isInlineFunction(closure)) return { bounds: single };
  const operation = closure.$container;
  // Reduce's first named parameter is an accumulator, whose type can differ from the input item.
  const argument =
    isRosettaExpression(operation) && !(operation.$type === 'ReduceOperation' && index === 0)
      ? getOperationArgument(operation)
      : undefined;
  return { ...(argument && expressionShape(argument, seen)), bounds: single };
}

function expressionShape(expression: RosettaExpression, seen = new Set<AstNode>()): ValueShape {
  switch (expression.$type) {
    case 'RosettaSymbolReference':
      return valueShape(getLinkedReferenceTarget(expression, expression.symbol), seen);
    case 'RosettaFeatureCall':
    case 'RosettaDeepFeatureCall': {
      const shape = valueShape(expression.feature && getLinkedReferenceTarget(expression, expression.feature), seen);
      return {
        ...shape,
        bounds:
          expression.$type === 'RosettaFeatureCall'
            ? multiplyBounds(expressionShape(expression.receiver, seen).bounds, shape.bounds)
            : undefined
      };
    }
    case 'RosettaImplicitVariable':
      return collectionElementShape(AstUtils.getContainerOfType(expression, isInlineFunction), seen);
    case 'RosettaConstructorExpression':
      return { ...expressionShape(expression.typeRef, seen), bounds: single };
    case 'RosettaBooleanLiteral':
    case 'LogicalOperation':
    case 'EqualityOperation':
    case 'ComparisonOperation':
    case 'RosettaExistsExpression':
    case 'RosettaAbsentExpression':
    case 'RosettaOnlyExistsExpression':
      return { typeName: 'boolean', bounds: single };
    case 'RosettaStringLiteral':
      return { typeName: 'string', bounds: single };
    case 'RosettaIntLiteral':
    case 'RosettaCountOperation':
      return { typeName: 'int', bounds: single };
    case 'RosettaNumberLiteral':
      return { typeName: 'number', bounds: single };
    default:
      return (
        resolveOperationType<ValueShape>(
          expression,
          (operand) => {
            const { type, typeName } = expressionShape(operand, new Set(seen));
            return typeName ? { type, typeName } : undefined;
          },
          (type) => ({ type, typeName: type.name }),
          (typeName) => ({ typeName })
        ) ?? {}
      );
  }
}

function multiplyBounds(lhs?: CardinalityBounds, rhs?: CardinalityBounds): CardinalityBounds | undefined {
  if (!lhs || !rhs) return undefined;
  return {
    inf: lhs.inf * rhs.inf,
    sup: (lhs.sup ?? lhs.inf) * (rhs.sup ?? rhs.inf),
    unbounded: lhs.unbounded || rhs.unbounded
  };
}

function argumentParameter(expression: RosettaExpression, argumentIndex?: number) {
  if (argumentIndex === undefined && expression.$containerProperty !== 'rawArgs') return undefined;
  const call = argumentIndex === undefined ? expression.$container : expression;
  if (!isRosettaSymbolReference(call)) return undefined;
  const callee = getLinkedReferenceTarget(call, call.symbol);
  const index = argumentIndex ?? expression.$containerIndex ?? -1;
  return isRosettaFunction(callee)
    ? getFunctionInputs(callee)[index]
    : isRosettaExternalFunction(callee)
      ? callee.parameters[index]
      : undefined;
}

function expectedShape(expression: RosettaExpression, argumentIndex?: number): ValueShape & { name?: string } {
  const parameter = argumentParameter(expression, argumentIndex);
  if (parameter) return { ...valueShape(parameter), name: parameter.name };
  if (argumentIndex !== undefined) return {};
  const parent = expression.$container;
  if (isOperation(parent)) {
    let segment = parent.path;
    while (segment?.next) segment = segment.next;
    const field = segment
      ? getLinkedReferenceTarget(segment, segment.feature)
      : getLinkedReferenceTarget(parent, parent.assignRoot);
    const shape = valueShape(field);
    return { ...shape, bounds: parent.add ? undefined : shape.bounds };
  }
  if (isConstructorKeyValuePair(parent) && parent.value === expression)
    return valueShape(getLinkedReferenceTarget(parent, parent.key));
  if (
    isCondition(parent) ||
    parent?.$type === 'LogicalOperation' ||
    (parent?.$type === 'RosettaConditionalExpression' && parent.if === expression) ||
    (isInlineFunction(parent) && parent.$container.$type === 'FilterOperation')
  )
    return { typeName: 'boolean', bounds: single };
  if (parent?.$type === 'RosettaConditionalExpression') return expectedShape(parent);
  if (parent?.$type === 'ComparisonOperation' || parent?.$type === 'EqualityOperation') {
    const other = parent.left === expression ? parent.right : parent.left;
    const shape = other && expressionShape(other);
    return { type: shape?.type, typeName: shape?.typeName };
  }
  return {};
}

const scalarTypes = new Set([
  'boolean',
  'number',
  'int',
  'string',
  'pattern',
  'date',
  'time',
  'dateTime',
  'zonedDateTime'
]);

function compatibility(source: ValueShape, expected: ValueShape): ExpressionCompatibility {
  if (source.bounds && expected.bounds && !cardinalityFits(source.bounds, expected.bounds)) return 'incompatible';
  const from = resolveTypeAliases(source.type);
  const to = resolveTypeAliases(expected.type);
  if (from && from === to) return 'compatible';
  const fromScalar = from ? (isRosettaBasicType(from) ? from.name : undefined) : source.typeName;
  const toScalar = to ? (isRosettaBasicType(to) ? to.name : undefined) : expected.typeName;
  if (fromScalar && toScalar && scalarTypes.has(fromScalar) && scalarTypes.has(toScalar))
    return fromScalar === toScalar || (fromScalar === 'int' && toScalar === 'number') ? 'compatible' : 'incompatible';
  if (isData(from) && isData(to)) {
    const seen = new Set<RosettaType>();
    for (
      let data = from.superType?.ref;
      data && !seen.has(data);
      data = isData(data) ? data.superType?.ref : undefined
    ) {
      if (data === to) return 'compatible';
      seen.add(data);
    }
    return 'incompatible';
  }
  if (isRosettaEnumeration(from) && isRosettaEnumeration(to)) {
    const seen = new Set<RosettaType>();
    for (
      let enumeration = to.parent?.ref;
      enumeration && !seen.has(enumeration);
      enumeration = enumeration.parent?.ref
    ) {
      if (enumeration === from) return 'compatible';
      seen.add(enumeration);
    }
    return 'incompatible';
  }
  if (isChoice(to) && !isChoice(from)) {
    const matches = getChoiceOptionPaths(to)
      .map((path) => valueShape(path.at(-1)))
      .filter(({ type }) => !isChoice(resolveTypeAliases(type)))
      .map((option) => compatibility(source, { ...option, bounds: expected.bounds }));
    if (matches.includes('compatible')) return 'compatible';
    if (matches.length && matches.every((entry) => entry === 'incompatible')) return 'incompatible';
  }
  const structured = (type: RosettaType | undefined) =>
    isData(type) || isRosettaEnumeration(type) || isRosettaRecordType(type);
  if (structured(from) && structured(to)) return 'incompatible';
  if (
    (from && !isChoice(from) && toScalar && isRosettaBasicType(to)) ||
    (to && !isChoice(to) && fromScalar && isRosettaBasicType(from))
  )
    return 'incompatible';
  return 'unknown';
}

function referenceDetails(name: string, node: AstNode | undefined, shape: ValueShape): ExpressionReferenceDetails {
  const type = resolveTypeAliases(shape.type);
  const declaration =
    isRosettaFunction(node) || isRosettaExternalFunction(node) || isRosettaRule(node) || isRosettaType(node)
      ? node
      : type && !isRosettaBasicType(type)
        ? type
        : isRosettaType(node?.$container)
          ? node.$container
          : undefined;
  return {
    name,
    typeName: shape.typeName,
    cardinality: shape.bounds && toConstraintString(shape.bounds),
    declaration:
      declaration && isRosettaModel(declaration.$container)
        ? {
            name: declaration.name,
            namespace: namespaceFromModelName(declaration.$container.name) ?? '',
            kind: declaration.$type
          }
        : undefined
  };
}

function referenceReceivers(expression: RosettaExpression): PickerReceiver[] {
  const steps: RosettaExpression[] = [];
  let receiver = expression;
  while (receiver.$type === 'RosettaFeatureCall' || receiver.$type === 'RosettaDeepFeatureCall') {
    steps.unshift(receiver);
    receiver = receiver.receiver;
  }
  steps.unshift(receiver);
  return steps.flatMap((step) => {
    const ref =
      step.$type === 'RosettaSymbolReference'
        ? step.symbol
        : step.$type === 'RosettaFeatureCall' || step.$type === 'RosettaDeepFeatureCall'
          ? step.feature
          : step.$type === 'RosettaConstructorExpression' && isRosettaSymbolReference(step.typeRef)
            ? step.typeRef.symbol
            : undefined;
    const name = ref?.$refText ?? (step.$type === 'RosettaImplicitVariable' ? 'item' : undefined);
    if (!name) return [];
    const shape = expressionShape(step);
    let text = step.$cstNode?.text || name;
    const document = AstUtils.findRootNode(step).$document;
    if (!step.$cstNode && document) {
      try {
        const range = getNodeSourceRegion(step);
        text = document.textDocument.getText().slice(range.from, range.to) || name;
      } catch {
        // An implicit receiver has no authored range and uses its scoped name.
      }
    }
    return [
      {
        receiver: step,
        shape,
        text,
        reference: referenceDetails(name, ref && getLinkedReferenceTarget<AstNode>(step, ref), shape)
      }
    ];
  });
}

/** Build suggestions at a linked expression and resolve each navigation segment through Rune's feature scope. */
export function getExpressionPickerContext(
  expression: RosettaExpression,
  services: RuneDslServices,
  trail: readonly string[],
  argumentIndex?: number
): ExpressionPickerContext {
  const resolved = expressionScopeSymbols(expression, services);
  const entries = scopeEntries(expression, services, resolved);
  const linked = new Map(resolved.map(({ description, node }) => [declarationId(description), node]));
  const memberScope = (receiver: RosettaExpression) =>
    services.references.ScopeProvider.getExpressionMemberScope(receiver).getAllElements();
  const expected = expectedShape(expression, argumentIndex);
  const expectedHint =
    expected.name || expected.typeName || expected.bounds
      ? {
          name: expected.name,
          typeName: expected.typeName,
          cardinality: expected.bounds && toConstraintString(expected.bounds)
        }
      : undefined;
  const roots = new Map<string, PickerReceiver>();
  for (const entry of entries) {
    const node = linked.get(entry.declarationId);
    if (entry.kind === 'callable') {
      const shape = valueShape(node);
      entry.typeName = shape.typeName;
      entry.cardinality = shape.bounds && toConstraintString(shape.bounds);
      entry.compatibility = compatibility(shape, expected);
      continue;
    }
    const implicit = entry.kind === 'local' && entry.name === 'item' && !node;
    if (!node && !implicit) continue;
    const receiver = {
      $container: expression.$container,
      ...(implicit
        ? { $type: 'RosettaImplicitVariable', name: 'item' }
        : {
            $type: 'RosettaSymbolReference',
            symbol: { $refText: entry.name, ref: node },
            rawArgs: [],
            explicitArguments: false
          })
    } as RosettaExpression;
    const shape = implicit ? expressionShape(receiver) : valueShape(node);
    entry.typeName = shape.typeName;
    entry.cardinality = shape.bounds && toConstraintString(shape.bounds);
    entry.canBrowse = !memberScope(receiver).isEmpty();
    entry.compatibility = compatibility(shape, expected);
    const text = implicit ? 'item' : escapeRuneIdentifier(entry.name);
    entry.referenceText = text;
    roots.set(entry.declarationId, { receiver, shape, text, reference: referenceDetails(entry.name, node, shape) });
  }
  const path = referenceReceivers(expression);
  const referencePath = path.map((part, index) => {
    const reference = { ...part.reference, deep: part.receiver.$type === 'RosettaDeepFeatureCall' || undefined };
    if (memberScope(part.receiver).isEmpty()) return reference;
    const browseId = 'expression:' + index;
    roots.set(browseId, part);
    return { ...reference, browseId };
  });
  const features = (parent: PickerReceiver) => {
    const names = new Set<string>();
    return memberScope(parent.receiver).flatMap((description) => {
      const node = description.node;
      if (!node || names.has(description.name)) return [];
      names.add(description.name);
      const receiver = {
        $type: 'RosettaFeatureCall',
        $container: expression.$container,
        receiver: parent.receiver,
        feature: { $refText: description.name, ref: node as RosettaFeature }
      } as RosettaExpression;
      const shape = valueShape(node);
      shape.bounds = multiplyBounds(parent.shape.bounds, shape.bounds);
      return [
        {
          id: declarationId(description),
          name: description.name,
          receiver,
          shape,
          reference: referenceDetails(description.name, node, shape),
          text: `${parent.text} -> ${escapeRuneIdentifier(description.name)}`
        }
      ];
    });
  };
  let active = trail[0] ? roots.get(trail[0]) : undefined;
  if (trail.length && !active) throw new Error('The member path changed. Reopen the picker.');
  for (const segment of trail.slice(1)) {
    const child = active && features(active).find((entry) => entry.id === segment);
    if (!child) throw new Error('The member path changed. Reopen the picker.');
    active = child;
  }
  const enumType = resolveTypeAliases(expected.type ?? path.at(-1)?.shape.type);
  const enumValues =
    !active && isRosettaEnumeration(enumType)
      ? getEnumValues(enumType).map((value) => {
          const namespaced = qualifiedExportPath(enumType.$container.name, enumType.name);
          return {
            declarationId: services.workspace.AstNodeLocator.getAstNodePath(value),
            name: value.name,
            expressionText: escapeRuneIdentifier(namespaced) + ' -> ' + escapeRuneIdentifier(value.name),
            canBrowse: false,
            compatibility: compatibility({ type: enumType, bounds: single }, expected)
          };
        })
      : undefined;
  return {
    entries,
    expected: expectedHint,
    referencePath,
    inspected: active?.reference ?? path.at(-1)?.reference,
    enumValues,
    members: active
      ? features(active)
          .map(({ id, name, receiver, shape, text }) => ({
            declarationId: id,
            name,
            expressionText: text,
            typeName: shape.typeName,
            cardinality: shape.bounds ? toConstraintString(shape.bounds) : undefined,
            canBrowse: !memberScope(receiver).isEmpty(),
            compatibility: compatibility(shape, expected)
          }))
          .toArray()
      : []
  };
}
