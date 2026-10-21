// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import React, {
  createContext,
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { ArrowRight, ArrowUpRight, ChevronRight, CircleHelp, LoaderCircle, LocateFixed } from 'lucide-react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { buildStructureGraph, type AdapterDocument } from '../adapters/structure-graph-adapter.js';
import {
  expansionKey,
  type StructureExpansionKey,
  type StructureGraphInput,
  type StructureNode,
  type StructureRow
} from '../types/structure-view.js';
import { useNavigationArrival } from '../hooks/useNavigationArrival.js';
import {
  useDiagnosticsForRange,
  diagnosticSeverityClass,
  type RangeDiagnostic
} from '../hooks/useDiagnosticsForRange.js';
import { useTypeNavigationMenu } from './TypeNavigationMenu.js';
import { StructureMetaIndicators } from './nodes/StructureMetaIndicators.js';
import { TypeChip } from './editors/structure/TypeChip.js';
import { placeStructureBlock, type CanvasRect } from '../utils/structure-placement.js';
import { ENUM_PREVIEW_LIMIT, enumPreviewLabel } from '../utils/enum-preview.js';

export interface StructureCellComponents {
  readonly name?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
  readonly type?: React.ComponentType<{
    typeName: string;
    typeKind: StructureRow['typeKind'];
    nodeId: string;
    attrName: string;
  }>;
  readonly card?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
}

/** Shared host contract for the focused document and its existing editor slots. */
export interface StructureViewProps {
  readonly navigationRevision?: number;
  readonly focusedTypeId: string | undefined;
  readonly adapterDoc: AdapterDocument | undefined;
  readonly expansionMap?: ReadonlyMap<string, boolean>;
  readonly cellComponents?: StructureCellComponents;
  readonly onToggleExpansion?: (key: StructureExpansionKey) => void;
  readonly unsupportedSelectedType?: { name: string; kind: string };
  /** Selection and navigation always use canonical identities, never instance IDs. */
  readonly onNodeSelect?: (canonicalTypeId: string) => void;
  /** Historical prop name; handles resolved references of every supported kind. */
  readonly onNavigateToEnumType?: (typeId: string) => void;
  readonly onInspectType?: (typeId: string) => void;
  readonly structureDiagnostics?: readonly RangeDiagnostic[];
  readonly pendingHydrationNamespaces?: ReadonlyArray<string>;
}

const EMPTY_EXPANSIONS: ReadonlyMap<string, boolean> = new Map();
const EMPTY_DIAGNOSTICS: readonly RangeDiagnostic[] = [];
const EMPTY_PATH: readonly string[] = [];

interface DocumentContextValue extends Omit<StructureViewProps, 'adapterDoc' | 'unsupportedSelectedType'> {
  graph: StructureGraphInput;
  arrivalNodeId: string | null;
  layouts: ReturnType<typeof createBlockLayouts>;
}
const DocumentContext = createContext<DocumentContextValue | null>(null);
function useDocument() {
  const value = useContext(DocumentContext);
  if (!value) throw new Error('Structure content requires its document context');
  return value;
}

