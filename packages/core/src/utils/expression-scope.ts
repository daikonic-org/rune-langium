// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode, type AstNodeDescription } from 'langium';
import {
  isRosettaFunction,
  isRosettaExternalFunction,
  isRosettaRule,
  isAttribute,
  isChoiceOption,
  isClosureParameter,
  isInlineFunction,
  isRosettaEnumValue,
  isRosettaRecordFeature,
  isRosettaSymbolReference,
  isShortcutDeclaration,
  type RosettaExpression,
  type RosettaFeature,
  type RosettaType
} from '../generated/ast.js';
import type { RuneDslServices } from '../services/rune-dsl-module.js';
import { getFunctionSignature, getFunctionInputs, getFunctionOutput } from './expression-utils.js';
import { cardinalityFits, toConstraintString, type CardinalityBounds } from './cardinality-utils.js';
import type { ExpressionAddress } from './source-regions.js';
import { getLinkedReferenceTarget } from '../api/parse.js';

export interface ExpressionScopeEntry {
  name: string;
  declarationId: string;
  kind: 'input' | 'output' | 'alias' | 'attribute' | 'local' | 'callable' | 'enum' | 'choice';
  typeName?: string;
  cardinality?: string;
  argumentCount?: number;
  /** Input names in the same authoritative order as the callable arity. */
  argumentNames?: string[];
  canBrowse?: boolean;
  compatibility?: ExpressionCompatibility;
}

export type ExpressionPickerTarget =
  | ExpressionAddress
  | { draftAlias: true }
  | { draftCondition: 'precondition' | 'postcondition' };
export interface ExpressionPickerRequest {
  target: ExpressionPickerTarget;
  trail: readonly string[];
  candidateSource?: string;
}
type ExpressionCompatibility = 'compatible' | 'incompatible' | 'unknown';
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
      if (
        currentAlias &&
        owner &&
        owner.shortcuts.includes(node) &&
        owner.shortcuts.indexOf(node) >= owner.shortcuts.indexOf(currentAlias)
      )
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
    entries.push({
      name: description.name,
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

type PickerReceiver = { receiver: RosettaExpression; shape: ValueShape; text: string };
const single: CardinalityBounds = { inf: 1, sup: 1, unbounded: false };
const optional: CardinalityBounds = { ...single, inf: 0 };

function valueShape(node?: AstNode): ValueShape {
  if (isRosettaEnumValue(node)) return { type: node.$container, typeName: node.$container.name, bounds: single };
  if (isClosureParameter(node)) return { bounds: single };
  if (isAttribute(node) || isChoiceOption(node) || isRosettaRecordFeature(node)) {
    return {
      type: getLinkedReferenceTarget(node.typeCall, node.typeCall.type),
      typeName: node.typeCall.type.$refText,
      bounds: isAttribute(node) ? node.card : isChoiceOption(node) ? optional : single
    };
  }
  return {};
}

function multiplyBounds(lhs?: CardinalityBounds, rhs?: CardinalityBounds): CardinalityBounds | undefined {
  if (!lhs || !rhs) return undefined;
  return {
    inf: lhs.inf * rhs.inf,
    sup: (lhs.sup ?? lhs.inf) * (rhs.sup ?? rhs.inf),
    unbounded: lhs.unbounded || rhs.unbounded
  };
}

function argumentShape(expression: RosettaExpression): ValueShape {
  const call = expression.$container;
  if (!isRosettaSymbolReference(call) || expression.$containerProperty !== 'rawArgs') return {};
  const callee = getLinkedReferenceTarget(call, call.symbol);
  return isRosettaFunction(callee) ? valueShape(getFunctionInputs(callee)[expression.$containerIndex ?? -1]) : {};
}

function compatibility(source: ValueShape, expected: ValueShape): ExpressionCompatibility {
  if (!source.bounds || !expected.bounds) return 'unknown';
  if (!cardinalityFits(source.bounds, expected.bounds)) return 'incompatible';
  return source.type && source.type === expected.type ? 'compatible' : 'unknown';
}

/** Build suggestions at a linked expression and resolve each navigation segment through Rune's feature scope. */
export function getExpressionPickerContext(
  expression: RosettaExpression,
  services: RuneDslServices,
  trail: readonly string[]
): ExpressionPickerContext {
  const resolved = expressionScopeSymbols(expression, services);
  const entries = scopeEntries(expression, services, resolved);
  const linked = new Map(resolved.map(({ description, node }) => [declarationId(description), node]));
  const memberScope = (receiver: RosettaExpression) =>
    services.references.ScopeProvider.getExpressionMemberScope(receiver).getAllElements();
  const expected = argumentShape(expression);
  const roots = new Map<string, PickerReceiver>();
  for (const entry of entries) {
    if (entry.kind === 'callable') continue;
    const node = linked.get(entry.declarationId);
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
    const shape = implicit ? { bounds: single } : valueShape(node);
    entry.canBrowse = !memberScope(receiver).isEmpty();
    entry.compatibility = compatibility(shape, expected);
    roots.set(entry.declarationId, { receiver, shape, text: entry.name });
  }
  if (!trail.length) return { entries, members: [] };
  const root = roots.get(trail[0]!);
  if (!root) throw new Error('The member path changed. Reopen the picker.');
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
          text: `${parent.text} -> ${description.name}`
        }
      ];
    });
  };
  let active = root;
  for (const segment of trail.slice(1)) {
    const child = features(active).find((entry) => entry.id === segment);
    if (!child) throw new Error('The member path changed. Reopen the picker.');
    active = child;
  }
  return {
    entries,
    members: features(active)
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
  };
}
