// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  getNodesBounds,
  getViewportForBounds,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type NodeChange,
  type XYPosition,
  type Viewport,
  type Connection
} from '@xyflow/react';
import type { CompositionStep, FunctionComposition } from '@rune-langium/core';
import { computeGraphPositions } from '@rune-langium/visual-editor';
import { CompositionNode, NodeBindingContext, type ComposerNode } from './CompositionNode.js';
import { compositionEdges, type CompositionWiring } from './composition-graph.js';

const FIT = { padding: 0.12, minZoom: 0.35, maxZoom: 1 };
const FOCUS = { ...FIT, padding: 0.15 };
const NODE_TYPES = { composition: CompositionNode };
const FLOW_OPTIONS = { hideAttribution: true };
export const DRAFT_NODE = 'draft:new';

export interface SavedCompositionViewport {
  viewport: Viewport;
  width: number;
}

interface Props {
  current?: FunctionComposition;
  presented: FunctionComposition;
  source: string;
  preview?: { step: CompositionStep; expression: string; position?: XYPosition };
  wiring?: CompositionWiring;
  active: boolean;
  vertical: boolean;
  selected: string;
  syncSelection?: boolean;
  variablesOpen: boolean;
  viewKey: string;
  size: { width: number; height: number };
  onGraphElement(element: HTMLDivElement | null): void;
  focus?: string;
  setFocus: Dispatch<SetStateAction<string | undefined>>;
  positions: Map<string, Map<string, XYPosition>>;
  viewports: Map<string, SavedCompositionViewport>;
  onSelect(step: CompositionStep, focus?: boolean): void;
  onDraftMove(position: XYPosition): void;
  onConnect(connection: Connection): void;
  onDrop(event: React.DragEvent, placeNode: (id: string, position: XYPosition) => void): void;
}

function layoutNodes(
  nodes: ComposerNode[],
  edges: Edge[],
  vertical: boolean,
  pinned?: Map<string, XYPosition>
): ComposerNode[] {
  const positions = computeGraphPositions(
    nodes.map((node) => ({
      id: node.id,
      width: node.measured?.width ?? 280,
      height: node.measured?.height ?? (node.data.step.kind === 'input' ? 140 : 240)
    })),
    edges,
    { direction: vertical ? 'TB' : 'LR', nodeSeparation: 40, rankSeparation: 60 }
  );
  return nodes.map((node) => ({ ...node, position: pinned?.get(node.id) ?? positions[node.id] ?? node.position }));
}

