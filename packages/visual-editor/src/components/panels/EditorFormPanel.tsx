// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * EditorFormPanel — dispatch component that renders the appropriate editor
 * form based on the selected node's type kind.
 *
 * Renders:
 * - DataTypeForm / EnumForm / ChoiceForm / FunctionForm / TypeAliasForm
 *   for their respective kinds — in both editable and read-only mode
 *   (including refOnly curated reference entries, when the kind is covered).
 * - OtherForm for kinds without a dedicated form (record, basicType,
 *   annotation, default fallback), and as a stub-tolerant fallback for a
 *   deferred curated node whose on-demand hydration never completed
 *   (`meta.deferred` still true once `isHydrating` goes false) — those are
 *   the cases where refOnly/covered-kind status still falls back to it.
 * - Empty state when no node is selected.
 *
 * Read-only routing: covered kinds always render their own form (with zero
 * editable controls when locked or refOnly, same tabs/sections as editable).
 * OtherForm is used for kinds with no editor form implementation, and for
 * any still-`deferred` stub (whether mid-hydration or stuck after a failed
 * hydration attempt).
 *
 * Features:
 * - Scrollable content with sticky header (name + kind badge)
 * - role="complementary" with aria-label
 * - Escape key closes panel
 *
 * @module
 */

import { TypeHeaderActionsContext } from '../TypeHeader.js';
import { TypeReferenceImports } from '../editors/TypeLink.js';
import type { InspectorHostProps } from '../forms/metadata/useInspectorTargets.js';
import type { InspectorMetadataActions } from '../../store/metadata-target.js';

import { useEffect, useCallback, useRef, useMemo, Component, memo } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { DataTypeForm } from '../editors/DataTypeForm.js';
import { InspectorSectionRequestContext, type InspectorSectionRequest } from '../editors/inspector/InspectorFrame.js';
import { EnumForm } from '../editors/EnumForm.js';
import { ChoiceForm } from '../editors/ChoiceForm.js';
import { FunctionForm } from '../editors/FunctionForm.js';
import { TypeAliasForm } from '../editors/TypeAliasForm.js';
import { OtherForm } from './OtherForm.js';
import { useInheritedMembers } from '../../hooks/useInheritedMembers.js';
import type { NodeRepository } from '../../store/node-repository.js';
import type {
  GraphNodeMeta,
  AnyGraphNode,
  TypeOption,
  SourceRefOption,
  EditorFormActions,
  TypeGraphNode,
  ExpressionEditorSlotProps,
  FunctionBodyEditorSlotProps
} from '../../types.js';
import { resolveNodeKind } from '../../adapters/model-helpers.js';

/**
 * Fallback metadata for callers that render a node without supplying `meta`
 * (e.g. legacy tests). `node.data` no longer carries any flat metadata
 * (Phase 3 step 3), so there is nothing to derive it from — an empty,
 * editable meta is the neutral default.
 */
