// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import { AstUtils, isReference, type AstNode } from 'langium';
import type { Attribute, RosettaExpression, RosettaFunction } from '../generated/ast.js';
import { isRosettaFunction, isRosettaModel, isRosettaSymbolReference } from '../generated/ast.js';
import { getSourceComments } from './source-comments.js';
import { expressionScopeSymbols } from '../utils/expression-scope.js';
import type { RuneDslServices } from '../services/rune-dsl-module.js';
import { getLinkedReferenceTarget } from './parse.js';
import { qualifiedExportPath } from '../naming/qualified-export-path.js';
import { getFunctionInputs, getFunctionOutput } from '../utils/expression-utils.js';
import { toConstraintString } from '../utils/cardinality-utils.js';
import { getNodeSourceRegion, getFunctionImplementationRegion, type SourceRegion } from '../utils/source-regions.js';

export const COMPOSITION_ANNOTATION = 'rune.studio.composition';
/** A normal model dependency, installed with newly authored compositions. */
export const COMPOSITION_MODEL_SOURCE = `namespace rune.studio
version "1.0.0"
annotation composition: <"Edit this function using the function composer.">
`;

export interface CompositionParameter {
  name: string;
  type: string;
  cardinality: string;
}
export interface CompositionCall {
  identity: string;
  region: SourceRegion;
  inputs: CompositionParameter[];
  output?: CompositionParameter;
  arguments: SourceRegion[];
  argumentVariables?: (string | undefined)[];
}
export interface CompositionStep {
  id: string;
  name: string;
  kind: 'input' | 'call' | 'each' | 'expression' | 'return';
  /** Canonical outer expression kind, retained for presentation without reparsing source. */
  expressionType?: RosettaExpression['$type'];
  region?: SourceRegion;
  statement?: SourceRegion;
  /** Exact source block, including attached trivia, for stable variable reordering. */
  sourceBlock?: SourceRegion;
  /** A reference-only variable shares its producer rather than creating another canvas node. */
  variableSource?: string;
  collection?: SourceRegion;
  locals?: string[];
  dependencies: string[];
  parameter?: CompositionParameter;
  call?: CompositionCall;
}
export interface CompositionCallable {
  identity: string;
  documentation?: string;
  inputs: CompositionParameter[];
  output?: CompositionParameter;
  /** Suggestions from exact resolved declaration identity and contained cardinality bounds; never validation. */
  accepts: Record<string, string[]>;
}
export interface FunctionComposition {
  callables?: CompositionCallable[];
  optedIn: boolean;
  supported: boolean;
  reasons: { message: string; region: SourceRegion; code?: 'unsupported' | 'unresolved' | 'forward-reference' }[];
  variablesRegion?: SourceRegion;
  steps: CompositionStep[];
  /** New aliases precede conditions and the whole-output assignment in grammar order. */
  insertion?: number;
}

function parameter(attribute: Attribute): CompositionParameter {
  return {
    name: attribute.name,
    type: attribute.typeCall.type.$refText,
    cardinality: toConstraintString(attribute.card)
  };
}

