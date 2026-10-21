// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import type { InstanceRecord } from '@rune-langium/codegen/instances';
import { buildPayloadGraph } from '../../services/instance-payload-graph.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const InstanceGraphPanel = withInstrumentation(
  function InstanceGraphPanel({
    record,
    onSelectPointer
  }: {
    record: InstanceRecord;
    onSelectPointer?(pointer: string): void;
  }) {
    const graph = buildPayloadGraph(record);
    const nodes: Node[] = graph.nodes.map((node, index) => ({
      id: node.id,
      position: { x: (index % 3) * 180, y: Math.floor(index / 3) * 90 },
      data: { label: node.pointer || node.label, pointer: node.pointer },
      type: 'default'
    }));
    const edges: Edge[] = graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
    return (
      <section
        aria-label="Payload graph"
        className="studio-payload-graph relative h-full min-h-0 border-t border-border"
        data-testid="prototype-payload-graph"
      >
        {graph.truncated ? (
          <p role="status" className="absolute z-10 m-2 rounded bg-background px-2 py-1 text-xs">
            Graph is truncated to 150 containers.
          </p>
        ) : null}
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            onNodeClick={(_, node) => onSelectPointer?.((node.data as { pointer: string }).pointer)}
          >
            <Background />
          </ReactFlow>
        </ReactFlowProvider>
      </section>
    );
  },
  { op: 'InstanceGraphPanel' }
);