const FALLBACK_META: GraphNodeMeta = Object.freeze({
  namespace: '',
  errors: [],
  hasExternalRefs: false
});

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface FormErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class FormErrorBoundary extends Component<{ children: ReactNode; nodeId: string | null }, FormErrorBoundaryState> {
  constructor(props: { children: ReactNode; nodeId: string | null }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): FormErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[EditorFormPanel] Render error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: { nodeId: string | null }) {
    // Reset error state when a different node is selected
    if (prevProps.nodeId !== this.props.nodeId && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-4 gap-2 text-sm text-muted-foreground">
          <p className="font-medium text-destructive">Failed to render editor form</p>
          <p className="text-xs">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EditorFormPanelProps extends InspectorHostProps {
  sectionRequest?: InspectorSectionRequest;
  metadataActions?: InspectorMetadataActions;
  /** The selected node's data, or null if nothing is selected. */
  nodeData: AnyGraphNode | null;
  /**
   * UI/editor metadata for the selected node (namespace, isReadOnly,
   * errors, ...). Optional only because `nodeData` may be null (no
   * selection); whenever `nodeData` is non-null callers MUST supply the
   * node's `meta` sibling — `nodeData` carries no UI metadata anymore
   * (Phase 3 step 3). Absent meta falls back to an empty editable meta.
   */
  meta?: GraphNodeMeta;
  /** Node ID of the selected node. */
  nodeId: string | null;
  /** Whether the node is read-only (from external/locked source). */
  isReadOnly?: boolean;
  /**
   * True when the node's source file is a refOnly curated reference (no
   * client-side source text). Forces read-only rendering — through the
   * kind's own form when one exists, else OtherForm — and surfaces a
   * "Reference Only" pill in the header so the user understands why edits
   * are disabled.
   */
  refOnly?: boolean;
  /**
   * True while the selected node's namespace is a deferred curated
   * placeholder currently being hydrated on-demand (server round-trip in
   * flight — see docs/superpowers/specs/2026-05-25-curated-on-demand-hydration-design.md).
   * Renders a loading state instead of dispatching the placeholder's stub
   * data ({@link GraphNodeMeta.deferred}) into a form with no fields.
   */
  isHydrating?: boolean;
  /** Available type options for type selectors. */
  availableTypes: TypeOption[];
  /** Available synonym source options for the source-ref picker. */
  synonymSourceOptions?: SourceRefOption[];
  /** All editor form actions. */
  actions: EditorFormActions;
  /** All graph nodes (for inherited member resolution). */
  allNodes?: TypeGraphNode[];
  /** Repository for O(1) node-by-id lookup during inheritance chain resolution. */
  nodeRepository?: NodeRepository;
  /**
   * Optional render-prop for a rich expression editor in FunctionForm.
   * When omitted, FunctionForm renders a plain `<Textarea>` fallback.
   */
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
  renderFunctionBodyEditor?: (props: FunctionBodyEditorSlotProps) => ReactNode;
  structuralEditsDisabled?: boolean;
  compactConditions?: boolean;
  /** Host-owned actions rendered in the shared declaration title. */
  headerActions?: ReactNode;
  /** Called when the panel requests to close (e.g., Escape key). */
  onClose?: () => void;
  /** Called when a type reference is clicked to navigate to that type's definition. */
  onNavigateToNode?: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EMPTY_SYNONYM_SOURCE_OPTIONS: SourceRefOption[] = [];
const EMPTY_NODES: TypeGraphNode[] = [];

const EditorFormPanel = memo(function EditorFormPanel({
  nodeData,
  meta: metaProp,
  nodeId,
  isReadOnly = false,
  refOnly = false,
  isHydrating = false,
  availableTypes,
  synonymSourceOptions = EMPTY_SYNONYM_SOURCE_OPTIONS,
  actions,
  allNodes = EMPTY_NODES,
  nodeRepository,
  renderExpressionEditor,
  renderFunctionBodyEditor,
  structuralEditsDisabled = false,
  compactConditions,
  headerActions,
  onClose,
  onNavigateToNode,
  scopeKey,
  parseEpoch,
  saveStatus,
  registerCommitFlush,
  metadataActions,
  sectionRequest
}: EditorFormPanelProps) {
  const formActions = useMemo(
    () => (metadataActions ? { ...actions, ...metadataActions } : actions),
    [actions, metadataActions]
  );
  const hostProps = {
    scopeKey: scopeKey ? `${scopeKey}:${nodeId}` : (nodeId ?? undefined),
    parseEpoch,
    saveStatus,
    registerCommitFlush
  };

  // refOnly entries always force read-only — there's no source text to back
  // form edits — but still render through their kind's own form (with
  // fields disabled) rather than forking to the more limited OtherForm.
  const effectivelyReadOnly = isReadOnly || refOnly;
  const panelRef = useRef<HTMLElement>(null);

  // Effective node metadata: the meta prop when supplied, else the neutral
  // fallback (callers must pass the node.meta sibling for real nodes).
  const nodeMeta = metaProp ?? FALLBACK_META;

  const inheritedGroups = useInheritedMembers(nodeData, allNodes, 20, nodeRepository);

  // Derive allNodeIds for TypeLink resolution
  const allNodeIds = useMemo(() => allNodes.map((n) => n.id), [allNodes]);

  // ---- Escape key closes panel --------------------------------------------

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ---- Empty state ---------------------------------------------------------

  if (!nodeData || !nodeId) {
    return (
      <aside
        ref={panelRef}
        data-slot="editor-form-panel"
        aria-label="Editor form"
        className="flex items-center justify-center h-full text-sm text-muted-foreground"
        tabIndex={-1}
      >
        Select a node to edit
      </aside>
    );
  }

  // ---- Hydrating -> loading state -------------------------------------------
  // A deferred curated placeholder's `data` is a minimal stub ({$type, name}
  // only, see buildDeferredPlaceholderNodes) -- dispatching it into a real
  // form would render fields with nothing in them. Show a loading state
  // instead while the on-demand hydration round-trip is in flight.

  if (isHydrating) {
    return (
      <aside
        ref={panelRef}
        data-slot="editor-form-panel"
        aria-label="Loading namespace"
        className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted-foreground"
        tabIndex={-1}
      >
        <Spinner className="size-5" />
        <span>Loading {nodeMeta.namespace || 'namespace'}…</span>
      </aside>
    );
  }

  // ---- Stuck-deferred fallback ----------------------------------------------
  // `isHydrating` is only true while THIS namespace is actively mid-request
  // (see `selectedNodeIsHydrating` in ExplorePerspective.tsx, gated on
  // `pendingHydrationNamespaces`). If a hydration request for the namespace
  // fails, `dequeuePendingHydration` removes it from that pending list
  // WITHOUT clearing `meta.deferred` or replacing the stub `data` — so
  // `isHydrating` flips back to false while `nodeData` is still just
  // `{$type, name}`. Dispatching that stub into a covered kind's rich form
  // (DataTypeForm, EnumForm, ...) below would render empty/misleading
  // tabs and sections as if the type genuinely has no members. Fall back to
  // OtherForm — the same stub-tolerant view refOnly nodes rendered through
  // before this routing was broadened — until a fresh hydration attempt
  // (re-selecting/re-expanding the namespace) replaces the stub with real
  // data (Codex review, PR #494).

  if (nodeMeta.deferred) {
    return (
      <aside
        ref={panelRef}
        data-slot="editor-form-panel"
        aria-label={`Details for ${(nodeData as any).name}`}
        className="flex flex-col h-full overflow-hidden"
        tabIndex={-1}
      >
        <OtherForm
          nodeData={nodeData}
          meta={nodeMeta}
          nodeId={nodeId}
          onNavigateToNode={onNavigateToNode}
          allNodeIds={allNodeIds}
          refOnly={refOnly}
        />
      </aside>
    );
  }

  // ---- Dispatch by $type → kind --------------------------------------------
  // Covered kinds (data/enum/choice/func/typeAlias) render their own form —
  // read-only (fields disabled, same tabs/sections as the editable case) when
  // locked OR refOnly, rather than forking to the much more limited OtherForm.
  // OtherForm is reserved for kinds with no editor form implementation at all
  // (record/basicType/annotation/default), or a stuck-deferred stub above —
  // those have nowhere else to go regardless of refOnly/readOnly status.

  const kind = resolveNodeKind(nodeData);
  // Combined lock: panel-prop lock (isReadOnly/refOnly) OR node-data flag.
  const readOnly = effectivelyReadOnly || Boolean(nodeMeta?.isReadOnly);
  // Panel aria-label tracks which component actually renders, not
  // readOnly-ness — a covered kind is always "Edit X" (fields merely
  // disabled when read-only/refOnly), matching its own dedicated form;
  // only an uncovered kind's OtherForm render is "Details for X".
  const hasEditableForm =
    kind === 'data' || kind === 'enum' || kind === 'choice' || kind === 'func' || kind === 'typeAlias';

  function renderForm() {
    switch (kind) {
      case 'data':
        return (
          <DataTypeForm
            key={scopeKey ? `${scopeKey}:${nodeId}` : nodeId}
            {...hostProps}
            nodeId={nodeId!}
            data={nodeData!}
            meta={nodeMeta}
            availableTypes={availableTypes}
            synonymSourceOptions={synonymSourceOptions}
            actions={formActions}
            allNodes={allNodes}
            renderExpressionEditor={renderExpressionEditor}
            compactConditions={compactConditions}
            structuralEditsDisabled={structuralEditsDisabled}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            readOnly={readOnly}
            refOnly={refOnly}
          />
        );

      case 'enum':
        return (
          <EnumForm
            key={scopeKey ? `${scopeKey}:${nodeId}` : nodeId}
            {...hostProps}
            nodeId={nodeId!}
            data={nodeData!}
            meta={nodeMeta}
            availableTypes={availableTypes}
            synonymSourceOptions={synonymSourceOptions}
            actions={formActions}
            allNodes={allNodes}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            readOnly={readOnly}
            refOnly={refOnly}
          />
        );

      case 'choice':
        return (
          <ChoiceForm
            allNodes={allNodes}
            key={scopeKey ? `${scopeKey}:${nodeId}` : nodeId}
            {...hostProps}
            nodeId={nodeId!}
            data={nodeData!}
            meta={nodeMeta}
            availableTypes={availableTypes}
            synonymSourceOptions={synonymSourceOptions}
            actions={formActions}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            readOnly={readOnly}
            refOnly={refOnly}
          />
        );

      case 'func':
        return (
          <FunctionForm
            synonymSourceOptions={synonymSourceOptions}
            allNodes={allNodes}
            key={scopeKey ? `${scopeKey}:${nodeId}` : nodeId}
            {...hostProps}
            nodeId={nodeId!}
            data={nodeData!}
            meta={nodeMeta}
            availableTypes={availableTypes}
            actions={formActions}
            inheritedGroups={inheritedGroups}
            renderExpressionEditor={renderExpressionEditor}
            renderFunctionBodyEditor={renderFunctionBodyEditor}
            structuralEditsDisabled={structuralEditsDisabled}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            readOnly={readOnly}
            refOnly={refOnly}
          />
        );

      case 'typeAlias':
        return (
          <TypeAliasForm
            key={scopeKey ? `${scopeKey}:${nodeId}` : nodeId}
            {...hostProps}
            nodeId={nodeId!}
            data={nodeData!}
            meta={nodeMeta}
            availableTypes={availableTypes}
            actions={formActions}
            renderExpressionEditor={renderExpressionEditor}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            readOnly={readOnly}
            refOnly={refOnly}
          />
        );

      // record, basicType, and annotation have no editor form implementation
      // at all — OtherForm is the only rendering regardless of refOnly status.
      case 'record':
      case 'basicType':
      case 'annotation':
        return (
          <OtherForm
            nodeData={nodeData}
            meta={nodeMeta}
            nodeId={nodeId}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            refOnly={refOnly}
          />
        );

      default:
        return (
          <OtherForm
            nodeData={nodeData}
            meta={nodeMeta}
            nodeId={nodeId}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            refOnly={refOnly}
          />
        );
    }
  }

  return (
    <aside
      ref={panelRef}
      data-slot="editor-form-panel"
      aria-label={hasEditableForm ? `Edit ${(nodeData as any).name}` : `Details for ${(nodeData as any).name}`}
      className="flex flex-col h-full overflow-hidden"
      tabIndex={-1}
    >
      <div data-slot="panel-content" className="studio-scroll flex-1 overflow-y-auto">
        <TypeReferenceImports.Provider value={nodeMeta.imports}>
          <InspectorSectionRequestContext.Provider
            value={sectionRequest?.nodeId === nodeId ? sectionRequest : undefined}
          >
            <TypeHeaderActionsContext.Provider value={headerActions}>
              <FormErrorBoundary nodeId={nodeId}>{renderForm()}</FormErrorBoundary>
            </TypeHeaderActionsContext.Provider>
          </InspectorSectionRequestContext.Provider>
        </TypeReferenceImports.Provider>
      </div>
    </aside>
  );
});

export { EditorFormPanel };