/** Linked facts only: no name-based annotation guessing, parser or alternate resolver. */
export function describeFunctionComposition(func: RosettaFunction, services?: RuneDslServices): FunctionComposition {
  const optedIn = func.annotations.some((annotation) => {
    const target = getLinkedReferenceTarget(annotation, annotation.annotation);
    return (
      target &&
      isRosettaModel(target.$container) &&
      qualifiedExportPath(target.$container.name, target.name) === COMPOSITION_ANNOTATION
    );
  });
  const result: FunctionComposition = { optedIn, supported: false, reasons: [], steps: [] };
  if (!optedIn) return result;
  const reason = (message: string, node = func) => result.reasons.push({ message, region: getNodeSourceRegion(node) });
  if (func.dispatchAttribute) reason('Dispatch implementations stay in Source.');
  if (func.superFunction) reason('Inherited function bodies stay in Source.');
  if (!func.output) reason('Declare an explicit output before composing.');
  if (
    func.operations.length !== 1 ||
    func.operations.some((op) => op.add || op.path || op.assignRoot.ref !== func.output)
  )
    reason('The composer requires one whole-output set; nested assignments and add stay in Source.');
  const locals = new Map<AstNode, string>([
    ...func.inputs.map((input) => [input, `input:${input.name}`] as const),
    ...func.shortcuts.map((alias) => [alias, `alias:${alias.name}`] as const)
  ]);
  if (func.output) locals.set(func.output, 'return');
  const portAttributes = new Map<string, Attribute>();
  const seen = new Set<string>();
  for (const input of func.inputs) {
    const id = locals.get(input)!;
    seen.add(id);
    portAttributes.set(id, input);
    result.steps.push({ id, name: input.name, kind: 'input', dependencies: [], parameter: parameter(input) });
  }
  const step = (id: string, name: string, expression: RosettaExpression, statement: SourceRegion, kind?: 'return') => {
    const dependencies = new Set<string>();
    for (const node of AstUtils.streamAst(expression)) {
      for (const info of AstUtils.streamReferences(node)) {
        if (!isReference(info.reference)) continue;
        const target = getLinkedReferenceTarget(node, info.reference);
        if (!target) {
          result.reasons.push({
            code: 'unresolved',
            message: `Resolve ${info.reference.$refText} before composing.`,
            region: getNodeSourceRegion(node)
          });
          continue;
        }
        const local = locals.get(target);
        if (local) {
          dependencies.add(local);
          if (!seen.has(local))
            result.reasons.push({
              code: 'forward-reference',
              message: 'Variables must depend on inputs or earlier variables.',
              region: getNodeSourceRegion(node)
            });
        }
      }
    }
    const callExpression = expression.$type === 'MapOperation' ? expression.function?.body : expression;
    const target =
      callExpression && isRosettaSymbolReference(callExpression)
        ? getLinkedReferenceTarget(callExpression, callExpression.symbol)
        : undefined;
    const call: CompositionCall | undefined =
      target && isRosettaFunction(target) && callExpression && isRosettaSymbolReference(callExpression)
        ? {
            identity: qualifiedExportPath(target.$container.name, target.name),
            region: getNodeSourceRegion(callExpression),
            inputs: getFunctionInputs(target).map(parameter),
            output: getFunctionOutput(target) ? parameter(getFunctionOutput(target)!) : undefined,
            arguments: callExpression.rawArgs.map(getNodeSourceRegion),
            argumentVariables: callExpression.rawArgs.map((argument) => {
              if (argument.$type === 'RosettaImplicitVariable') return `local:${id}:item`;
              const value =
                isRosettaSymbolReference(argument) && !argument.explicitArguments
                  ? getLinkedReferenceTarget(argument, argument.symbol)
                  : undefined;
              return value?.$type === 'ClosureParameter'
                ? `local:${id}:${value.name}`
                : value
                  ? locals.get(value)
                  : undefined;
            })
          }
        : undefined;
    if (call && call.arguments.length !== call.inputs.length)
      result.reasons.push({
        code: 'unsupported',
        message: 'Complete each positional call argument in Source before composing.',
        region: call.region
      });
    if (call && target && isRosettaFunction(target) && expression.$type !== 'MapOperation') {
      const output = getFunctionOutput(target);
      if (output) portAttributes.set(id, output);
    }
    const reference =
      isRosettaSymbolReference(expression) && !expression.explicitArguments
        ? getLinkedReferenceTarget(expression, expression.symbol)
        : undefined;
    const variableSource = reference ? locals.get(reference) : undefined;
    if (variableSource && portAttributes.has(variableSource))
      portAttributes.set(id, portAttributes.get(variableSource)!);
    result.steps.push({
      id,
      variableSource,
      ...(expression.$type === 'MapOperation'
        ? {
            collection: expression.argument ? getNodeSourceRegion(expression.argument) : undefined,
            locals: expression.function?.parameters.length
              ? expression.function.parameters.map((entry) => entry.name)
              : ['item']
          }
        : {}),
      name,
      kind: kind ?? (expression.$type === 'MapOperation' ? 'each' : call ? 'call' : 'expression'),
      expressionType: expression.$type,
      region: getNodeSourceRegion(expression),
      statement,
      dependencies: [...dependencies],
      call,
      parameter:
        kind && func.output
          ? parameter(func.output)
          : expression.$type === 'MapOperation'
            ? undefined
            : (call?.output ??
              (variableSource && portAttributes.has(variableSource)
                ? parameter(portAttributes.get(variableSource)!)
                : undefined))
    });
    seen.add(id);
  };
  for (const alias of func.shortcuts)
    step(`alias:${alias.name}`, alias.name, alias.expression, getNodeSourceRegion(alias));
  const operation = func.operations[0];
  if (operation) {
    result.insertion = getNodeSourceRegion(func.conditions[0] ?? operation).from;
    step('return', func.output?.name ?? 'result', operation.expression, getNodeSourceRegion(operation), 'return');
  }
  if (func.shortcuts.length) {
    const source = AstUtils.getDocument(func).textDocument.getText();
    const body = getFunctionImplementationRegion(func, source);
    const comments = getSourceComments(source);
    let from = body.from;
    for (let index = 0; index < func.shortcuts.length; index++) {
      const alias = func.shortcuts[index]!;
      const end = getNodeSourceRegion(alias).to;
      let to = source.indexOf('\n', end);
      to = to < 0 ? end : to + 1;
      // A trailing multiline comment belongs to the same source block.
      for (const comment of comments)
        if (comment.offset >= end && comment.offset < to && comment.end > to) {
          const next = source.indexOf('\n', comment.end);
          to = next < 0 ? comment.end : next + 1;
        }
      const next = func.shortcuts[index + 1] ?? func.conditions[0] ?? operation;
      if (next && to > getNodeSourceRegion(next).from) {
        result.reasons.push({
          code: 'unsupported',
          message: 'Inline variable declarations stay in Source.',
          region: getNodeSourceRegion(alias)
        });
        break;
      }
      const entry = result.steps.find((step) => step.id === `alias:${alias.name}`)!;
      entry.sourceBlock = { from, to };
      from = to;
    }
    result.variablesRegion = { from: body.from, to: from };
  }
  result.supported = result.reasons.length === 0;
  if (result.supported && services && operation) {
    const candidates = expressionScopeSymbols(operation.expression, services)
      .map((entry) => entry.node)
      .filter(isRosettaFunction);
    const unique = [...new Set(candidates)].filter((candidate) => !candidate.dispatchAttribute);
    result.callables = unique.map((candidate) => {
      const inputs = getFunctionInputs(candidate, new Set(), unique);
      const output = getFunctionOutput(candidate);
      const accepts: Record<string, string[]> = Object.create(null);
      for (const [id, source] of portAttributes) {
        const sourceType = getLinkedReferenceTarget(source.typeCall, source.typeCall.type);
        if (!sourceType) continue;
        const matches = inputs.filter(
          (input) =>
            getLinkedReferenceTarget(input.typeCall, input.typeCall.type) === sourceType &&
            source.card.inf >= input.card.inf &&
            (input.card.unbounded || (!source.card.unbounded && (source.card.sup ?? 1) <= (input.card.sup ?? 1)))
        );
        if (matches.length) accepts[id] = matches.map((input) => input.name);
      }
      return {
        identity: qualifiedExportPath(candidate.$container.name, candidate.name),
        documentation: candidate.definition,
        inputs: inputs.map(parameter),
        output: output ? parameter(output) : undefined,
        accepts
      };
    });
  }
  return result;
}