/** Native child sizes determine the local canvas extent; placement never touches model state. */
function StructureMembers({
  children,
  output = false,
  label
}: {
  children: React.ReactNode;
  output?: boolean;
  label?: string;
}) {
  const canvas = useRef<HTMLOListElement>(null);
  const { layouts } = useDocument();
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let dimensions = '';
    const measure = () => {
      const rows = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const fixed = rows.flatMap((row) => {
        const branch = row.querySelector<HTMLElement>(':scope > .rune-structure-member__child[data-placed]');
        return branch ? [{ branch, rect: blockRect(branch) }] : [];
      });
      const anchors = rows.flatMap((row) =>
        Array.from(row.querySelectorAll<HTMLElement>(':scope > .rune-structure-member__row'))
      );
      const rowWidth = Math.max(0, ...anchors.map((anchor) => anchor.offsetWidth));
      const branches = rows.flatMap((row) =>
        Array.from(row.querySelectorAll<HTMLElement>(':scope > .rune-structure-member__child'))
      );
      const nextDimensions = `${element.clientWidth}:${branches.map((branch) => `${branch.offsetWidth},${branch.offsetHeight}`).join(';')}`;
      const placeDefaults = dimensions !== nextDimensions;
      dimensions = nextDimensions;
      const card = element.parentElement;
      if (!output && card) {
        if (branches.length) {
          const childWidth = Math.max(...branches.map((branch) => branch.offsetWidth));
          card.toggleAttribute('data-compact', availableBlockWidth(card) < rowWidth + childWidth + 32);
          const preferred = `${Math.ceil(rowWidth + childWidth + 48)}px`;
          if (card.style.getPropertyValue('--structure-preferred-width') !== preferred)
            card.style.setProperty('--structure-preferred-width', preferred);
        } else {
          card.removeAttribute('data-compact');
          card.style.removeProperty('--structure-preferred-width');
        }
      }
      const occupied: CanvasRect[] = [];
      let nextTop = 8;
      let extent = 0;
      for (const row of rows) {
        const anchor = row.querySelector<HTMLElement>(':scope > .rune-structure-member__row');
        const branch = row.querySelector<HTMLElement>(':scope > .rune-structure-member__child');
        if (anchor) extent = Math.max(extent, anchor.offsetTop + anchor.offsetHeight);
        if (!branch) continue;
        const separator = branch.querySelector<HTMLElement>(':scope > [role="separator"]');
        separator?.setAttribute('aria-valuenow', `${Math.round(branch.offsetWidth)}`);
        separator?.setAttribute('aria-valuemax', `${element.clientWidth}`);
        const top = Math.max(anchor?.offsetTop ?? 8, nextTop);
        if (!branch.dataset.placed && placeDefaults && getComputedStyle(branch).position === 'absolute') {
          const peers = [...occupied, ...fixed.map((item) => item.rect)];
          const desired = {
            x: Math.min(rowWidth + 32, Math.max(0, element.clientWidth - branch.offsetWidth - 8)),
            y: top,
            width: branch.offsetWidth,
            height: branch.offsetHeight
          };
          const fallback = { ...desired, y: Math.max(top, ...peers.map((peer) => peer.y + peer.height + 16)) };
          const placed = placeStructureBlock(desired, fallback, peers, element.clientWidth, 'move');
          branch.style.setProperty('--structure-default-x', `${placed.x}px`);
          branch.style.setProperty('--structure-default-y', `${placed.y}px`);
        } else if (placeDefaults) branch.style.setProperty('--structure-default-y', `${top}px`);
        occupied.push(blockRect(branch));
        nextTop = branch.offsetTop + branch.offsetHeight + 24;
        extent = Math.max(extent, branch.offsetTop + branch.offsetHeight);
        const connector = row.querySelector<SVGPathElement>(':scope > svg > path');
        if (anchor && connector) {
          const x = anchor.offsetLeft + anchor.offsetWidth;
          const y = anchor.offsetTop + anchor.offsetHeight / 2;
          const targetX = branch.offsetLeft;
          const header = branch.querySelector<HTMLElement>(':scope > section > header');
          const targetY = branch.offsetTop + (header?.offsetHeight ?? 36) / 2;
          const controlX = x + (targetX - x) / 2;
          connector.setAttribute('d', `M ${x} ${y} C ${controlX} ${y}, ${controlX} ${targetY}, ${targetX} ${targetY}`);
        }
      }
      const bottomInset = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
      const minHeight = `${extent + bottomInset}px`;
      if (element.style.minHeight !== minHeight) element.style.minHeight = minHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element
      .querySelectorAll(':scope > li > .rune-structure-member__row, :scope > li > .rune-structure-member__child')
      .forEach((child) => observer.observe(child));
    let pending = 0;
    const unsubscribe = layouts.subscribe(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(measure);
    });
    return () => {
      observer.disconnect();
      unsubscribe();
      cancelAnimationFrame(pending);
    };
  }, [children, layouts, output]);
  return (
    <ol ref={canvas} aria-label={label} className="rune-structure-members">
      {children}
    </ol>
  );
}

