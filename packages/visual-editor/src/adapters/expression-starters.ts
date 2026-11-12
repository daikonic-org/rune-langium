// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import { ALL_OPERATORS } from '../components/editors/expression-builder/operator-catalog.js';
import { parseExpression } from './parse-expression.js';
import { expressionNodeToDsl } from './expression-node-to-dsl.js';

export type ExpressionStarterType =
  | 'MapOperation'
  | 'FilterOperation'
  | 'SortOperation'
  | 'ReduceOperation'
  | 'DistinctOperation'
  | 'FlattenOperation'
  | 'RosettaCountOperation'
  | 'SumOperation'
  | 'RosettaConditionalExpression'
  | 'DefaultOperation';

/** Complete, editable starters using the expression palette's factories and canonical Rune renderer. */
export function createExpressionStarter(type: ExpressionStarterType, source: string): string {
  const definition = ALL_OPERATORS.find((operator) => operator.$type === type);
  if (!definition) throw new Error(`Missing expression operator: ${type}`);
  const node = definition.createNode(() => crypto.randomUUID());
  const argument = parseExpression(source);
  switch (node.$type) {
    case 'MapOperation':
    case 'FilterOperation':
    case 'ReduceOperation': {
      const reducing = node.$type === 'ReduceOperation';
      return expressionNodeToDsl({
        ...node,
        argument,
        function: {
          $type: 'InlineFunction',
          parameters: reducing ? ['accumulator', 'next'].map((name) => ({ $type: 'ClosureParameter', name })) : [],
          body: parseExpression(reducing ? 'accumulator' : node.$type === 'FilterOperation' ? 'item exists' : 'item')
        }
      });
    }
    case 'SortOperation':
      return expressionNodeToDsl({ ...node, argument, function: undefined });
    case 'DistinctOperation':
    case 'FlattenOperation':
    case 'RosettaCountOperation':
    case 'SumOperation':
      return expressionNodeToDsl({ ...node, argument });
    case 'RosettaConditionalExpression':
      return expressionNodeToDsl({ ...node, if: parseExpression('True'), ifthen: argument, elsethen: argument });
    case 'DefaultOperation':
      return expressionNodeToDsl({ ...node, left: argument, right: argument });
    default:
      throw new Error(`Unsupported expression starter: ${type}`);
  }
}