/** Pointer-rate state stays here; it must never invalidate the composer or its inspector. */
export const CompositionCanvas = memo(function CompositionCanvas({
  current,
  presented,
  source,
  preview,
  wiring,
  active,
  vertical,
  selected,
  syncSelection = false,
  variablesOpen,
  viewKey,
  size,
  onGraphElement,
  focus,
  setFocus,
  positions,
  viewports,
  onSelect,
  onDraftMove,
  onConnect,
  onDrop
}: Props) {
  const [nodes, setNodes] = useState<ComposerNode[]>([]);
  const [interacting, setInteracting] = useState(false);
  const interactingNow = useRef(false);
  const actions = useContext(NodeBindingContext);
  const flow = useReactFlow<ComposerNode>();
  const initialized = useNodesInitialized();
  const graphElement = useRef<HTMLDivElement>(null);
  const attachGraph = useCallback(
    (element: HTMLDivElement | null) => {
      graphElement.current = element;
      onGraphElement(element);
    },
    [onGraphElement]
  );
  const cameraKey = useRef<string | undefined>(undefined);
  const previousSize = useRef({ ...size, vertical });
  const edges = useMemo(() => compositionEdges(presented, wiring), [presented, wiring]);
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      const next: ComposerNode[] = presented.steps
        .filter((step) => !step.variableSource || step.kind === 'return')
        .map((step) => {
          const old = byId.get(step.id);
          const expression = step.region ? source.slice(step.region.from, step.region.to) : '';
          return {
            ...old,
            id: step.id,
            type: 'composition',
            position: old?.position ?? { x: 0, y: 0 },
            selected: step.id === selected,
            data:
              old?.data.step === step && old.data.expression === expression && old.data.vertical === vertical
                ? old.data
                : { step, expression, vertical }
          };
        });
      const laidOut = layoutNodes(next, edges, vertical, positions.get(viewKey));
      if (preview) {
        const old = byId.get(DRAFT_NODE);
        laidOut.push({
          ...old,
          id: DRAFT_NODE,
          type: 'composition',
          selected: true,
          position: old?.position ?? preview.position ?? { x: 320, y: 180 },
          data: { step: preview.step, expression: preview.expression, vertical }
        });
      } else positions.get(viewKey)?.delete(DRAFT_NODE);
      return laidOut;
    });
  }, [presented, source, preview, edges, vertical, viewKey, positions]);
  useEffect(() => {
    setNodes((previous) =>
      previous.map((node) =>
        node.selected === (node.id === selected) ? node : { ...node, selected: node.id === selected }
      )
    );
  }, [selected]);
  const graphCurrent = Boolean(
    current &&
    nodes.every(
      (node) => node.id === DRAFT_NODE || node.data.step === current.steps.find((step) => step.id === node.id)
    )
  );
  const bindings = useMemo(
    () => actions && { ...actions, writable: actions.writable && graphCurrent },
    [actions, graphCurrent]
  );
  useEffect(() => {
    if (!active || !graphCurrent || !initialized || !nodes.length || !size.width || cameraKey.current === viewKey)
      return;
    cameraKey.current = viewKey;
    if (!focus) {
      const saved = viewports.get(viewKey);
      // A narrower canvas can remount with an older camera for its layout direction.
      if (saved && size.width >= saved.width) void flow.setViewport(saved.viewport);
      else setFocus(variablesOpen ? selected : '*');
    }
  }, [
    active,
    graphCurrent,
    initialized,
    nodes,
    viewKey,
    flow,
    focus,
    size.width,
    variablesOpen,
    selected,
    viewports,
    setFocus
  ]);
  useEffect(() => {
    const previous = previousSize.current;
    previousSize.current = { ...size, vertical };
    // Initial measurement belongs to camera restoration, not resize-to-fit.
    if (
      previous.width > 0 &&
      previous.height > 0 &&
      size.width > 0 &&
      size.height > 0 &&
      (previous.width !== size.width || previous.height !== size.height || previous.vertical !== vertical)
    )
      setFocus(variablesOpen ? selected : '*');
  }, [size.width, size.height, vertical, variablesOpen, selected, setFocus]);
  useEffect(() => {
    if (
      !active ||
      interacting ||
      !graphCurrent ||
      !focus ||
      !initialized ||
      !nodes.length ||
      nodes.some((node) => !node.measured?.height) ||
      (focus !== '*' && !nodes.some((node) => node.id === focus))
    )
      return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const graph = graphElement.current;
      if (!graph?.clientWidth || !graph.clientHeight) return;
      const targets = focus === '*' ? nodes : nodes.filter((node) => node.id === focus);
      const { minZoom, maxZoom, padding } = focus === '*' ? FIT : FOCUS;
      // React Flow can still hold the previous direction's positions during a remount.
      const bounds = getNodesBounds(targets);
      const viewport = getViewportForBounds(bounds, graph.clientWidth, graph.clientHeight, minZoom, maxZoom, padding);
      void flow.setViewport(viewport).then((fitted) => {
        if (fitted && !cancelled) setFocus((latest) => (latest === focus ? undefined : latest));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [focus, nodes, initialized, graphCurrent, active, interacting, flow, size.width, size.height, setFocus]);
  const selectedSize = nodes.find((node) => node.id === selected)?.measured;
  const changeNodes = useCallback(
    (changes: NodeChange<ComposerNode>[]) => {
      // React Flow also reports keyboard selection through node changes.
      const selection = syncSelection && changes.find((change) => change.type === 'select' && change.selected);
      if (selection && selection.type === 'select' && selection.id !== selected) {
        const step =
          selection.id === DRAFT_NODE ? preview?.step : presented.steps.find(({ id }) => id === selection.id);
        if (step) onSelect(step, false);
      }
      const layoutChanges = syncSelection ? changes.filter((change) => change.type !== 'select') : changes;
      if (!layoutChanges.length) return;
      // Expanding a manually placed node must not pull it away from the pointer.
      const manuallyPlaced =
        positions.get(viewKey)?.has(selected) || (selected === DRAFT_NODE && preview?.position !== undefined);
      if (
        variablesOpen &&
        !interactingNow.current &&
        !manuallyPlaced &&
        selectedSize?.height &&
        layoutChanges.some(
          (change) =>
            change.type === 'dimensions' &&
            change.id === selected &&
            change.dimensions &&
            (change.dimensions.width !== selectedSize.width || change.dimensions.height !== selectedSize.height)
        )
      )
        setFocus(selected);
      setNodes((previous) => {
        const next = applyNodeChanges(layoutChanges, previous);
        if (interactingNow.current || !layoutChanges.some((change) => change.type === 'dimensions')) return next;
        // The draft's free position is independent of rank layout.
        const draft = next.find((node) => node.id === DRAFT_NODE);
        const laidOut = layoutNodes(
          next.filter((node) => node.id !== DRAFT_NODE),
          edges,
          vertical,
          positions.get(viewKey)
        );
        return draft ? [...laidOut, draft] : laidOut;
      });
    },
    [
      variablesOpen,
      selectedSize,
      selected,
      syncSelection,
      edges,
      vertical,
      positions,
      viewKey,
      preview,
      presented,
      onSelect,
      setFocus
    ]
  );
  const rememberNodePosition = (id: string, position: XYPosition) => {
    const saved = positions.get(viewKey) ?? new Map<string, XYPosition>();
    saved.set(id, position);
    positions.set(viewKey, saved);
  };
  const placeNode = (id: string, position: XYPosition) => {
    rememberNodePosition(id, position);
    setNodes((previous) => applyNodeChanges([{ type: 'position', id, position }], previous));
  };
  return (
    <NodeBindingContext.Provider value={bindings}>
      <div ref={attachGraph} className="function-composer__graph">
        <ReactFlow<ComposerNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesConnectable={Boolean(bindings?.writable && !bindings.busy)}
          onConnect={onConnect}
          onConnectStart={() => {
            interactingNow.current = true;
            setInteracting(true);
          }}
          onConnectEnd={() => {
            interactingNow.current = false;
            setInteracting(false);
          }}
          deleteKeyCode={null}
          fitViewOptions={FIT}
          proOptions={FLOW_OPTIONS}
          onMoveEnd={(_, viewport) => viewports.set(viewKey, { viewport, width: size.width })}
          onNodeClick={(_, node) => onSelect(node.data.step)}
          onNodesChange={changeNodes}
          onNodeDragStart={() => {
            interactingNow.current = true;
            setInteracting(true);
          }}
          onNodeDragStop={(_, node) => {
            interactingNow.current = false;
            setInteracting(false);
            rememberNodePosition(node.id, node.position);
            if (node.id === DRAFT_NODE) onDraftMove(node.position);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => onDrop(event, placeNode)}
          aria-label="Function dependency graph"
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </NodeBindingContext.Provider>
  );
});