function StructureMember({
  row,
  owner,
  instancePath,
  inherited = false,
  choice = false,
  output = false
}: {
  row: StructureRow;
  owner: StructureNode;
  instancePath: readonly string[];
  inherited?: boolean;
  choice?: boolean;
  output?: boolean;
}) {
  const context = useDocument();
  const namespaceUri = owner.kind === 'base' ? owner.baseTypeNamespaceUri : owner.namespaceUri;
  const typeId = owner.kind === 'base' ? owner.baseTypeName : owner.name;
  const key: StructureExpansionKey = { namespaceUri, typeId, attrName: row.attrName, instancePath };
  const expandable = owner.kind !== 'function' && !output && (row.typeKind === 'Data' || row.typeKind === 'Choice');
  const expanded = expandable && context.expansionMap?.get(expansionKey(key)) === true;
  const childId = 'expansions' in owner ? owner.expansions.get(row.attrName) : undefined;
  const child = childId ? context.graph.nodes.get(childId) : undefined;
  const diagnostic = useDiagnosticsForRange(row.astRange, context.structureDiagnostics ?? EMPTY_DIAGNOSTICS);
  const navigation = useTypeNavigationMenu({
    onNavigate: context.onNavigateToEnumType,
    onInspect: context.onInspectType
  });
  const readonly = inherited || owner.kind === 'function';
  const Name = readonly ? undefined : context.cellComponents?.name;
  const Type = readonly ? undefined : context.cellComponents?.type;
  const Card = readonly ? undefined : context.cellComponents?.card;
  const controlsId = useId();
  const branch = useRef<HTMLDivElement>(null);
  const split = useBlockLayout(childId ?? controlsId, true, branch, true);
  return (
    <li className="rune-structure-member" data-expanded={expanded || undefined} data-choice={choice || undefined}>
      <div
        className={`rune-structure-member__row ${diagnostic ? diagnosticSeverityClass(diagnostic.severity) : ''}`}
        data-attr={row.attrName}
        title={diagnostic?.message}
        {...navigation.targetProps(row.targetNodeId, `${row.attrName} type ${row.typeName}`)}
      >
        {!choice && (
          <div className="rune-structure-member__name">
            {output && <ArrowRight className="size-3.5" aria-label="Output" />}
            {Name ? (
              <Name value={row.attrName} nodeId={owner.id} attrName={row.attrName} />
            ) : (
              <span className="rune-cell-name">{row.attrName}</span>
            )}
          </div>
        )}
        <div className="rune-structure-member__type">
          {Type ? (
            <Type typeName={row.typeName} typeKind={row.typeKind} nodeId={owner.id} attrName={row.attrName} />
          ) : (
            <TypeChip as="span" typeName={row.typeName} typeKind={row.typeKind} />
          )}
          {!choice &&
            (Card ? (
              <Card value={row.cardinality} nodeId={owner.id} attrName={row.attrName} />
            ) : (
              <span className="rune-cell-card">{row.cardinality}</span>
            ))}
          {row.typeKind === 'Unresolved' && (
            <span
              role="img"
              aria-label={`Unresolved type: ${row.typeName}`}
              title="The referenced type could not be resolved"
            >
              <CircleHelp className="size-3.5" />
            </span>
          )}
          {row.targetNodeId && context.onNavigateToEnumType && (
            <button
              type="button"
              className="rune-structure-icon"
              aria-label={`Navigate to ${row.typeName}`}
              title={`Navigate to ${row.typeName}`}
              onClick={() => context.onNavigateToEnumType?.(row.targetNodeId!)}
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {expandable && (
          <button
            type="button"
            className="rune-structure-icon rune-structure-member__toggle"
            aria-expanded={expanded}
            aria-controls={expanded ? controlsId : undefined}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.attrName}`}
            onClick={() => context.onToggleExpansion?.(key)}
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && (
        <div
          className="rune-structure-member__child"
          id={controlsId}
          ref={branch}
          data-placed={split.layout.placed || undefined}
          data-sized={split.layout.widthPx !== undefined || undefined}
          style={{
            width: split.layout.widthPx,
            ...(split.layout.placed
              ? {
                  left: `clamp(0px, ${split.layout.x}px, calc(100% - ${split.layout.widthPx ?? branch.current?.offsetWidth ?? 0}px))`,
                  top: split.layout.y
                }
              : {})
          }}
        >
          {child && (
            <div
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${row.attrName} branch`}
              aria-orientation="vertical"
              aria-controls={controlsId}
              aria-valuemin={0}
              aria-valuemax={
                branch.current?.offsetParent instanceof HTMLElement ? branch.current.offsetParent.clientWidth : 10000
              }
              aria-valuenow={Math.round(split.layout.widthPx ?? branch.current?.offsetWidth ?? 0)}
              className="rune-structure-member__split"
              onPointerDown={(event) => split.start(event, 'resize')}
              onKeyDown={(event) => split.keyboard(event, 'resize')}
              {...split.pointerEvents}
            />
          )}
          {child ? (
            <StructureCard key={childId} node={child} ancestors={instancePath} split />
          ) : (
            <p className="rune-structure-reference">Reference already shown in this branch.</p>
          )}
        </div>
      )}
      {expanded && child && (
        <svg className="rune-structure-connector" aria-hidden="true">
          <path />
        </svg>
      )}
      {navigation.menu}
    </li>
  );
}

