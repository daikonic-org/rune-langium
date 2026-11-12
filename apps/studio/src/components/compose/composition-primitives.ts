// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import type { CompositionStep } from '@rune-langium/core';
import type { ExpressionStarterType } from '@rune-langium/visual-editor';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import {
  ArrowDownWideNarrow,
  ArrowRightFromLine,
  ArrowRightToLine,
  Braces,
  CopyMinus,
  FoldVertical,
  GitBranch,
  Hash,
  Layers,
  ListFilter,
  ListPlus,
  Repeat2,
  Split,
  Workflow,
  type LucideIcon
} from 'lucide-react';

interface PrimitiveDefinition {
  id: string;
  label: string;
  description: string;
  group: 'Values & decisions' | 'Collections' | 'Totals' | 'Result';
  icon: LucideIcon;
  expressionType?: ExpressionStarterType;
}

/** One presentation registry for both the focused palette and canvas nodes. */
export const COMPOSITION_PRIMITIVES = [
  {
    id: 'expression',
    label: 'Expression',
    description: 'Write or build a Rune expression.',
    group: 'Values & decisions',
    icon: Braces
  },
  {
    id: 'branch',
    label: 'Branch',
    description: 'Choose a value with if, then and else.',
    group: 'Values & decisions',
    icon: GitBranch,
    expressionType: 'RosettaConditionalExpression'
  },
  {
    id: 'fallback',
    label: 'Fallback',
    description: 'Use a default when a value is absent.',
    group: 'Values & decisions',
    icon: Split,
    expressionType: 'DefaultOperation'
  },
  {
    id: 'each',
    label: 'For each',
    description: 'Transform each item with extract.',
    group: 'Collections',
    icon: Repeat2,
    expressionType: 'MapOperation'
  },
  {
    id: 'filter',
    label: 'Filter',
    description: 'Keep items that match a condition.',
    group: 'Collections',
    icon: ListFilter,
    expressionType: 'FilterOperation'
  },
  {
    id: 'sort',
    label: 'Sort',
    description: 'Order items; edit the expression to choose a sort key.',
    group: 'Collections',
    icon: ArrowDownWideNarrow,
    expressionType: 'SortOperation'
  },
  {
    id: 'distinct',
    label: 'Distinct',
    description: 'Remove duplicate items.',
    group: 'Collections',
    icon: CopyMinus,
    expressionType: 'DistinctOperation'
  },
  {
    id: 'flatten',
    label: 'Flatten',
    description: 'Combine nested lists into one list.',
    group: 'Collections',
    icon: Layers,
    expressionType: 'FlattenOperation'
  },
  {
    id: 'reduce',
    label: 'Reduce',
    description: 'Combine items using an accumulator and the next item.',
    group: 'Totals',
    icon: FoldVertical,
    expressionType: 'ReduceOperation'
  },
  {
    id: 'count',
    label: 'Count',
    description: 'Count the items in a collection.',
    group: 'Totals',
    icon: Hash,
    expressionType: 'RosettaCountOperation'
  },
  {
    id: 'sum',
    label: 'Sum',
    description: 'Add numeric values in a collection.',
    group: 'Totals',
    icon: ListPlus,
    expressionType: 'SumOperation'
  },
  {
    id: 'output',
    label: 'Output',
    description: 'Select the existing function output and bind its value.',
    group: 'Result',
    icon: ArrowRightFromLine
  }
] as const satisfies readonly PrimitiveDefinition[];

export type CompositionPrimitiveId = (typeof COMPOSITION_PRIMITIVES)[number]['id'];
type CompositionPrimitive = Omit<PrimitiveDefinition, 'id'> & { id: CompositionPrimitiveId };

export const findCompositionPrimitive = withInstrumentation(
  function findCompositionPrimitive(id: string): CompositionPrimitive | undefined {
    return COMPOSITION_PRIMITIVES.find((primitive) => primitive.id === id);
  },
  { op: 'findCompositionPrimitive', capture: 0 }
);

export const compositionNodePresentation = withInstrumentation(
  function compositionNodePresentation(step: CompositionStep): { label: string; icon: LucideIcon } {
    if (step.kind === 'return') return findCompositionPrimitive('output')!;
    if (step.kind === 'input') return { label: step.name, icon: ArrowRightToLine };
    const primitive = COMPOSITION_PRIMITIVES.find(
      (candidate) => 'expressionType' in candidate && candidate.expressionType === step.expressionType
    );
    if (primitive) return primitive;
    if (step.kind === 'each') return findCompositionPrimitive('each')!;
    if (step.call) return { label: step.call.identity.split('.').pop() ?? 'Function', icon: Workflow };
    return COMPOSITION_PRIMITIVES[0];
  },
  { op: 'compositionNodePresentation', capture: 0 }
);
