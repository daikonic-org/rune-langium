// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import type { CompositionStep, FunctionComposition } from '@rune-langium/core';
import type { Edge } from '@xyflow/react';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** Reference-only aliases project as tags on their existing producer. */
export const compositionProducerId = withInstrumentation(
  function compositionProducerId(id: string, steps: readonly CompositionStep[]): string {
    const visited = new Set<string>();
    let current = id;
    while (!visited.has(current)) {
      visited.add(current);
      const step = steps.find((step) => step.id === current);
      const source = step?.kind === 'return' ? undefined : step?.variableSource;
      if (!source) break;
      current = source;
    }
    return current;
  },
  { op: 'compositionProducerId', capture: 0 }
);

export interface CompositionWiring {
  step: string;
  inputs: { variable?: string; handle: string }[];
  output?: string;
}

export const compositionEdges = withInstrumentation(
  function compositionEdges(composition: FunctionComposition, wiring?: CompositionWiring): Edge[] {
    const edges = composition.steps
      .filter((step) => !step.variableSource || step.kind === 'return')
      .flatMap((step) =>
        step.dependencies.flatMap((dependency) => {
          const arguments_ =
            step.call?.argumentVariables?.flatMap((id, index) => (id === dependency ? [`argument:${index}`] : [])) ??
            [];
          return (arguments_.length ? arguments_ : ['input']).map((handle) => ({
            id: `${dependency}->${step.id}:${handle}`,
            source: compositionProducerId(dependency, composition.steps),
            sourceHandle: 'output',
            target: step.id,
            targetHandle: handle
          }));
        })
      );
    if (!wiring) return edges;
    const replaced = edges.filter(
      (edge) =>
        !(edge.target === wiring.step && wiring.inputs.some((input) => input.handle === edge.targetHandle)) &&
        edge.target !== wiring.output
    );
    for (const input of wiring.inputs)
      if (input.variable)
        replaced.push({
          id: `draft:${input.variable}->${wiring.step}:${input.handle}`,
          source: compositionProducerId(input.variable, composition.steps),
          sourceHandle: 'output',
          target: wiring.step,
          targetHandle: input.handle
        });
    if (
      wiring.output &&
      composition.steps.some((step) => step.id === wiring.output && (!step.variableSource || step.kind === 'return'))
    )
      replaced.push({
        id: `draft:${wiring.step}->${wiring.output}`,
        source: compositionProducerId(wiring.step, composition.steps),
        sourceHandle: 'output',
        target: wiring.output,
        targetHandle: 'input'
      });
    return replaced;
  },
  { op: 'compositionEdges', capture: 0 }
);