function StructureSectionTitle({ label, count, output }: { label: string; count?: number; output?: boolean }) {
  return (
    <p className="rune-structure-section-title" data-output={output || undefined}>
      {label}
      {count !== undefined && <span>{count}</span>}
    </p>
  );
}

function StructureCard({
  node,
  ancestors,
  split = false
}: {
  node: StructureNode;
  ancestors: readonly string[];
  split?: boolean;
}) {
  const context = useDocument();
  const isBase = node.kind === 'base';
  const name = isBase ? node.baseTypeName : node.name;
  const namespace = isBase ? node.baseTypeNamespaceUri : node.namespaceUri;
  const navigationId = isBase ? node.baseTypeId : node.id;
  const instanceId = node.instanceId ?? node.id;
  const path = useMemo(() => [...ancestors, instanceId], [ancestors, instanceId]);
  const navigation = useTypeNavigationMenu({
    onNavigate: context.onNavigateToEnumType,
    onInspect: context.onInspectType
  });
  const titleId = useId();
  const frame = useRef<HTMLElement>(null);
  const constrained = ancestors.length > 0;
  const motion = useBlockLayout(instanceId, constrained, frame, split);
  const helpId = useId();
  const hydrating = !isBase && node.deferred && context.pendingHydrationNamespaces?.includes(namespace);
  const rows =
    node.kind === 'data' ? node.rows : isBase ? node.baseRows : node.kind === 'function' ? node.inputRows : [];
  const meta = node.kind === 'data' || node.kind === 'choice' || node.kind === 'function' ? node : {};
  return (
    <section
      ref={frame}
      className={`rune-structure-card${context.arrivalNodeId === node.id ? ' rune-navigation-arrival' : ''}`}
      style={
        split
          ? undefined
          : constrained
            ? {
                marginInlineStart: split ? 0 : motion.layout.x,
                marginBlockStart: motion.layout.y,
                maxWidth: split ? '100%' : `calc(100% - ${motion.layout.x}px)`
              }
            : { translate: `${motion.layout.x}px ${motion.layout.y}px` }
      }
      data-kind={node.kind}
      data-canonical-id={node.id}
      data-instance-id={instanceId}
      aria-labelledby={titleId}
    >
      <header
        data-structure-drag-handle="true"
        className="rune-structure-card__header"
        {...navigation.targetProps(navigationId, `${name} type actions`)}
        tabIndex={0}
        aria-describedby={helpId}
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            !event.target.closest('button,input,textarea,[contenteditable="true"]')
          )
            motion.start(event, 'move');
        }}
        {...motion.pointerEvents}
        onKeyDown={(event) => {
          navigation.onKeyDown(event, navigationId);
          if (!event.defaultPrevented && event.target === event.currentTarget) motion.keyboard(event, 'move');
        }}
      >
        {navigationId && context.onNodeSelect ? (
          <button
            className="rune-structure-card__title"
            type="button"
            id={titleId}
            title={`${namespace}.${name}`}
            onClick={() => context.onNodeSelect?.(navigationId)}
          >
            {name}
          </button>
        ) : (
          <span className="rune-structure-card__title" id={titleId}>
            {name}
          </span>
        )}
        <StructureMetaIndicators {...meta} />
        {hydrating && (
          <span role="status" className="rune-structure-card__loading">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">Loading referenced namespace</span>
          </span>
        )}
        <span className="rune-structure-card__kind">{isBase ? 'Inherited' : node.kind}</span>
      </header>
      {node.kind === 'function' && <StructureSectionTitle label="Inputs" count={rows.length} />}
      {node.kind === 'function' && rows.length === 0 && <p className="rune-structure-reference">No inputs</p>}
      {rows.length > 0 && (
        <StructureMembers label={node.kind === 'function' ? 'Inputs' : undefined}>
          {rows.map((row) => (
            <StructureMember key={row.attrName} row={row} owner={node} instancePath={path} inherited={isBase} />
          ))}
        </StructureMembers>
      )}
      {node.kind === 'choice' && (
        <>
          <StructureSectionTitle label="Options" count={node.options.length} />
          {node.options.length === 0 && <p className="rune-structure-reference">No options</p>}
          <StructureMembers label="Options">
            {node.options.map((option) => (
              <StructureMember
                key={option.typeName}
                row={{
                  ...option,
                  typeKind: option.typeKind === 'Builtin' ? 'BasicType' : option.typeKind,
                  attrName: option.typeName,
                  cardinality: '',
                  isOptional: false,
                  isInherited: false
                }}
                owner={node}
                instancePath={path}
                choice
              />
            ))}
          </StructureMembers>
        </>
      )}
      {node.kind === 'enum' && (
        <>
          <StructureSectionTitle label="Values" count={node.values.length} />
          {node.values.length === 0 && <p className="rune-structure-reference">No values</p>}
          <ol className="rune-structure-enum" aria-label="Values">
            {(context.onInspectType ? node.values.slice(0, ENUM_PREVIEW_LIMIT) : node.values).map((value, index) => (
              <li key={`${value}:${index}`}>{value}</li>
            ))}
          </ol>
        </>
      )}
      {node.kind === 'enum' && node.values.length > ENUM_PREVIEW_LIMIT && context.onInspectType && (
        <button type="button" className="rune-structure-enum__more" onClick={() => context.onInspectType?.(node.id)}>
          {enumPreviewLabel(node.values.length)}
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {node.kind === 'function' && (
        <>
          <StructureSectionTitle label="Output" output />
          {node.outputRow ? (
            <StructureMembers output label="Output">
              <StructureMember row={node.outputRow} owner={node} instancePath={path} output />
            </StructureMembers>
          ) : (
            <p className="rune-structure-reference">No output declared</p>
          )}
        </>
      )}
      {isBase && context.graph.nodes.get(node.childNodeId) && (
        <div className="rune-structure-derived">
          <StructureCard key={node.childNodeId} node={context.graph.nodes.get(node.childNodeId)!} ancestors={path} />
        </div>
      )}
      <span id={helpId} className="sr-only">
        Drag this header to move the block. Arrow keys move, Shift moves farther, Home resets.
      </span>
      {navigation.menu}
    </section>
  );
}

