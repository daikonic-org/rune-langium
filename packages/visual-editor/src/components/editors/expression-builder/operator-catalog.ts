// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Operator catalog — categorized operator definitions for the palette.
 *
 * @module
 */

import type { ExpressionNode } from '../../../schemas/expression-node-schema.js';

/** A palette drag can carry a catalog operator type for an inline expression slot. */
export const EXPRESSION_OPERATOR_MIME = 'application/x-rune-expression-operator';
export const SWITCH_GUARD_HOLE = '<?>';

export interface OperatorDefinition {
  label: string;
  $type: string;
  operator?: string;
  description: string;
  /** Factory to create the initial node with placeholders. */
  createNode: (uid: () => string) => ExpressionNode;
}

export interface OperatorCategory {
  id: string;
  label: string;
  operators: OperatorDefinition[];
}

function ph(uid: () => string): ExpressionNode {
  return { $type: 'Placeholder', id: uid() };
}

export const OPERATOR_CATALOG: OperatorCategory[] = [
  {
    id: 'arithmetic',
    label: 'Arithmetic',
    operators: [
      {
        label: '+ Add',
        $type: 'ArithmeticOperation',
        operator: '+',
        description: 'Addition',
        createNode: (uid) => ({
          $type: 'ArithmeticOperation',
          id: uid(),
          operator: '+',
          left: ph(uid),
          right: ph(uid)
        })
      },
      {
        label: '- Subtract',
        $type: 'ArithmeticOperation',
        operator: '-',
        description: 'Subtraction',
        createNode: (uid) => ({
          $type: 'ArithmeticOperation',
          id: uid(),
          operator: '-',
          left: ph(uid),
          right: ph(uid)
        })
      },
      {
        label: '* Multiply',
        $type: 'ArithmeticOperation',
        operator: '*',
        description: 'Multiplication',
        createNode: (uid) => ({
          $type: 'ArithmeticOperation',
          id: uid(),
          operator: '*',
          left: ph(uid),
          right: ph(uid)
        })
      },
      {
        label: '/ Divide',
        $type: 'ArithmeticOperation',
        operator: '/',
        description: 'Division',
        createNode: (uid) => ({
          $type: 'ArithmeticOperation',
          id: uid(),
          operator: '/',
          left: ph(uid),
          right: ph(uid)
        })
      }
    ]
  },
  {
    id: 'comparison',
    label: 'Comparison',
    operators: [
      {
        label: '= Equals',
        $type: 'EqualityOperation',
        operator: '=',
        description: 'Equality check',
        createNode: (uid) => ({
          $type: 'EqualityOperation',
          id: uid(),
          operator: '=',
          right: ph(uid)
        })
      },
      {
        label: '<> Not equals',
        $type: 'EqualityOperation',
        operator: '<>',
        description: 'Inequality check',
        createNode: (uid) => ({
          $type: 'EqualityOperation',
          id: uid(),
          operator: '<>',
          right: ph(uid)
        })
      },
      {
        label: '> Greater than',
        $type: 'ComparisonOperation',
        operator: '>',
        description: 'Greater than',
        createNode: (uid) => ({
          $type: 'ComparisonOperation',
          id: uid(),
          operator: '>',
          right: ph(uid)
        })
      },
      {
        label: '< Less than',
        $type: 'ComparisonOperation',
        operator: '<',
        description: 'Less than',
        createNode: (uid) => ({
          $type: 'ComparisonOperation',
          id: uid(),
          operator: '<',
          right: ph(uid)
        })
      },
      {
        label: '>= Greater or equal',
        $type: 'ComparisonOperation',
        operator: '>=',
        description: 'Greater than or equal',
        createNode: (uid) => ({
          $type: 'ComparisonOperation',
          id: uid(),
          operator: '>=',
          right: ph(uid)
        })
      },
      {
        label: '<= Less or equal',
        $type: 'ComparisonOperation',
        operator: '<=',
        description: 'Less than or equal',
        createNode: (uid) => ({
          $type: 'ComparisonOperation',
          id: uid(),
          operator: '<=',
          right: ph(uid)
        })
      },
      {
        label: 'contains',
        $type: 'RosettaContainsExpression',
        operator: 'contains',
        description: 'Collection contains value',
        createNode: (uid) => ({
          $type: 'RosettaContainsExpression',
          id: uid(),
          operator: 'contains',
          right: ph(uid)
        })
      },
      {
        label: 'disjoint',
        $type: 'RosettaDisjointExpression',
        operator: 'disjoint',
        description: 'Collections are disjoint',
        createNode: (uid) => ({
          $type: 'RosettaDisjointExpression',
          id: uid(),
          operator: 'disjoint',
          right: ph(uid)
        })
      }
    ]
  },
  {
    id: 'logic',
    label: 'Logic',
    operators: [
      {
        label: 'and',
        $type: 'LogicalOperation',
        operator: 'and',
        description: 'Logical AND',
        createNode: (uid) => ({
          $type: 'LogicalOperation',
          id: uid(),
          operator: 'and',
          left: ph(uid),
          right: ph(uid)
        })
      },
      {
        label: 'or',
        $type: 'LogicalOperation',
        operator: 'or',
        description: 'Logical OR',
        createNode: (uid) => ({
          $type: 'LogicalOperation',
          id: uid(),
          operator: 'or',
          left: ph(uid),
          right: ph(uid)
        })
      }
    ]
  },
  {
    id: 'navigation',
    label: 'Navigation',
    operators: [
      {
        label: '-> Feature',
        $type: 'RosettaFeatureCall',
        description: 'Navigate to attribute',
        createNode: (uid) => ({
          $type: 'RosettaFeatureCall',
          id: uid(),
          receiver: ph(uid)
        })
      },
      {
        label: '->> Deep feature',
        $type: 'RosettaDeepFeatureCall',
        description: 'Deep path navigation',
        createNode: (uid) => ({
          $type: 'RosettaDeepFeatureCall',
          id: uid(),
          receiver: ph(uid)
        })
      },
      {
        label: 'exists',
        $type: 'RosettaExistsExpression',
        operator: 'exists',
        description: 'Value exists (not empty)',
        createNode: (uid) => ({
          $type: 'RosettaExistsExpression',
          id: uid(),
          operator: 'exists',
          argument: ph(uid)
        })
      },
      {
        label: 'is absent',
        $type: 'RosettaAbsentExpression',
        operator: 'is absent',
        description: 'Value is absent',
        createNode: (uid) => ({
          $type: 'RosettaAbsentExpression',
          id: uid(),
          operator: 'is absent',
          argument: ph(uid)
        })
      }
    ]
  },
  {
    id: 'collection',
    label: 'Collection',
    operators: [
      {
        label: 'filter',
        $type: 'FilterOperation',
        operator: 'filter',
        description: 'Filter items by condition',
        createNode: (uid) => ({
          $type: 'FilterOperation',
          id: uid(),
          operator: 'filter',
          argument: ph(uid),
          function: { $type: 'InlineFunction', body: ph(uid) }
        })
      },
      {
        label: 'map / extract',
        $type: 'MapOperation',
        operator: 'extract',
        description: 'Transform each item',
        createNode: (uid) => ({
          $type: 'MapOperation',
          id: uid(),
          operator: 'extract',
          argument: ph(uid),
          function: { $type: 'InlineFunction', body: ph(uid) }
        })
      },
      {
        label: 'reduce',
        $type: 'ReduceOperation',
        operator: 'reduce',
        description: 'Reduce to single value',
        createNode: (uid) => ({
          $type: 'ReduceOperation',
          id: uid(),
          operator: 'reduce',
          argument: ph(uid),
          function: { $type: 'InlineFunction', body: ph(uid) }
        })
      },
      {
        label: 'sort',
        $type: 'SortOperation',
        operator: 'sort',
        description: 'Sort items',
        createNode: (uid) => ({
          $type: 'SortOperation',
          id: uid(),
          operator: 'sort',
          argument: ph(uid),
          function: { $type: 'InlineFunction', body: ph(uid) }
        })
      },
      {
        label: 'count',
        $type: 'RosettaCountOperation',
        operator: 'count',
        description: 'Count items',
        createNode: (uid) => ({
          $type: 'RosettaCountOperation',
          id: uid(),
          operator: 'count',
          argument: ph(uid)
        })
      },
      {
        label: 'sum',
        $type: 'SumOperation',
        operator: 'sum',
        description: 'Sum values',
        createNode: (uid) => ({
          $type: 'SumOperation',
          id: uid(),
          operator: 'sum',
          argument: ph(uid)
        })
      },
      {
        label: 'distinct',
        $type: 'DistinctOperation',
        operator: 'distinct',
        description: 'Remove duplicates',
        createNode: (uid) => ({
          $type: 'DistinctOperation',
          id: uid(),
          operator: 'distinct',
          argument: ph(uid)
        })
      },
      {
        label: 'flatten',
        $type: 'FlattenOperation',
        operator: 'flatten',
        description: 'Flatten nested lists',
        createNode: (uid) => ({
          $type: 'FlattenOperation',
          id: uid(),
          operator: 'flatten',
          argument: ph(uid)
        })
      },
      {
        label: 'first',
        $type: 'FirstOperation',
        operator: 'first',
        description: 'First element',
        createNode: (uid) => ({
          $type: 'FirstOperation',
          id: uid(),
          operator: 'first',
          argument: ph(uid)
        })
      },
      {
        label: 'last',
        $type: 'LastOperation',
        operator: 'last',
        description: 'Last element',
        createNode: (uid) => ({
          $type: 'LastOperation',
          id: uid(),
          operator: 'last',
          argument: ph(uid)
        })
      },
      {
        label: 'reverse',
        $type: 'ReverseOperation',
        operator: 'reverse',
        description: 'Reverse order',
        createNode: (uid) => ({
          $type: 'ReverseOperation',
          id: uid(),
          operator: 'reverse',
          argument: ph(uid)
        })
      },
      {
        label: 'only-element',
        $type: 'RosettaOnlyElement',
        operator: 'only-element',
        description: 'Single element from list',
        createNode: (uid) => ({
          $type: 'RosettaOnlyElement',
          id: uid(),
          operator: 'only-element',
          argument: ph(uid)
        })
      }
    ]
  },
  {
    id: 'control',
    label: 'Control Flow',
    operators: [
      {
        label: 'if / then / else',
        $type: 'RosettaConditionalExpression',
        description: 'Branch on a condition',
        createNode: (uid) => ({
          $type: 'RosettaConditionalExpression',
          id: uid(),
          full: true,
          if: ph(uid),
          ifthen: ph(uid),
          elsethen: ph(uid)
        })
      },
      {
        label: 'switch',
        $type: 'SwitchOperation',
        operator: 'switch',
        description: 'Pattern matching',
        createNode: (uid) => ({
          $type: 'SwitchOperation',
          id: uid(),
          operator: 'switch',
          argument: ph(uid),
          cases: [
            {
              $type: 'SwitchCaseOrDefault',
              guard: { $type: 'SwitchCaseGuard', referenceGuard: SWITCH_GUARD_HOLE },
              expression: ph(uid)
            },
            { $type: 'SwitchCaseOrDefault', expression: ph(uid) }
          ]
        })
      },
      {
        label: 'default',
        $type: 'DefaultOperation',
        operator: 'default',
        description: 'Default value fallback',
        createNode: (uid) => ({
          $type: 'DefaultOperation',
          id: uid(),
          operator: 'default',
          left: ph(uid),
          right: ph(uid)
        })
      },
      {
        label: 'then',
        $type: 'ThenOperation',
        operator: 'then',
        description: 'Pipeline chaining',
        createNode: (uid) => ({
          $type: 'ThenOperation',
          id: uid(),
          operator: 'then',
          argument: ph(uid),
          function: { $type: 'InlineFunction', body: ph(uid) }
        })
      }
    ]
  },
  {
    id: 'literal',
    label: 'Literals',
    operators: [
      {
        label: 'True',
        $type: 'RosettaBooleanLiteral',
        description: 'Boolean true',
        createNode: (uid) => ({
          $type: 'RosettaBooleanLiteral',
          id: uid(),
          value: true
        })
      },
      {
        label: 'False',
        $type: 'RosettaBooleanLiteral',
        description: 'Boolean false',
        createNode: (uid) => ({
          $type: 'RosettaBooleanLiteral',
          id: uid(),
          value: false
        })
      },
      {
        label: 'Number',
        $type: 'RosettaNumberLiteral',
        description: 'Decimal number',
        createNode: (uid) => ({
          $type: 'RosettaNumberLiteral',
          id: uid(),
          value: '0'
        })
      },
      {
        label: 'Integer',
        $type: 'RosettaIntLiteral',
        description: 'Whole number',
        createNode: (uid) => ({
          $type: 'RosettaIntLiteral',
          id: uid(),
          value: 0n
        })
      },
      {
        label: 'String',
        $type: 'RosettaStringLiteral',
        description: 'Text value',
        createNode: (uid) => ({
          $type: 'RosettaStringLiteral',
          id: uid(),
          value: ''
        })
      },
      {
        label: 'List',
        $type: 'ListLiteral',
        description: 'List of values',
        createNode: (uid) => ({
          $type: 'ListLiteral',
          id: uid(),
          elements: []
        })
      }
    ]
  }
];

/** Flat list of all operators for search. */
export const ALL_OPERATORS: OperatorDefinition[] = OPERATOR_CATALOG.flatMap((c) => c.operators);
