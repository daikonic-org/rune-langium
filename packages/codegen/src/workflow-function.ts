// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import {
  COMPOSITION_ANNOTATION,
  isRosettaSymbolReference,
  parseExpression,
  type RosettaExpression
} from '@rune-langium/core';
import { renderModel } from './emit/rosetta/rosetta-render-core.js';

/** An authoring draft. The persisted/executable definition is ordinary Rune source. */
export interface WorkflowFunctionParameter {
  name: string;
  type: string;
  cardinality: { min: number; max: number | 'unbounded' };
}
export interface WorkflowFunctionStep {
  name: string;
  expression: string;
}
export interface WorkflowFunctionDefinition {
  composition?: boolean;
  namespace: string;
  name: string;
  description?: string;
  imports?: readonly string[];
  inputs: readonly WorkflowFunctionParameter[];
  output: WorkflowFunctionParameter;
  steps: readonly WorkflowFunctionStep[];
  result: string;
}

function identifier(value: string, label: string): void {
  const parsed = parseExpression(value);
  if (!/^[A-Za-z_]\w*$/.test(value) || parsed.hasErrors || !isRosettaSymbolReference(parsed.value))
    throw new Error(`${label} must be a Rune identifier.`);
}
function qualified(value: string, label: string): void {
  if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(value)) throw new Error(`${label} must be a qualified Rune name.`);
}
function expression(value: string, label: string): RosettaExpression {
  const parsed = parseExpression(value);
  if (!value.trim() || parsed.hasErrors) {
    const issue = [...parsed.lexerErrors, ...parsed.parserErrors][0]?.message;
    throw new Error(`${label}: ${issue ?? 'Enter a Rune expression.'}`);
  }
  return parsed.value;
}
function parameter(value: WorkflowFunctionParameter) {
  identifier(value.name, 'Parameter name');
  qualified(value.type, `Type of ${value.name}`);
  const { min, max } = value.cardinality;
  if (!Number.isSafeInteger(min) || min < 0 || (max !== 'unbounded' && (!Number.isSafeInteger(max) || max < min)))
    throw new Error(`Cardinality of ${value.name} must be a non-negative range.`);
  return {
    $type: 'Attribute',
    name: value.name,
    typeCall: { $type: 'TypeCall', type: { $refText: value.type } },
    card: {
      $type: 'RosettaCardinality',
      inf: min,
      sup: max === 'unbounded' ? undefined : max,
      unbounded: max === 'unbounded'
    }
  };
}

/** Render a composition through the shared Rune AST/expression renderer; no alternate workflow runtime. */
export function renderWorkflowFunction(definition: WorkflowFunctionDefinition): string {
  qualified(definition.namespace, 'Namespace');
  identifier(definition.name, 'Function name');
  if (!definition.steps.length) throw new Error('Add at least one workflow step.');
  const names = new Set<string>();
  for (const name of [
    ...definition.inputs.map((input) => input.name),
    definition.output.name,
    ...definition.steps.map((step) => step.name)
  ]) {
    identifier(name, 'Input, output or step name');
    if (names.has(name)) throw new Error(`The name ${name} is already used by this function.`);
    names.add(name);
  }
  const imports = [
    ...new Set([...(definition.imports ?? []), ...(definition.composition ? ['rune.studio'] : [])])
  ].filter((namespace) => namespace !== definition.namespace);
  for (const namespace of imports) qualified(namespace, 'Imported namespace');
  return renderModel(
    {
      name: definition.namespace,
      version: '1.0.0',
      elements: [
        {
          $type: 'RosettaFunction',
          name: definition.name,
          annotations: definition.composition
            ? [{ $type: 'AnnotationRef', annotation: { $refText: COMPOSITION_ANNOTATION }, qualifiers: [] }]
            : [],
          definition: definition.description,
          inputs: definition.inputs.map(parameter),
          output: parameter(definition.output),
          shortcuts: definition.steps.map((step) => ({
            $type: 'ShortcutDeclaration',
            name: step.name,
            expression: expression(step.expression, `Step ${step.name}`)
          })),
          operations: [
            {
              $type: 'Operation',
              assignRoot: { $refText: definition.output.name },
              expression: expression(definition.result, 'Result')
            }
          ]
        }
      ]
    },
    { declarations: imports.map((namespace) => `import ${namespace}.*`) }
  );
}