const StructureDocument = memo(function StructureDocument({ context }: { context: DocumentContextValue }) {
  const root = context.graph.nodes.get(context.graph.rootNodeId);
  if (!root) return null;
  return (
    <DocumentContext.Provider value={context}>
      <div className="rune-structure-tools" role="toolbar" aria-label="Structure canvas">
        <button type="button" onClick={() => context.layouts.getState().reset()}>
          <LocateFixed className="size-3.5" aria-hidden="true" />
          Reset layout
        </button>
      </div>
      <div className="rune-structure-stage">
        <StructureCard key={context.graph.rootNodeId} node={root} ancestors={EMPTY_PATH} />
      </div>
    </DocumentContext.Provider>
  );
});

interface BlockLayout {
  x: number;
  y: number;
  widthPx?: number;
  placed?: boolean;
}
const DEFAULT_LAYOUT: BlockLayout = { x: 0, y: 0 };
function createBlockLayouts() {
  return createStore<{
    layouts: ReadonlyMap<string, BlockLayout>;
    update(id: string, value: BlockLayout): void;
    reset(): void;
  }>((set) => ({
    layouts: new Map(),
    update: (id, value) => set((state) => ({ layouts: new Map(state.layouts).set(id, value) })),
    reset: () => set({ layouts: new Map() })
  }));
}

function availableBlockWidth(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return element.offsetWidth;
  const style = getComputedStyle(parent);
  return Math.max(1, parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
}

function blockRect(element: HTMLElement): CanvasRect {
  return { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
}
function floatingCanvas(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('ol.rune-structure-members');
}
function floatingOrigin(element: HTMLElement, layout: BlockLayout): BlockLayout {
  const branch = element.classList.contains('rune-structure-member__child')
    ? element
    : element.closest<HTMLElement>('.rune-structure-member__child');
  return { ...layout, x: branch?.offsetLeft ?? layout.x, y: branch?.offsetTop ?? layout.y, placed: true };
}
function floatingChange(
  origin: BlockLayout,
  mode: 'move' | 'resize',
  dx: number,
  dy: number,
  width: number,
  available: number,
  element: HTMLElement
): BlockLayout {
  const branch = element.classList.contains('rune-structure-member__child')
    ? element
    : element.closest<HTMLElement>('.rune-structure-member__child');
  const canvas = floatingCanvas(element);
  const peers = Array.from(canvas?.querySelectorAll<HTMLElement>(':scope > li > .rune-structure-member__child') ?? [])
    .filter((peer) => peer !== branch)
    .map(blockRect);
  const previous = { x: origin.x, y: origin.y, width, height: branch?.offsetHeight ?? element.offsetHeight };
  const right = origin.x + width;
  const nextWidth = mode === 'resize' ? Math.max(Math.min(160, available), Math.min(right, width - dx)) : width;
  const desired = {
    ...previous,
    x: mode === 'resize' ? Math.max(0, right - nextWidth) : origin.x + dx,
    y: mode === 'move' ? origin.y + dy : origin.y,
    width: nextWidth
  };
  const placed = placeStructureBlock(desired, previous, peers, available, mode);
  return { ...origin, placed: true, x: placed.x, y: placed.y, ...(mode === 'resize' ? { widthPx: placed.width } : {}) };
}

/** User-authored placement only; browser layout still owns all descendant geometry. */
function useBlockLayout(id: string, constrained: boolean, frame: React.RefObject<HTMLElement | null>, split = false) {
  const { layouts } = useDocument();
  const layout = useStore(layouts, (state) => state.layouts.get(id) ?? DEFAULT_LAYOUT);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    mode: 'move' | 'resize';
    origin: BlockLayout;
    width: number;
    available: number;
  } | null>(null);
  const update = (value: BlockLayout) => layouts.getState().update(id, value);
  const start = (event: React.PointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    const element = frame.current;
    if (event.button !== 0 || !element) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode,
      origin: split ? floatingOrigin(element, layout) : layout,
      width: element.getBoundingClientRect().width,
      available: split
        ? (floatingCanvas(element)?.clientWidth ?? availableBlockWidth(element))
        : availableBlockWidth(element)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x,
      dy = event.clientY - active.y;
    if (split) {
      update({
        ...floatingChange(active.origin, active.mode, dx, dy, active.width, active.available, frame.current!)
      });
    } else {
      update({
        ...active.origin,
        x: constrained
          ? Math.max(0, Math.min(Math.max(0, active.available - 160), active.origin.x + dx))
          : active.origin.x + dx,
        y: constrained ? Math.max(0, active.origin.y + dy) : active.origin.y + dy
      });
    }
  };
  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: React.KeyboardEvent<HTMLElement>, mode: 'move' | 'resize') => {
    const step = event.shiftKey ? 32 : 8;
    const delta: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step }
    };
    if (event.key === 'Home') {
      event.preventDefault();
      update(DEFAULT_LAYOUT);
      return;
    }
    const offset = delta[event.key];
    if (!offset || (mode === 'resize' && offset.x === 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const element = frame.current;
    if (split && element) {
      const available = floatingCanvas(element)?.clientWidth ?? element.offsetWidth;
      update(
        floatingChange(
          floatingOrigin(element, layout),
          mode,
          offset.x,
          offset.y,
          element.getBoundingClientRect().width,
          available,
          element
        )
      );
    } else {
      const maxX = Math.max(0, (element ? availableBlockWidth(element) : 160) - 160);
      update({
        ...layout,
        x: constrained ? Math.max(0, Math.min(maxX, layout.x + offset.x)) : layout.x + offset.x,
        y: constrained ? Math.max(0, layout.y + offset.y) : layout.y + offset.y
      });
    }
  };
  return {
    layout,
    start,
    keyboard,
    pointerEvents: {
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: () => {
        drag.current = null;
      }
    }
  };
}

/** A focused DOM hierarchy with a single movable root. */
export function StructureView(props: StructureViewProps): React.ReactElement {
  const { focusedTypeId, adapterDoc, navigationRevision, unsupportedSelectedType } = props;
  const expansionMap = props.expansionMap ?? EMPTY_EXPANSIONS;
  const [layouts] = useState(createBlockLayouts);
  const graph = useMemo(
    () => (focusedTypeId && adapterDoc ? buildStructureGraph(adapterDoc, { focusedTypeId, expansionMap }) : undefined),
    [focusedTypeId, adapterDoc, expansionMap]
  );
  const { arrivalNodeId, emphasizeArrival, cancelArrival } = useNavigationArrival();
  const context = useMemo(
    () => (graph ? { ...props, graph, expansionMap, layouts, arrivalNodeId } : undefined),
    [
      graph,
      arrivalNodeId,
      expansionMap,
      layouts,
      props.focusedTypeId,
      props.cellComponents,
      props.onToggleExpansion,
      props.onNodeSelect,
      props.onNavigateToEnumType,
      props.onInspectType,
      props.structureDiagnostics,
      props.pendingHydrationNamespaces
    ]
  );
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusedTypeId && adapterDoc && navigationRevision !== undefined)
      emphasizeArrival(focusedTypeId, navigationRevision);
    return cancelArrival;
  }, [focusedTypeId, adapterDoc, navigationRevision, emphasizeArrival, cancelArrival]);
  useEffect(() => {
    host.current?.scrollTo?.({ top: 0, left: 0 });
  }, [focusedTypeId]);
  if (!focusedTypeId || !adapterDoc) {
    if (unsupportedSelectedType)
      return (
        <div data-testid="structure-unsupported-kind-state" className="rune-structure-empty">
          <p>
            <strong>{unsupportedSelectedType.name}</strong> is a <code>{unsupportedSelectedType.kind}</code> type and is
            not supported in Structure View.
          </p>
          <p>Pick a Data, Choice, or Enum type from the Namespace Explorer to see its structure.</p>
        </div>
      );
    return (
      <div data-testid="structure-empty-state" className="rune-structure-empty">
        Select a type from the Type explorer to view its structure.
      </div>
    );
  }
  if (!graph?.nodes.size)
    return (
      <div data-testid="structure-unsupported-root-state" className="rune-structure-empty">
        The selected type is no longer available. Select a type from the Namespace Explorer.
      </div>
    );
  return (
    <div
      ref={host}
      data-testid="structure-view-flow"
      className="rune-structure-document studio-scroll"
      data-canonical-id={focusedTypeId}
      role="region"
      aria-label="Type structure"
    >
      {context && <StructureDocument context={context} />}
    </div>
  );
}
