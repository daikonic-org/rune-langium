// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * ExplorePerspective — the Explore-perspective workbench content, rendered by
 * PerspectiveHost in its keep-alive `explore` slot. Formerly `EditorPage`; the
 * outer app shell (ActivityBar + PerspectiveHost) now lives in App, so this
 * component renders only the studio topbar + the `DockShell` workbench.
 *
 * Owns editor state (selected node, opened files, navigation history,
 * store wiring) and provides custom dockview panels that render the
 * existing studio components:
 *
 *   workspace.fileTree     ← NamespaceExplorerPanel
 *   workspace.editor       ← SourceEditor
 *   workspace.inspector    ← EditorFormPanel + ExpressionBuilder
 *   workspace.problems     ← DiagnosticsPanel
 *   workspace.output       ← (default stub for now; output stream wires later)
 *   workspace.visualPreview ← RuneTypeGraph
 *
 * Replaces the previous fixed two-panel resizable layout. Workspace-level
 * actions live in a compact studio header, while graph-specific controls
 * now live inside the graph panel itself. The diagnostics drawer +
 * explorer sidebar merge into the dockable shell, reducing chrome (T091).
 */

import { useRef, useCallback, useState, useMemo, useEffect, type KeyboardEvent } from 'react';
import {
  RuneTypeGraph,
  NamespaceExplorerPanel,
  EditorFormPanel,
  ExpressionBuilder,
  expressionScopeFromEntries,
  StructureView,
  NameCell,
  CardinalityCell,
  TypePickerCell,
  AST_TYPE_TO_NODE_TYPE,
  buildTypeOptions,
  annotationsToDisplay,
  conditionsToDisplay,
  useEditorStore,
  useModelSourceSync,
  createEditorCommitRegistry,
  useLatestRef,
  makeNodeId,
  nameFromNodeId,
  isTypeNodeId,
  qualifiedNameFromNodeId,
  splitNodeId,
  selectNodeRepository
} from '@rune-langium/visual-editor';
import type {
  RuneTypeGraphRef,
  AnyGraphNode,
  GraphNodeMeta,
  TypeOption,
  SourceRefOption,
  EditorFormActions,
  ExpressionEditorSlotProps,
  FunctionScope,
  FunctionBodyEditorSlotProps,
  LayoutDirection,
  AdapterChoiceOption,
  AdapterDocument,
  AdapterNode,
  RangeDiagnostic
} from '@rune-langium/visual-editor';
import { useStructureViewStore } from '../store/structure-view-store.js';
import type { WorkspaceFile } from '../services/workspace.js';
import type { RosettaModel } from '@rune-langium/core';
import { getNodeSourceRegion, namespaceFromModelName, RuneDslTerminals } from '@rune-langium/core';
import { createScopedMetadataActions } from './inspector-metadata-actions.js';
import { SourceEditor } from '../components/SourceEditor.js';
import { ExpressionWorkspace } from '../components/editing/ExpressionWorkspace.js';
import { ExpressionDocument } from '../services/expression-document.js';
import { buildExpressionOwnerFiles } from './expression-owner-files.js';
import type { SourceEditorRef } from '../components/SourceEditor.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';
import { LspConnectionBadge } from '../components/LspConnectionBadge.js';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel.js';
import { ExportDialog } from '../components/ExportDialog.js';
import { ImportDialog } from '../components/ImportDialog.js';
import { ModelLoader } from '../components/ModelLoader.js';
import { JsonSchemaImportOptionsFormAdapter } from '../codegen-forms/JsonSchemaImportOptionsFormAdapter.js';
import { OpenApiImportOptionsFormAdapter } from '../codegen-forms/OpenApiImportOptionsFormAdapter.js';
import { SqlImportOptionsFormAdapter } from '../codegen-forms/SqlImportOptionsFormAdapter.js';
import { XsdImportOptionsFormAdapter } from '../codegen-forms/XsdImportOptionsFormAdapter.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { Separator } from '@rune-langium/design-system/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { Maximize2, LayoutGrid, Network } from 'lucide-react';
import { useStudioToast } from '../components/StudioToastProvider.js';
import { DockShell } from './DockShell.js';
import { isUserWorkspaceFile, linkDocument, requestExpressionScope } from '../services/workspace.js';
import { useLspDiagnosticsBridge } from '../hooks/useLspDiagnosticsBridge.js';
import { useDiagnosticsStore } from '../store/diagnostics-store.js';
import { CodePreviewPanel } from '../components/CodePreviewPanel.js';
import type { SourceEditorHandle } from '../components/CodePreviewPanel.js';
import { subscribeToEngine } from '../services/git-sync.js';
import { usePreviewStore, type FormPreviewTarget } from '../store/preview-store.js';
import { FormPreviewPanel as FormPreviewPanelShell } from './panels/FormPreviewPanel.js';
import { emphasizeNavigationArrival } from '../utils/navigation-arrival.js';
import { SourceNavigationFeedbackContext } from './source-navigation-feedback-context.js';
import { CenterStackPanel } from './panels/CenterStackPanel.js';
import '../test-api.js';
import { useWorkspace } from './providers/workspace-context.js';
import { useLsp } from './providers/lsp-context.js';
import { useWorkspaceActions } from './perspectives/workspace-actions-context.js';
import type { DeferredExportEntry } from '../workers/parser-worker.js';
import { pathToUri } from '../utils/uri.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import { combineFileDiagnostics, countDiagnostics } from './explore-diagnostics.js';
import {
  resolveEditorFilePath,
  resolveHydratedSourcePath,
  useExploreFileNavStore,
  type HydratedSourceRequest
} from './explore-file-nav-store.js';
import { useExportDialogStore } from './export-dialog-store.js';
import { useImportDialogStore } from './import-dialog-store.js';
import { HydrationOrchestrator } from '../services/hydration-orchestrator.js';
import { useExploreNavigationStore } from '../services/explore-navigation.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

/**
 * Stable identity used as the default for the optional `deferredExports`
 * prop. An inline `= []` default creates a fresh array on every render,
 * which made the workspace-load effect's dependency list change every
 * render and triggered an unconditional `loadModels` → re-render loop
 * (Codex P2 review on PR #164). A module-level constant keeps the
 * reference stable so `useEffect`'s shallow-equality dep check works.
 */
const EMPTY_DEFERRED_EXPORTS: DeferredExportEntry[] = Object.freeze(
  [] as DeferredExportEntry[]
) as DeferredExportEntry[];
const EMPTY_PARSE_ERRORS: ReadonlyMap<string, string[]> = new Map();

/**
 * Stable empty diagnostics array — stable module-level reference so that
 * renderStructurePane's useMemo dep check doesn't false-positive when
 * there are no diagnostics for the focused file.
 */
const EMPTY_RANGE_DIAGNOSTICS: readonly RangeDiagnostic[] = Object.freeze([]);

const IMPORT_OPTIONS_FORMS_BY_FORMAT = {
  'json-schema': JsonSchemaImportOptionsFormAdapter,
  openapi: OpenApiImportOptionsFormAdapter,
  sql: SqlImportOptionsFormAdapter,
  xsd: XsdImportOptionsFormAdapter
} as const;

// normalizeDiagnosticFilePath / toParserDiagnostics / countDiagnostics moved to
// explore-diagnostics.ts (shared-perspective-chrome plan, Task 3 prep) so the
// future ExploreCenterSlot component can recompute the same combined
// diagnostics this component's footer uses, without a duplicate copy.

// ---------------------------------------------------------------------------
// Adapter: TypeGraphNode[] → AdapterDocument
// ---------------------------------------------------------------------------

/**
 * Project the editor store's node array into the AdapterDocument shape.
 *
 * Projects `Data`, `Choice`, `Enum`, `Record`, `TypeAlias`, and `Function`
 * nodes. `superType.$refText` maps to `extends`; Data `attributes` carry
 * through to `AdapterAttribute` directly since their fields match. Choice arms
 * are mapped to the `choiceOptions` field on `AdapterNode`, preserving the real
 * `ChoiceOption` AST shape (only `typeCall`, no synthesized `name` or `card`).
 * Record / TypeAlias project as bare reference targets (name + namespace only);
 * Function projects its `inputs` + `output` (Attribute-shaped) plus Phase-A
 * metadata.
 *
 * This is a **pure projection** — no side-effects, safe to call inside useMemo.
 */
/**
 * Phase A — project a store node's raw AST metadata (documentation,
 * annotations, conditions) into the display-shaped fields the adapter and
 * Structure View node header read. Reuses the shared `annotationsToDisplay` /
 * `conditionsToDisplay` helpers so expression previews are not hand-rolled.
 *
 * Defensive: fallback / curated-hydration nodes may omit any of these fields,
 * so each access tolerates `undefined` and the helpers return empty arrays.
 * Empty results collapse to `undefined` so the indicators render nothing.
 */
function projectStructureMeta(d: {
  definition?: string;
  annotations?: readonly unknown[];
  conditions?: readonly unknown[];
  /**
   * Functions carry `postConditions` as a SEPARATE array from `conditions`
   * (Phase C / PR #307 finding #2). When present they are forwarded to
   * `conditionsToDisplay`'s dedicated `postConditions` param so they surface in
   * the condition indicator (tagged `isPostCondition`) instead of being
   * dropped. Data/Choice nodes omit this field, so it's optional.
   */
  postConditions?: readonly unknown[];
}): {
  definition?: string;
  annotations?: readonly string[];
  conditions?: readonly { name: string; preview: string }[];
} {
  const definition = typeof d.definition === 'string' && d.definition.trim() ? d.definition : undefined;

  const annotationInfos = annotationsToDisplay(d.annotations as never);
  const annotations = annotationInfos.length
    ? annotationInfos.map((a) => (a.attribute ? `${a.name}.${a.attribute}` : a.name))
    : undefined;

  // Pass conditions + postConditions through the shared helper; functions
  // surface BOTH (postConditions tagged isPostCondition), Data/Choice only the
  // former (postConditions undefined).
  const conditionInfos = conditionsToDisplay(d.conditions as never, d.postConditions as never);
  const conditions = conditionInfos.length
    ? conditionInfos.map((c) => ({ name: c.name ?? '', preview: c.expressionText }))
    : undefined;

  return { definition, annotations, conditions };
}

function graphNodesToAdapterDocument(
  nodes: readonly { id: string; data: AnyGraphNode; meta: GraphNodeMeta }[]
): AdapterDocument {
  const adapterNodes: AdapterNode[] = [];
  const namespacesSet = new Set<string>();

  for (const rfNode of nodes) {
    const d = rfNode.data;
    const namespace = rfNode.meta?.namespace;
    if (!d || typeof namespace !== 'string') continue;
    namespacesSet.add(namespace);

    // `$type` is guaranteed on every node since the typeKind→$type unification
    // (Phase 2 curated-serializer fix): curated /api/parse round-trips and
    // deferred-export placeholders now stamp `$type`, so the former
    // typeKind/node.type fallback chain here is retired (Phase 3 prep).
    const effectiveType: string | undefined = d.$type;

    // Copilot review (e2e-batch confirmation pass): the previous
    // `Extract<AnyGraphNode, { $type: 'Data' }>` casts asserted nodes
    // belong to the $type-discriminated union — which is exactly what
    // fallback nodes (the ones that took this path because `$type` was
    // MISSING) violate. The asserts happened to work at runtime because
    // only structural fields get read, but the type system was being
    // lied to. Use shape-of-what-we-read structural types instead so
    // (a) TS surfaces a real error if the read shape ever drifts and
    // (b) we're not pretending fallback nodes have a $type field.
    if (effectiveType === 'Data') {
      const dd = d as {
        name: string;
        superType?: { $refText?: string };
        attributes?: readonly unknown[];
        definition?: string;
        annotations?: readonly unknown[];
        conditions?: readonly unknown[];
      };
      adapterNodes.push({
        id: rfNode.id,
        $type: 'Data',
        name: dd.name,
        namespace,
        deferred: rfNode.meta?.deferred,
        extends: dd.superType?.$refText,
        // `attributes` on Dehydrated<Data> has the same structural shape as
        // AdapterAttribute: { name, typeCall: { type?: { $refText? } }, card: { inf, sup?, unbounded } }
        attributes: (dd.attributes ?? []) as AdapterNode['attributes'],
        // Phase A — type metadata (doc / annotations / conditions). Reuses the
        // shared display helpers; empty results collapse to undefined.
        ...projectStructureMeta(dd)
      });
    } else if (effectiveType === 'Choice') {
      // ChoiceOption AST shape: { $type, typeCall, … } — NO `name`, NO `card`.
      // Pass through to the new `choiceOptions` field on AdapterNode unchanged.
      // The adapter's buildChoiceArm consumes the real shape via typeCall only.
      const dc = d as {
        name: string;
        attributes?: readonly unknown[];
        definition?: string;
        annotations?: readonly unknown[];
        conditions?: readonly unknown[];
      };
      adapterNodes.push({
        id: rfNode.id,
        $type: 'Choice',
        name: dc.name,
        namespace,
        deferred: rfNode.meta?.deferred,
        choiceOptions: (dc.attributes ?? []) as ReadonlyArray<AdapterChoiceOption>,
        // Phase A — type metadata. Choice declarations carry doc + annotations
        // (and may carry conditions in the grammar); project all via the shared
        // helper for symmetry with Data. Empty results collapse to undefined.
        ...projectStructureMeta(dc)
      });
    } else if (effectiveType === 'RosettaEnumeration') {
      const de = d as { name: string; enumValues?: readonly unknown[] };
      adapterNodes.push({
        id: rfNode.id,
        $type: 'Enum',
        name: de.name,
        namespace,
        deferred: rfNode.meta?.deferred,
        values: (de.enumValues ?? []) as Array<{ name: string }>
      });
    } else if (effectiveType === 'RosettaRecordType') {
      const dr = d as { name: string };
      adapterNodes.push({ id: rfNode.id, $type: 'Record', name: dr.name, namespace });
    } else if (effectiveType === 'TypeAlias' || effectiveType === 'RosettaTypeAlias') {
      const ta = d as { name: string };
      adapterNodes.push({ id: rfNode.id, $type: 'TypeAlias', name: ta.name, namespace });
    } else if (effectiveType === 'RosettaFunction') {
      // Phase C — Function structure node. `inputs` and `output` are
      // Attribute-shaped (name + typeCall + card), identical to Data
      // `attributes`, so they pass through to AdapterNode unchanged and the
      // adapter's buildRow consumes them. Defensive against missing fields:
      // partial-parse / hydration func nodes may omit inputs or output.
      const df = d as {
        name: string;
        inputs?: readonly unknown[];
        output?: unknown;
        definition?: string;
        annotations?: readonly unknown[];
        conditions?: readonly unknown[];
        postConditions?: readonly unknown[];
      };
      adapterNodes.push({
        id: rfNode.id,
        $type: 'Function',
        name: df.name,
        namespace,
        deferred: rfNode.meta?.deferred,
        inputs: (df.inputs ?? []) as AdapterNode['inputs'],
        output: df.output ?? null,
        // Phase A — type metadata (doc / annotations / conditions). Functions
        // carry BOTH `conditions` and `postConditions`; projectStructureMeta
        // forwards postConditions to conditionsToDisplay so they surface in the
        // condition indicator instead of being dropped (PR #307 finding #2).
        // Empty results collapse to undefined.
        ...projectStructureMeta(df)
      });
    }
    // Record and TypeAlias projected above; Function projected here.
  }

  const namespaces = Array.from(namespacesSet).map((uri) => ({ uri }));
  return { namespaces, nodes: adapterNodes };
}

/**
 * EditorPage now sources every former prop from context — workspace data from
 * {@link useWorkspace}, LSP handles from {@link useLsp}, and workspace actions
 * from {@link useWorkspaceActions} (all supplied by StudioProviders). It takes
 * no props; the studio build version stays a module constant.
 */
const STUDIO_VERSION = '0.1.0';

const DECLARATION_NAME =
  /^(?:type|enum|func|choice|annotation|metaType|typeAlias|basicType|recordType|library\s+function|reporting\s+rule)\s+\^?(\w+)/;

const SOURCE_NON_CODE = new RegExp(
  [RuneDslTerminals.STRING, RuneDslTerminals.ML_COMMENT, RuneDslTerminals.SL_COMMENT]
    .map((pattern) => pattern.source)
    .join('|'),
  'g'
);

type SourceRevealRequest = {
  nodeId: string;
  workspaceId: string | undefined;
  filePath?: string;
  cancelled?: boolean;
  editRekey?: boolean;
};

function findDeclarationLine(
  content: string,
  node: Parameters<typeof getNodeSourceRegion>[0] & { name?: string },
  coordinatesCurrent: boolean
): number | undefined {
  if (!content) return undefined;
  if (coordinatesCurrent) {
    try {
      const { from, to } = getNodeSourceRegion(node);
      if (to <= content.length) return content.slice(0, from).split('\n').length;
    } catch {
      // Deferred declarations have only an identity until their AST is hydrated.
    }
  }
  if (!node.name) return undefined;
  const code = content.replace(SOURCE_NON_CODE, (text) => text.replace(/[^\r\n]/g, ' '));
  const matches = code
    .split('\n')
    .flatMap((line, index) => (DECLARATION_NAME.exec(line.trimStart())?.[1] === node.name ? [index + 1] : []));
  // Same-name declarations of different kinds require hydrated coordinates.
  return matches.length === 1 ? matches[0] : undefined;
}

function matchesPreviewSourceIdentity(current: FormPreviewTarget, candidate: FormPreviewTarget): boolean {
  if (!current.sourceUri || current.sourceUri !== candidate.sourceUri || current.kind !== candidate.kind) {
    return false;
  }
  if (current.sourceIndex !== undefined && candidate.sourceIndex !== undefined) {
    return current.sourceIndex === candidate.sourceIndex;
  }
  return (
    current.sourceRange?.start.line === candidate.sourceRange?.start.line &&
    current.sourceRange?.start.character === candidate.sourceRange?.start.character
  );
}

/**
 * Render an unmapped Langium `$type` as a human-friendly kind label.
 * Strips the `Rosetta` prefix and inserts spaces before interior capital
 * letters, then lowercases the tail so the result reads as sentence case
 * (`RosettaTypeAlias` → `Type alias`, `RosettaExternalRuleSource` →
 * `External rule source`). Used as the fallback in
 * `structureUnsupportedSelectedType`'s KIND_LABEL map so any newly-added
 * Rosetta AST node type produces a passable label without code change.
 */
function formatUnknownKind(rawType: string): string {
  const stripped = rawType.startsWith('Rosetta') ? rawType.slice('Rosetta'.length) : rawType;
  // Insert a space before each interior capital, then lowercase everything
  // except the first character.
  const spaced = stripped.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0) + spaced.slice(1).toLowerCase();
}

function resolveResponsiveLayoutDirection(
  width: number,
  height: number,
  previous: Extract<LayoutDirection, 'LR' | 'TB'>
): Extract<LayoutDirection, 'LR' | 'TB'> {
  if (width <= 0 || height <= 0) return previous;
  if (width > height) return 'LR';
  if (height > width) return 'TB';
  return previous;
}

// getFileKindBadge / countFileDiagnostics / FileTabStrip moved verbatim to
// perspectives/explore-chrome.tsx (ExploreCenterSlot) — shared-perspective-
// chrome plan, Task 3.

export const ExplorePerspective = withInstrumentation(
  function ExplorePerspective() {
    // Workspace model data — formerly props, now from WorkspaceProvider.
    const workspace = useWorkspace();
    const { models, parsedModels, files } = workspace;
    const deferredExports: DeferredExportEntry[] = workspace.deferredExports ?? EMPTY_DEFERRED_EXPORTS;
    const parseErrors = workspace.parseErrors ?? EMPTY_PARSE_ERRORS;
    const workspaceId = workspace.workspaceId ?? 'default';
    const workspaceKind = workspace.workspaceKind;
    const fileCount = workspace.fileCount;
    const studioVersion = STUDIO_VERSION;

    // LSP handles — formerly props, now from LspProvider.
    const { lspClient: lspClientValue, transportState, reconnect } = useLsp();
    const lspClient = lspClientValue ?? undefined;
    // `lspClient`'s object identity never changes across its connect
    // lifecycle (LspProvider reuses one instance) — `transportState.status`
    // is the reactive signal SourceEditor needs to late-bind the LSP plugin
    // (diagnostics/hover/completion/go-to-definition) once connected.
    const lspReady = transportState?.status === 'connected';
    const onReconnect = reconnect;

    // Workspace actions — formerly props, now from the actions context.
    // onClose/onSwitchWorkspace/onCreateWorkspace moved to AppHeader's
    // WorkspaceSwitcherTrigger (shared-perspective-chrome plan, Task 3).
    const { onFilesChange, loadCuratedSource, registerEditorSaveBarrier } = useWorkspaceActions();
    const inspectorScope = `${workspaceId}:${workspace.workspaceEpoch ?? 0}`;
    const formCommitRegistry = useMemo(createEditorCommitRegistry, []);

    const graphRef = useRef<RuneTypeGraphRef>(null);
    const graphContainerRef = useRef<HTMLDivElement>(null);
    const sourceEditorRef = useRef<SourceEditorRef>(null);
    const [pendingFileArrival, setPendingFileArrival] = useState<{
      filePath: string;
      workspaceId: string | undefined;
      fileOnly?: boolean;
    } | null>(null);
    const [completedFileArrival, setCompletedFileArrival] = useState<{
      filePath: string;
      workspaceId: string | undefined;
    } | null>(null);
    const pendingFileArrivalRef = useLatestRef(pendingFileArrival);
    const sourcePaneRef = useRef<HTMLDivElement>(null);
    const inspectorArrivalRevisionRef = useRef<number | undefined>(undefined);
    const inspectorArrivalRef = useRef<HTMLDivElement>(null);
    const [loadingSourcePaths, setLoadingSourcePaths] = useState<Set<string>>(() => new Set());
    const sourceLoadTokensRef = useRef(new Map<string, object>());
    const pendingSourceRequestsRef = useRef(new Map<string, object>());
    const pendingSourceNavigationRef = useRef<
      (HydratedSourceRequest & { workspaceId: string; revision: number }) | null
    >(null);
    const [sourceLoadError, setSourceLoadError] = useState<{ path: string; message: string } | null>(null);
    useEffect(() => {
      sourceLoadTokensRef.current.clear();
      pendingSourceRequestsRef.current.clear();
      pendingSourceNavigationRef.current = null;
      setLoadingSourcePaths(new Set());
      setSourceLoadError(null);
      return () => {
        sourceLoadTokensRef.current.clear();
      };
    }, [workspaceId]);
    // Export dialog open-state is shared with the header's Export code/Generate
    // buttons (moving into ExploreActions in Task 3) — lifted to a store rather
    // than local useState (export-dialog-store.ts; shared-perspective-chrome
    // plan, Task 3 hazard #2).
    const showExportDialog = useExportDialogStore((s) => s.open);
    const setShowExportDialog = useExportDialogStore((s) => s.setOpen);
    const showImportDialog = useImportDialogStore((s) => s.open);
    const setShowImportDialog = useImportDialogStore((s) => s.setOpen);
    const setExploreNavigateToType = useExploreNavigationStore((s) => s.setNavigateToType);
    // Curated Models modal — wired from the ActivityBar's Database button.
    // The Welcome screen renders <ModelLoader /> inline; inside EditorPage we
    // reuse the same component in a Dialog so the affordance stays discoverable
    // once a workspace is open. A richer bottom-bar multi-selector is deferred
    // to a future task; the modal is the minimal landing.
    const [showCuratedModels, setShowCuratedModels] = useState(false);
    // Topbar workspace dropdown state moved to AppHeader's WorkspaceSwitcherTrigger
    // (shared-perspective-chrome plan, Task 3).
    const [groupedLayout, setGroupedLayout] = useState(false);
    const [graphLayoutDirection, setGraphLayoutDirection] = useState<Extract<LayoutDirection, 'LR' | 'TB'>>('LR');
    // Ref so ResizeObserver callbacks always see the latest value without stale closures.
    const groupedLayoutRef = useLatestRef(groupedLayout);
    const graphLayoutDirectionRef = useRef<Extract<LayoutDirection, 'LR' | 'TB'>>('LR');
    const focusMode = useEditorStore((s) => s.focusMode);
    const storeToggleFocusMode = useEditorStore((s) => s.toggleFocusMode);
    // Active file + git-sync status are shared with the header's FileTabStrip
    // (moving into ExploreCenterSlot in Task 3) — lifted to a store rather than
    // local useState (explore-file-nav-store.ts; shared-perspective-chrome
    // plan, Task 3 hazard #3).
    const activeEditorFile = useExploreFileNavStore((s) => s.activeEditorFile);
    const setActiveEditorFile = useExploreFileNavStore((s) => s.setActiveEditorFile);
    const storeOpenFileInSource = useExploreFileNavStore((s) => s.openFileInSource);
    const requestSourceFile = useExploreFileNavStore((s) => s.requestSourceFile);
    const [inspectorFocusNonce, setInspectorFocusNonce] = useState(0);
    const pendingRevealRef = useRef<SourceRevealRequest | null>(null);
    const navigationSequenceRef = useRef(0);
    const [navigationTarget, setNavigationTarget] = useState<{
      nodeId: string;
      revision: number;
      workspaceId: string | undefined;
      origin?: 'source';
    } | null>(null);
    const requestNavigationArrival = useCallback(
      (nodeId: string, origin?: 'source') => {
        setNavigationTarget({ nodeId, revision: ++navigationSequenceRef.current, workspaceId, origin });
      },
      [workspaceId]
    );
    const sourceRevealIntentRef = useRef<SourceRevealRequest | null>(null);
    const [sourceNavigationPending, setSourceNavigationPending] = useState<SourceRevealRequest | null>(null);
    const linkDocumentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Accumulates corpus models returned by linkDocument so they can be merged into
    // the graph. Reset when a new workspace is loaded.
    const corpusModelsRef = useRef<RosettaModel[]>([]);
    const workspaceIdRef = useRef(workspaceId);
    const modelsRef = useRef(models);
    const navigationHistoryRef = useRef<string[]>([]);
    // Forward stack for navigateForward — mirrors navigationHistoryRef.
    // Both are refs (not state) since node visits can be frequent and the
    // stack contents themselves never need to trigger a re-render; only the
    // empty/non-empty boundary matters for the toolbar buttons, tracked
    // separately below as reactive canGoBack/canGoForward.
    const navigationForwardRef = useRef<string[]>([]);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);
    // Set right before navigateBack/navigateForward call storeSelectNode, so
    // the selectedNodeId subscription below (the single choke point for
    // ALL selection changes — Explorer clicks, Structure/Graph selection,
    // cross-reference navigation, and anything else that reaches
    // useEditorStore's selectNode, including paths internal to
    // packages/visual-editor this file has no callback hook into) can tell
    // "this change IS a history navigation, don't re-record it" apart from
    // every other selection change, which DOES need a fresh history entry.
    const isHistoryNavigationRef = useRef(false);
    const { showToast } = useStudioToast();
    const pendingDisplayFileRef = useRef<Map<string, (view: import('@codemirror/view').EditorView | null) => void>>(
      new Map()
    );
    const displayFileTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    // Git sync status — only meaningful for git-backed workspaces. The value
    // is read by AppHeader's SyncStatusBadge (via the same store); this
    // component only owns the subscription that keeps it fresh.
    // Uses subscribeToEngine so the subscription survives async engine creation:
    // the badge will receive state even if the engine is created after this effect
    // runs (which is the common case on first boot).
    const setSyncStatus = useExploreFileNavStore((s) => s.setSyncStatus);
    useEffect(() => {
      if (workspaceKind !== 'git-backed') return;
      // Reset to null immediately on workspace switch so the badge never shows
      // the previous workspace's status while the new engine initialises.
      setSyncStatus(null);
      return subscribeToEngine(workspaceId, setSyncStatus);
    }, [workspaceId, workspaceKind, setSyncStatus]);

    const storeNodes = useEditorStore((s) => s.nodes);
    const storeNodesById = useEditorStore((s) => s.nodesById);
    const nodeRepository = selectNodeRepository(storeNodesById);
    const storeEdges = useEditorStore((s) => s.edges);
    // parseEpoch gates source serialization: only USER edits (not parse-driven
    // graph rebuilds) get written back to source — see useModelSourceSync.
    const storeParseEpoch = useEditorStore((s) => s.parseEpoch);
    const storePendingEditPatches = useEditorStore((s) => s.pendingEditPatches);
    const storePendingInversePatches = useEditorStore((s) => s.pendingInversePatches);
    const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
    const selectionRekey = useEditorStore((s) => s.selectionRekey);
    const isEditRekey = selectionRekey?.to === selectedNodeId;
    const visibility = useEditorStore((s) => s.visibility);
    const visibleGraphCount = useEditorStore((s) => s.getVisibleNodes().length);
    const expandedNamespaces = visibility.expandedNamespaces;
    const hiddenNodeIds = visibility.hiddenNodeIds;

    const storeSelectNode = useEditorStore((s) => s.selectNode);
    const storeToggleNamespace = useEditorStore((s) => s.toggleNamespace);
    const storeExpandAllNamespaces = useEditorStore((s) => s.expandAllNamespaces);
    const storeCollapseAllNamespaces = useEditorStore((s) => s.collapseAllNamespaces);
    const storeLayoutEngine = useEditorStore((s) => s.layoutOptions.engine ?? 'elk');

    // Structure View store — expansion state for the structure pane
    const expansionMap = useStructureViewStore((s) => s.expansionMap);
    // Row-level expansion toggle (Phase 13 / Finding 1). Wired into StructureView
    // so the per-row chevron rendered by DataNode can flip its store entry.
    const toggleExpansion = useStructureViewStore((s) => s.toggleExpansion);

    // Derive $type of the currently-selected node to gate which ids get forwarded
    // to StructureView as focusedTypeId. Using a separate selector avoids breaking
    // zustand's referential-equality optimisation that would fire on every nodes mutation.
    //
    // `$type` is guaranteed on every node since the typeKind→$type unification
    // (Phase 2 curated-serializer fix), so the former typeKind/node.type fallback
    // switch here is retired (Phase 3 prep) — `data.$type` is the single source.
    const selectedNodeType = useEditorStore((s) => {
      if (!s.selectedNodeId) return null;
      const node = s.nodesById.get(s.selectedNodeId);
      if (!node) return null;
      const d = node.data as { $type?: string } | undefined;
      return d?.$type ?? null;
    });
    const storeSetLayoutEngine = useEditorStore((s) => s.setLayoutEngine);
    const previewSelectedTargetId = usePreviewStore((s) => s.selectedTargetId);
    const previewSelectedTarget = usePreviewStore((s) => s.selectedTarget);
    const setPreviewTargets = usePreviewStore((s) => s.setAvailableTargets);
    const selectPreviewTarget = usePreviewStore((s) => s.selectTarget);

    // Structure View: drag-source state for the NamespaceExplorerPanel palette.
    const dragSource = useStructureViewStore((s) => s.dragSource);
    const setDragSource = useStructureViewStore((s) => s.setDragSource);
    const clearDragSource = useStructureViewStore((s) => s.clearDragSource);
    const updateGraphLayoutDirection = useCallback((nextDirection: Extract<LayoutDirection, 'LR' | 'TB'>) => {
      graphLayoutDirectionRef.current = nextDirection;
      setGraphLayoutDirection((prev) => (prev === nextDirection ? prev : nextDirection));
      return nextDirection;
    }, []);
    const getResponsiveGraphDirection = useCallback((): Extract<LayoutDirection, 'LR' | 'TB'> => {
      const rect = graphContainerRef.current?.getBoundingClientRect();
      if (!rect) return graphLayoutDirectionRef.current;
      const nextDirection = resolveResponsiveLayoutDirection(rect.width, rect.height, graphLayoutDirectionRef.current);
      return updateGraphLayoutDirection(nextDirection);
    }, [updateGraphLayoutDirection]);
    const syncResponsiveGraphLayout = useCallback(() => {
      const rect = graphContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const direction = resolveResponsiveLayoutDirection(rect.width, rect.height, graphLayoutDirectionRef.current);
      if (direction !== graphLayoutDirectionRef.current) {
        updateGraphLayoutDirection(direction);
        graphRef.current?.relayout({
          engine: useEditorStore.getState().layoutOptions.engine ?? 'elk',
          direction,
          groupByInheritance: groupedLayoutRef.current
        });
        return;
      }
      graphRef.current?.fitView();
    }, [updateGraphLayoutDirection]);

    const setGraphContainerRef = useCallback(
      (el: HTMLDivElement | null) => {
        graphContainerRef.current = el;
        if (!el) return;
        let frameId: number | undefined;
        const scheduleLayout = () => {
          if (frameId !== undefined) return;
          frameId = window.requestAnimationFrame(() => {
            frameId = undefined;
            if (!el.isConnected) return;
            const { width, height } = el.getBoundingClientRect();
            if (width > 0 && height > 0) syncResponsiveGraphLayout();
          });
        };
        scheduleLayout();
        const observer = new ResizeObserver(scheduleLayout);
        observer.observe(el);
        window.addEventListener('resize', scheduleLayout);
        return () => {
          if (graphContainerRef.current === el) graphContainerRef.current = null;
          if (frameId !== undefined) window.cancelAnimationFrame(frameId);
          observer.disconnect();
          window.removeEventListener('resize', scheduleLayout);
        };
      },
      [syncResponsiveGraphLayout]
    );

    useEffect(() => {
      if (!selectedNodeId) return;
      if (!storeNodes.some((node) => node.id === selectedNodeId)) return;
      // Skip while focus mode is isolating a subgraph (hiddenNodeIds non-empty):
      // RuneTypeGraph's own internal focus-fit effect already relayouts and
      // centers on the focused selection using the correct, freshly-filtered
      // node set. This effect's `graphRef.relayout()` call operates on
      // RuneTypeGraph's full internal node list — dispatched from this
      // separate component's effect reacting to the SAME `selectedNodeId`
      // change, it can fire in the same render pass as (and after) the
      // internal focus-fit effect and clobber its correct, focus-filtered
      // result back to the unfiltered graph. This was the remaining cause of
      // a freshly focus-selected node (e.g. a type from a just-uploaded file)
      // never rendering, even after the RuneTypeGraph-internal race was
      // fixed (2026-08-07).
      if (focusMode && hiddenNodeIds.size > 0) return;
      graphRef.current?.relayout({
        engine: useEditorStore.getState().layoutOptions.engine ?? 'elk',
        direction: getResponsiveGraphDirection(),
        groupByInheritance: groupedLayoutRef.current
      });
    }, [focusMode, getResponsiveGraphDirection, hiddenNodeIds, selectedNodeId, storeNodes]);

    const resolvedModelFiles = useMemo(() => {
      if (parsedModels && parsedModels.length > 0) {
        return parsedModels;
      }
      return models.flatMap((model, index) => {
        const file = files[index];
        return file ? [{ filePath: file.path, model }] : [];
      });
    }, [files, models, parsedModels]);

    const expressionOwnerFiles = useMemo(() => buildExpressionOwnerFiles(resolvedModelFiles), [resolvedModelFiles]);

    useEffect(() => {
      workspaceIdRef.current = workspaceId;
    }, [workspaceId]);

    useEffect(() => {
      modelsRef.current = models;
    }, [models]);

    useEffect(() => {
      // Hydrated curated docs live only in `corpusModelsRef` (the routed parse
      // intentionally keeps them out of workspace `models[]`). Clear that cache
      // only when the workspace itself changes; clearing on every parse rerender
      // makes Structure/Inspector populate for a frame and then drop back to the
      // deferred placeholder graph.
      if (linkDocumentTimerRef.current) clearTimeout(linkDocumentTimerRef.current);
      corpusModelsRef.current = [];
    }, [workspaceId]);

    useEffect(() => {
      // loadDeferredExports only stashes entries on the store (no node
      // mutation) — Codex P2 review of PR #164: doing both in one set()
      // avoids the "mixed stale graph in undo history" state. Then call
      // loadModels unconditionally — even with `models: []` — so it
      // materializes the curated placeholder nodes from the stashed
      // deferredExports. Hydrated curated docs merged through linkDocument live
      // in `corpusModelsRef`; keep them in the graph across same-workspace parse
      // rerenders because the routed parser does not echo them back in
      // `workspace.models`.
      useEditorStore.getState().loadDeferredExports(deferredExports);
      useEditorStore.getState().loadModels([...models, ...corpusModelsRef.current] as unknown[]);
    }, [models, deferredExports, workspaceId]);

    const selectedNodeData: AnyGraphNode | null = useMemo(() => {
      if (!selectedNodeId) return null;
      const node = nodeRepository.byId(selectedNodeId);
      return (node?.data as unknown as AnyGraphNode) ?? null;
    }, [selectedNodeId, nodeRepository]);
    const selectedNodeMeta: GraphNodeMeta | undefined = useMemo(() => {
      if (!selectedNodeId) return undefined;
      return nodeRepository.byId(selectedNodeId)?.meta;
    }, [selectedNodeId, nodeRepository]);

    // On-demand curated hydration (docs/superpowers/specs/2026-05-25-curated-on-demand-hydration-design.md,
    // trigger B): a selected deferred placeholder node's `data` is a stub
    // ({$type, name} only) until its namespace's server round-trip resolves.
    // Surface that as a loading state in the inspector rather than silently
    // dispatching the stub into a form with no fields — see EditorFormPanel's
    // `isHydrating` prop.
    const pendingHydrationNamespaces = useEditorStore((s) => s.pendingHydrationNamespaces);
    const hydratedNamespaces = useEditorStore((s) => s.hydratedNamespaces);
    const selectedNodeIsHydrating = useMemo(
      () => Boolean(selectedNodeMeta?.deferred && pendingHydrationNamespaces.includes(selectedNodeMeta.namespace)),
      [selectedNodeMeta, pendingHydrationNamespaces]
    );

    const previewTargets: FormPreviewTarget[] = useMemo(() => {
      const sourceByTargetId = new Map<string, Pick<FormPreviewTarget, 'sourceUri' | 'sourceIndex' | 'sourceRange'>>();
      for (const entry of resolvedModelFiles) {
        const model = entry.model;
        const modelUriValue = (
          model as unknown as {
            $document?: { uri?: { path?: string; toString(): string } };
          }
        ).$document?.uri;
        const sourceUri = pathToUri(modelUriValue?.path ?? modelUriValue?.toString() ?? entry.filePath);
        const namespace = namespaceFromModelName(model.name) ?? 'unknown';
        for (const [sourceIndex, element] of (model.elements ?? []).entries()) {
          const name = (element as { name?: string }).name;
          if (!name) {
            continue;
          }
          const range = (
            element as {
              $cstNode?: {
                range?: {
                  start?: { line?: number; character?: number };
                  end?: { line?: number; character?: number };
                };
              };
            }
          ).$cstNode?.range;
          sourceByTargetId.set(makeNodeId(namespace, name, element.$type), {
            sourceUri,
            sourceIndex,
            sourceRange:
              range?.start?.line !== undefined &&
              range?.start?.character !== undefined &&
              range?.end?.line !== undefined &&
              range?.end?.character !== undefined
                ? {
                    start: {
                      line: range.start.line,
                      character: range.start.character
                    },
                    end: {
                      line: range.end.line,
                      character: range.end.character
                    }
                  }
                : undefined
          });
        }
      }

      return storeNodes
        .map((node) => {
          const data = node.data as unknown as {
            name?: string;
            $type?: string;
          };
          const namespace = node.meta?.namespace;
          if (!namespace || !data.name) return undefined;
          return {
            id: node.id,
            namespace,
            name: data.name,
            kind: data.$type ?? 'unknown',
            ...sourceByTargetId.get(node.id)
          };
        })
        .filter((target): target is FormPreviewTarget => target !== undefined);
    }, [resolvedModelFiles, storeNodes]);

    useEffect(() => {
      setPreviewTargets(previewTargets, selectionRekey);
    }, [previewTargets, setPreviewTargets, selectionRekey]);

    useEffect(() => {
      if (isEditRekey || !previewSelectedTargetId || !previewSelectedTarget) {
        return;
      }
      if (previewTargets.some((target) => target.id === previewSelectedTargetId)) {
        return;
      }
      const renamedTarget = previewTargets.find((target) =>
        matchesPreviewSourceIdentity(previewSelectedTarget, target)
      );
      selectPreviewTarget(renamedTarget?.id);
    }, [previewSelectedTarget, previewSelectedTargetId, previewTargets, selectPreviewTarget, isEditRekey]);

    useEffect(() => {
      if (!selectedNodeId) {
        return;
      }
      // Increments a nonce to signal the inspector to re-focus.
      // No external resource is acquired here, so no cleanup is required.
      setInspectorFocusNonce((current) => current + 1);
      // react-doctor/effect-needs-cleanup: intentional — pure state update, no subscription.
    }, [selectedNodeId]);

    // Link the selected graph node document on demand.
    const prevSelectedRef = useRef<string | null>(null);
    useEffect(() => {
      if (selectedNodeId === prevSelectedRef.current) return;
      prevSelectedRef.current = selectedNodeId;
      if (!selectedNodeId || !selectedNodeData) return;

      const filePath = resolveNodeFile(selectedNodeData, selectedNodeMeta);
      // Trigger on-demand linking for the selected node's document (ADR 007 Phase 2).
      // Skip system:// URIs (base types are always parsed, never deferred).
      // Debounced so rapid keyboard navigation doesn't queue many worker requests.
      let cancelled = false;
      if (filePath && !filePath.startsWith('system://')) {
        const requestWorkspaceId = workspaceId;
        if (linkDocumentTimerRef.current) clearTimeout(linkDocumentTimerRef.current);
        linkDocumentTimerRef.current = setTimeout(() => {
          void linkDocument(filePath).then((result) => {
            if (cancelled || workspaceIdRef.current !== requestWorkspaceId || result.newModels.length === 0) {
              return;
            }
            if (result.newModels.length > 0) {
              corpusModelsRef.current = [...corpusModelsRef.current, ...result.newModels];
              // loadModels now re-merges the deferred-export placeholder nodes
              // automatically from store state — no need to call
              // loadDeferredExports after this. The store-owned deferredExports
              // state was populated when /api/parse responded.
              useEditorStore.getState().loadModels([...modelsRef.current, ...corpusModelsRef.current] as unknown[]);
            }
          });
        }, 150);
      }
      return () => {
        cancelled = true;
        if (linkDocumentTimerRef.current) clearTimeout(linkDocumentTimerRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNodeId, selectedNodeData, workspaceId]);

    // Re-link the selected node after an on-demand hydration completes.
    //
    // The selection effect above fires once when the node is first selected and
    // calls linkDocument 150ms later. If the node's namespace wasn't in the
    // worker yet (deferred / curated), that link fails silently — the worker has
    // no AST for the file yet. The on-demand hydration parse then completes and
    // triggers markNamespacesHydrated, which bumps hydrationNonce. This effect
    // reacts to that nonce change and re-links immediately (no 150ms debounce
    // needed — we're not racing file edits here, the worker is fully ready).
    // linkDocument is safe to re-run for an already-linked selection, but this
    // effect must not depend on the selected node object's identity. `loadModels`
    // can rebuild placeholder node objects during hydration, and keying this
    // effect on `selectedNodeData` would cancel the first successful re-link and
    // immediately issue a second one that returns `newModels: []`.
    const hydrationNonce = useEditorStore((s) => s.hydrationNonce);
    // Track which (nonce, namespace) pairs have already been re-linked so that
    // switching between nodes in the same namespace on the same nonce doesn't
    // issue redundant linkDocument round-trips.
    const relinkedRef = useRef(new Set<string>());
    useEffect(() => {
      relinkedRef.current = new Set();
    }, [hydrationNonce, workspaceId]);

    useEffect(() => {
      if (hydrationNonce === 0 || !selectedNodeId) return;
      // Link ALL files for the selected node's namespace. The curated artifact
      // format aggregates namespace-level exports onto the first document's export
      // list, so per-type file mapping (nodeIdToFilePath) is unreliable — it may
      // resolve to the enum file even when a data type is selected. Linking every
      // deferred file in the namespace ensures every model (enum, data, choice)
      // gets deserialized and merged into the graph.
      const { namespace } = splitNodeId(selectedNodeId);
      if (!namespace) return;
      const relinkedKey = `${hydrationNonce}:${namespace}`;
      if (relinkedRef.current.has(relinkedKey)) return;
      relinkedRef.current.add(relinkedKey);
      const filePathSet = new Set<string>();
      for (const e of deferredExportsRef.current) {
        if (e.namespace !== namespace) continue;
        if (!e.filePath || e.filePath.startsWith('system://')) continue;
        filePathSet.add(e.filePath);
      }
      const filePaths = [...filePathSet];
      if (filePaths.length === 0) return;
      const requestWorkspaceId = workspaceId;
      let cancelled = false;
      void Promise.all(filePaths.map((fp) => linkDocument(fp))).then((results) => {
        if (cancelled || workspaceIdRef.current !== requestWorkspaceId) return;
        const newModels = results.flatMap((r) => r.newModels);
        if (newModels.length === 0) return;
        corpusModelsRef.current = [...corpusModelsRef.current, ...newModels];
        useEditorStore.getState().loadModels([...modelsRef.current, ...corpusModelsRef.current] as unknown[]);
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrationNonce, selectedNodeId, workspaceId]);

    const functionScope: FunctionScope = useMemo(() => {
      const d = selectedNodeData as any;
      if (!d || d.$type !== 'RosettaFunction') {
        return { inputs: [], output: null, aliases: [] };
      }
      return {
        inputs: (d.inputs ?? []).map((p: any) => ({
          name: p.name,
          typeName: p.typeCall?.type?.$refText,
          cardinality: p.card ? `(${p.card.inf}..${p.card.unbounded ? '*' : (p.card.sup ?? p.card.inf)})` : undefined
        })),
        output: d.output?.typeCall?.type?.$refText
          ? { name: 'output', typeName: d.output.typeCall.type.$refText }
          : null,
        aliases: (d.shortcuts ?? []).map((s: any) => ({
          name: s.name,
          typeName: s.typeCall?.type?.$refText
        }))
      };
    }, [selectedNodeData]);

    const filesRef = useLatestRef(files);

    useEffect(() => {
      if (files.length === 0) {
        setActiveEditorFile((prev) => (prev === undefined ? prev : undefined));
        return;
      }

      const availablePaths = new Set(files.map((file) => file.path));
      const preferredFile = files.find((file) => !file.readOnly) ?? files[0]!;

      setActiveEditorFile((prev) => {
        if (prev && availablePaths.has(prev)) {
          return prev;
        }
        return preferredFile.path;
      });
    }, [files]);

    const [documentGeneration, setDocumentGeneration] = useState({ workspaceId, value: 0 });
    if (documentGeneration.workspaceId !== workspaceId)
      setDocumentGeneration({ workspaceId, value: documentGeneration.value + 1 });
    const documentGenerationRef = useLatestRef(documentGeneration.value);
    const expressionDocumentsRef = useRef<ExpressionDocument | null>(null);
    if (!expressionDocumentsRef.current)
      expressionDocumentsRef.current = new ExpressionDocument({
        getGeneration: () => documentGenerationRef.current,
        getFile: (path) => {
          const file = filesRef.current.find((candidate) => pathToUri(candidate.path) === path);
          return file ? { ...file, readOnly: Boolean(file.readOnly || file.refOnly) } : undefined;
        },
        onContentChange: (path, content) => sourceChangeRef.current(path, content)
      });
    const expressionDocuments = expressionDocumentsRef.current;
    useEffect(() => {
      for (const file of files) expressionDocuments.observe(pathToUri(file.path));
    }, [files, expressionDocuments]);

    const handleSourceChange = useCallback(
      (path: string, content: string) => {
        const updatedFiles = filesRef.current.map((f) => (f.path === path ? { ...f, content, dirty: true } : f));
        filesRef.current = updatedFiles;
        expressionDocuments.observe(pathToUri(path));
        onFilesChange?.(updatedFiles);
      },
      [onFilesChange, expressionDocuments]
    );
    const sourceChangeRef = useLatestRef(handleSourceChange);

    const namespaceToFile = useMemo(() => {
      const writablePaths = new Set(files.filter(isUserWorkspaceFile).map((file) => file.path));
      const map = new Map<string, string>();
      for (const entry of resolvedModelFiles) {
        const model = entry.model as { name?: unknown };
        const ns = namespaceFromModelName(model.name) ?? 'unknown';
        const existingPath = map.get(ns);
        if (existingPath && writablePaths.has(existingPath) && !writablePaths.has(entry.filePath)) continue;
        map.set(ns, entry.filePath);
      }
      return map;
    }, [resolvedModelFiles, files]);

    // Invert namespaceToFile against the current file content so the CST-reuse
    // serializer has the original source text to slice for clean subtrees.
    const originalSourceByNamespace = useMemo(() => {
      const fileByPath = new Map(files.map((f) => [f.path, f]));
      const map = new Map<string, string>();
      for (const [ns, filePath] of namespaceToFile) {
        const file = fileByPath.get(filePath);
        if (file && !file.readOnly && !file.refOnly) map.set(ns, file.content);
      }
      return map;
    }, [files, namespaceToFile]);

    const nodeIdToFilePath = useMemo(() => {
      const map = new Map<string, string>();
      for (const entry of resolvedModelFiles) {
        const model = entry.model as {
          name?: unknown;
          elements?: Array<{ name?: string; $type?: string }>;
        };
        const ns = namespaceFromModelName(model.name) ?? 'unknown';
        for (const element of model.elements ?? []) {
          const name = element.name ?? 'unknown';
          const nodeId = makeNodeId(ns, name, element.$type);
          if (expressionOwnerFiles.has(nodeId)) continue;
          if (!map.has(nodeId)) map.set(nodeId, entry.filePath);
        }
      }
      for (const [nodeId, entry] of expressionOwnerFiles) {
        if (entry) map.set(nodeId, entry.filePath);
      }
      // Include deferred corpus entries so linkDocument can resolve their file paths.
      for (const entry of deferredExports) {
        for (const exp of entry.exports) {
          if (!(exp.type in AST_TYPE_TO_NODE_TYPE)) continue;
          const nodeId = makeNodeId(entry.namespace, exp.name, exp.type);
          if (!map.has(nodeId)) map.set(nodeId, entry.filePath);
        }
      }
      return map;
    }, [resolvedModelFiles, deferredExports, expressionOwnerFiles]);

    const resolveNodeFile = useCallback(
      (nodeData: AnyGraphNode, meta: GraphNodeMeta | undefined): string | undefined => {
        const d = nodeData as any;
        if (meta?.namespace) {
          const nodeId = makeNodeId(meta.namespace, d.name, d.$type);
          if (expressionOwnerFiles.has(nodeId)) return expressionOwnerFiles.get(nodeId)?.filePath;
        }
        const docPath = d.$container?.$document?.uri?.path as string | undefined;
        if (docPath) {
          const match = files.find((f) => f.path === docPath || f.path.endsWith(docPath) || docPath.endsWith(f.path));
          if (match) return match.path;
          const fileName = docPath.split('/').pop();
          if (fileName) {
            const byName = files.find((f) => f.path.endsWith(fileName) || f.name === fileName);
            if (byName) return byName.path;
          }
        }
        if (!meta?.namespace) return undefined;
        const nodeId = makeNodeId(meta.namespace, d.name, typeof d.$type === 'string' ? d.$type : undefined);
        return nodeIdToFilePath.get(nodeId);
      },
      [files, nodeIdToFilePath, expressionOwnerFiles]
    );
    // Ref for the full deferredExports list so the hydration relink effect can
    // link ALL files for the selected namespace, not just the one the per-type
    // map points to. The curated artifacts aggregate namespace-level exports onto
    // the first document, so per-type file mapping is unreliable — linking every
    // file in the namespace ensures the right model is deserialized.
    const deferredExportsRef = useLatestRef(deferredExports);

    // Bound directly to the store action (same identity across renders, like
    // the old useCallback with an empty dep array) so every call site below
    // works unchanged.
    const openFileInSource = storeOpenFileInSource;

    const selectedSourceFilePath = resolveEditorFilePath(
      selectedNodeData ? resolveNodeFile(selectedNodeData, selectedNodeMeta) : undefined,
      files
    );
    useEffect(() => {
      for (const sourcePath of new Set([activeEditorFile, selectedSourceFilePath])) {
        const file = files.find((candidate) => candidate.path === sourcePath);
        const namespace = file?.namespace ?? selectedNodeMeta?.namespace;
        if (
          !file?.refOnly ||
          file.sourceLoaded ||
          file.content.length > 0 ||
          !file.bundleId ||
          !file.bundleVersion ||
          !namespace
        ) {
          continue;
        }
        if (!file.artifactKey && !hydratedNamespaces.includes(namespace)) {
          if (sourcePath === activeEditorFile) {
            pendingSourceNavigationRef.current = {
              bundleId: file.bundleId,
              bundleVersion: file.bundleVersion,
              namespace,
              path: file.path,
              workspaceId,
              revision: navigationSequenceRef.current,
              nodeId: sourcePath === selectedSourceFilePath ? (selectedNodeId ?? undefined) : undefined
            };
          }
          useEditorStore.getState().requestNamespaceHydration(namespace);
          continue;
        }
        const key = `${file.bundleId}:${file.bundleVersion}:${namespace}:${file.artifactKey ?? ''}`;
        if (pendingSourceRequestsRef.current.has(key)) continue;
        const loadToken = {};
        sourceLoadTokensRef.current.set(file.path, loadToken);
        pendingSourceRequestsRef.current.set(key, loadToken);
        setLoadingSourcePaths((paths) => new Set(paths).add(file.path));
        setSourceLoadError(null);
        void loadCuratedSource(file.bundleId, file.bundleVersion, namespace, file.artifactKey)
          .catch((error: unknown) => {
            if (sourceLoadTokensRef.current.get(file.path) !== loadToken) return;
            setSourceLoadError({
              path: file.path,
              message: error instanceof Error ? error.message : String(error)
            });
          })
          .finally(() => {
            if (pendingSourceRequestsRef.current.get(key) === loadToken) pendingSourceRequestsRef.current.delete(key);
            if (sourceLoadTokensRef.current.get(file.path) !== loadToken) return;
            sourceLoadTokensRef.current.delete(file.path);
            setLoadingSourcePaths((paths) => {
              const next = new Set(paths);
              next.delete(file.path);
              return next;
            });
          });
      }
    }, [
      files,
      activeEditorFile,
      selectedSourceFilePath,
      selectedNodeMeta?.namespace,
      selectedNodeId,
      hydratedNamespaces,
      workspaceId,
      loadCuratedSource
    ]);
    useEffect(() => {
      const pending = pendingSourceNavigationRef.current;
      if (!pending) return;
      if (
        pending.workspaceId !== workspaceId ||
        pending.revision !== navigationSequenceRef.current ||
        (pending.nodeId !== undefined && pending.nodeId !== selectedNodeId)
      ) {
        pendingSourceNavigationRef.current = null;
        return;
      }
      if (activeEditorFile !== pending.path && files.some((file) => file.path === pending.path)) {
        pendingSourceNavigationRef.current = null;
        return;
      }
      const hydratedPath = resolveHydratedSourcePath(pending, files, hydratedNamespaces, selectedSourceFilePath);
      if (!hydratedPath) return;
      pendingSourceNavigationRef.current = null;
      setActiveEditorFile(hydratedPath);
    }, [
      files,
      activeEditorFile,
      setActiveEditorFile,
      hydratedNamespaces,
      selectedSourceFilePath,
      selectedNodeId,
      workspaceId
    ]);
    const currentNavigationTarget =
      navigationTarget && navigationTarget.nodeId === selectedNodeId && navigationTarget.workspaceId === workspaceId
        ? navigationTarget
        : undefined;
    const navigationRevision = currentNavigationTarget?.revision;
    useEffect(() => {
      if (!selectedNodeId || isEditRekey) return;
      selectPreviewTarget(selectedNodeId);
    }, [selectedNodeId, navigationRevision, selectPreviewTarget, isEditRekey]);
    useEffect(() => {
      if (navigationTarget && !currentNavigationTarget) setNavigationTarget(null);
    }, [navigationTarget, currentNavigationTarget]);
    useEffect(() => {
      const previous = sourceRevealIntentRef.current;
      if (isEditRekey && selectedNodeId) {
        // A rename changes identity, not destination. Retain only the intent
        // used by a genuine Source remount; do not scroll or queue an arrival.
        sourceRevealIntentRef.current = {
          nodeId: selectedNodeId,
          workspaceId,
          filePath: selectedSourceFilePath,
          cancelled: previous?.workspaceId === workspaceId ? previous.cancelled : undefined,
          editRekey: true
        };
        pendingRevealRef.current = null;
        setSourceNavigationPending(null);
        return;
      }
      if (
        previous &&
        previous.nodeId === selectedNodeId &&
        previous.workspaceId === workspaceId &&
        previous.cancelled &&
        !previous.editRekey
      )
        return;
      const request = selectedNodeId ? { nodeId: selectedNodeId, workspaceId, filePath: selectedSourceFilePath } : null;
      sourceRevealIntentRef.current = request;
      // Source has already placed the cursor (and owns any LSP definition cue).
      // Synchronize other panes without bouncing back to the declaration start.
      // Keep the intent so an actual Source remount can restore the destination.
      if (currentNavigationTarget?.origin === 'source') {
        pendingRevealRef.current = null;
        setSourceNavigationPending(null);
        return;
      }
      pendingRevealRef.current = request?.filePath ? request : null;
      sourceEditorRef.current?.clearRevealHighlight?.();
      setSourceNavigationPending(pendingRevealRef.current);
      if (request?.filePath) openFileInSource(request.filePath);
      // Hydration may replace a deferred file identity. It must not reclaim a
      // tab after the user explicitly navigated away from this selection.
    }, [
      selectedNodeId,
      selectedSourceFilePath,
      workspaceId,
      openFileInSource,
      navigationRevision,
      currentNavigationTarget?.origin,
      isEditRekey
    ]);

    // "+" new-file affordance moved to ExploreCenterSlot (shared-perspective-
    // chrome plan, Task 3) — it re-derives the same logic from useWorkspace().

    // Owns the HydrationOrchestrator instance for this component's lifetime —
    // dedups (via waitingByNamespace) the three on-demand hydration triggers
    // below (handleToggleNamespace, navigateToNode).
    // Deliberately does NOT call beginRetryRound — these triggers are
    // user-driven (re-selecting/re-toggling), not auto-retried, so there is
    // no re-entrant loop to cap, and capping would strand a still-deferred
    // node's hydration permanently after 5 selections with no markResolved
    // call anywhere in this file to reset it. See requestHydration's doc
    // comment in hydration-orchestrator.ts for the opt-in protocol this
    // relies on.
    // Constructed inside a mount effect (not lazily on render) so it survives
    // React StrictMode's mount→unmount→remount double-invoke cleanly: the
    // cleanup disposes the orchestrator (unsubscribing from useEditorStore),
    // and the second mount constructs a fresh one — no leaked subscriptions.
    // Same pattern as CodegenProvider (Task 3).
    const orchestratorRef = useRef<HydrationOrchestrator | null>(null);
    useEffect(() => {
      let lastHydrationNonce = useEditorStore.getState().hydrationNonce;
      const orchestrator = new HydrationOrchestrator({
        getHydratedNamespaces: () => useEditorStore.getState().hydratedNamespaces,
        getPendingHydrationNamespaces: () => useEditorStore.getState().pendingHydrationNamespaces,
        requestNamespaceHydration: (ns) => useEditorStore.getState().requestNamespaceHydration(ns),
        subscribeToHydrationChange: (onChange) =>
          useEditorStore.subscribe((state) => {
            if (state.hydrationNonce !== lastHydrationNonce) {
              lastHydrationNonce = state.hydrationNonce;
              onChange();
            }
          })
      });
      orchestratorRef.current = orchestrator;
      return () => {
        orchestrator.dispose();
        orchestratorRef.current = null;
      };
    }, []);

    // Expanding a namespace header is an equally natural browse gesture that
    // should trigger hydration. Wrap the bare toggle action so we can also
    // queue the namespace for on-demand hydration before toggling visibility.
    const handleToggleNamespace = useCallback(
      (namespace: string) => {
        const needsHydration = useEditorStore
          .getState()
          .nodes.some((n) => n.meta.namespace === namespace && n.meta.deferred === true);
        if (needsHydration) {
          orchestratorRef.current?.requestHydration(namespace, {
            retryFor: {
              targetId: namespace,
              onRetry: () => {
                // No re-render trigger needed here: the explorer's node list and
                // StructureView both read directly from useEditorStore selectors,
                // so they re-render from the fresh store state once hydration
                // completes without any extra action. Routed through the
                // orchestrator purely for retry-cap/dedup consistency with the
                // other two call sites (Task 5) — see Task 4's finding that
                // Structure/Inspector degrade gracefully without extra retry logic.
              }
            }
          });
        }
        storeToggleNamespace(namespace);
      },
      [storeToggleNamespace]
    );

    const shouldCenterNavigationTarget = useCallback(
      (nodeId: string) => {
        if (!focusMode) return true;
        const hasIncidentEdge = storeEdges.some((edge) => edge.source === nodeId || edge.target === nodeId);
        if (!hasIncidentEdge) return true;
        return useEditorStore.getState().visibility.hiddenNodeIds.size === 0;
      },
      [focusMode, storeEdges]
    );

    // Recomputes the reactive canGoBack/canGoForward flags from the two
    // history refs. Called after every push/pop so the toolbar buttons'
    // disabled state stays in sync without making the stacks themselves
    // reactive state (see navigationForwardRef's comment above).
    const updateHistoryFlags = useCallback(() => {
      setCanGoBack(navigationHistoryRef.current.length > 0);
      setCanGoForward(navigationForwardRef.current.length > 0);
    }, []);

    // Single choke point for "was this a new visit?" — subscribes directly
    // to useEditorStore's selectedNodeId rather than hooking every call
    // site that can change it. That list is bigger than just navigateToNode:
    // StructureView's
    // onNodeSelect/onNavigateToEnumType, and RuneTypeGraph's own internal
    // node-click selection (packages/visual-editor — not exposed to this
    // file as a callback at all) all call storeSelectNode directly. Patching
    // history bookkeeping into each of those would duplicate this exact
    // logic at N sites; subscribing once here is the DRY fix.
    //
    // isHistoryNavigationRef distinguishes navigateBack/navigateForward's
    // own storeSelectNode calls (which already manage both stacks
    // correctly themselves — pop one, push the departing node onto the
    // OTHER one) from every other selection change, which should push the
    // departing node onto the back stack and invalidate forward history
    // (standard browser back/forward semantics).
    //
    // Edit operations on the currently-selected type also change
    // selectedNodeId as a side effect — renameType rekeys it to the new id,
    // deleteType clears it to null (editor-store.ts) — without being a
    // user-initiated visit. Both remove the OLD id from the node map (a
    // rename deletes-then-reinserts under the new id; a delete just
    // deletes), so "the departing node no longer exists" identifies an
    // edit-driven rekey — no separate edit-vs-navigation signal needs
    // plumbing in from editor-store.ts, since a normal navigation's
    // departing node is never a node the change itself deleted.
    //
    // isEditDrivenRekey and "should we push to the back stack" are
    // deliberately NOT the same condition. A rekey requires an actual
    // departing node that got removed (previous truthy AND missing from
    // nodesById); a fresh pick with no departing node (previous is null —
    // e.g. right after an edit-driven clear-to-null) can never be a rekey,
    // since there's no node whose removal could explain the transition, so
    // it's always a genuine new visit that must still invalidate forward
    // history even though there's nothing to push onto the back stack.
    // Concretely: A→B→Back-to-A→delete-A leaves forward=[B] (correctly, via
    // the isEditDrivenRekey branch below with previous='A'); selecting C
    // next transitions null→'C' — not a rekey (previous is null) — so this
    // must still clear the stale forward=[B], even though there's no
    // previous id to push onto the back stack.
    useEffect(() => {
      let previous = useEditorStore.getState().selectedNodeId;
      return useEditorStore.subscribe((state) => {
        const current = state.selectedNodeId;
        if (current === previous) return;
        if (isHistoryNavigationRef.current) {
          isHistoryNavigationRef.current = false;
          previous = current;
          return;
        }
        const isEditDrivenRekey = previous !== null && previous !== undefined && !state.nodesById.has(previous);
        if (isEditDrivenRekey) {
          // previous itself may already sit in EARLIER stack entries from
          // prior real visits (e.g. A→B→A→rename-A: the initial A→B push
          // left 'A' in the back stack, independent of the `previous`
          // local var this rename transition sees). Leaving those entries
          // under the obsolete id makes a later Back/Forward that reaches
          // them show a false "no longer in the graph" toast instead of
          // landing on the renamed node. Rename rewrites every matching
          // entry to the new id; delete (current falsy or itself missing —
          // the departing node is gone for good, not just renamed) drops
          // them, since a deleted id can never be navigated back to.
          const renamedTo = current && state.nodesById.has(current) ? current : null;
          if (renamedTo) {
            const rekey = (id: string) => (id === previous ? renamedTo : id);
            navigationHistoryRef.current = navigationHistoryRef.current.map(rekey);
            navigationForwardRef.current = navigationForwardRef.current.map(rekey);
          } else {
            navigationHistoryRef.current = navigationHistoryRef.current.filter((id) => id !== previous);
            navigationForwardRef.current = navigationForwardRef.current.filter((id) => id !== previous);
          }
          updateHistoryFlags();
        } else {
          if (previous) {
            navigationHistoryRef.current.push(previous);
            if (navigationHistoryRef.current.length > 100) navigationHistoryRef.current.shift();
          }
          navigationForwardRef.current = [];
          updateHistoryFlags();
        }
        previous = current;
      });
    }, [updateHistoryFlags]);

    // Node-visit history is workspace-scoped — PerspectiveHost keeps
    // ExplorePerspective permanently mounted across workspace switches
    // (display:none toggling, never unmounted), so without this reset the
    // stacks would survive into an unrelated workspace and Back/Forward
    // could resolve to a stale node id that happens to collide with one in
    // the new workspace (e.g. a shared corpus type).
    useEffect(() => {
      navigationHistoryRef.current = [];
      navigationForwardRef.current = [];
      updateHistoryFlags();
    }, [workspaceId, updateHistoryFlags]);

    const navigateToNode = useCallback(
      (nodeId: string, origin?: 'source') => {
        const targetNode =
          nodeRepository.byId(nodeId) ??
          nodeRepository.all().find((node) => isTypeNodeId(node.id) && qualifiedNameFromNodeId(node.id) === nodeId);
        const resolvedNodeId = targetNode?.id ?? nodeId;
        const exists = Boolean(targetNode);
        if (!exists) {
          const shortName = nameFromNodeId(nodeId);
          showToast({
            description: `Type "${shortName}" not loaded — load the file containing this type`,
            variant: 'destructive',
            duration: 3000
          });
          return;
        }
        // History tracking (back-stack push + forward-stack invalidation) is
        // handled generically by the selectedNodeId subscription above.
        // Explicit navigation reveals the target while preserving unrelated kind filters.
        const editor = useEditorStore.getState();
        const targetKind = targetNode?.type as import('@rune-langium/visual-editor').TypeKind;
        if (targetKind && !editor.visibility.visibleNodeKinds.has(targetKind)) editor.toggleNodeKind(targetKind);
        if (sourceRevealIntentRef.current) sourceRevealIntentRef.current.cancelled = false;
        if (origin === 'source') pendingRevealRef.current = null;
        requestNavigationArrival(resolvedNodeId, origin);
        storeSelectNode(resolvedNodeId, { reapplyFocusMode: true });
        if (!focusMode) editor.revealNeighbors(resolvedNodeId);
        const targetMeta = targetNode?.meta;
        if (targetMeta?.deferred && targetMeta.namespace) {
          orchestratorRef.current?.requestHydration(targetMeta.namespace, {
            retryFor: {
              targetId: resolvedNodeId,
              onRetry: () => {
                // Hydration has already replaced the graph before this retry.
                storeSelectNode(resolvedNodeId, { reapplyFocusMode: false });
              }
            }
          });
        }
        if (!focusMode && shouldCenterNavigationTarget(resolvedNodeId)) {
          graphRef.current?.focusNode(resolvedNodeId);
        }
      },
      [focusMode, showToast, shouldCenterNavigationTarget, nodeRepository, storeSelectNode, requestNavigationArrival]
    );

    const handleSourceNavigateToNode = useCallback(
      (nodeId: string) => navigateToNode(nodeId, 'source'),
      [navigateToNode]
    );

    useEffect(() => {
      setExploreNavigateToType(navigateToNode);
      return () => setExploreNavigateToType(undefined);
    }, [navigateToNode, setExploreNavigateToType]);

    const navigateBack = useCallback(() => {
      const prev = navigationHistoryRef.current.pop();
      if (!prev) return;
      const exists = storeNodes.some((n) => n.id === prev);
      if (!exists) {
        updateHistoryFlags();
        showToast({
          description: `Previous node "${prev}" is no longer in the graph`,
          variant: 'destructive',
          duration: 3000
        });
        return;
      }
      const current = useEditorStore.getState().selectedNodeId;
      if (current) {
        navigationForwardRef.current.push(current);
      }
      isHistoryNavigationRef.current = true;
      requestNavigationArrival(prev);
      storeSelectNode(prev, { reapplyFocusMode: true });
      updateHistoryFlags();
      if (!focusMode && shouldCenterNavigationTarget(prev)) {
        graphRef.current?.focusNode(prev);
      }
    }, [
      focusMode,
      showToast,
      shouldCenterNavigationTarget,
      storeSelectNode,
      storeNodes,
      updateHistoryFlags,
      requestNavigationArrival
    ]);

    const navigateForward = useCallback(() => {
      const next = navigationForwardRef.current.pop();
      if (!next) return;
      const exists = storeNodes.some((n) => n.id === next);
      if (!exists) {
        updateHistoryFlags();
        showToast({
          description: `Node "${next}" is no longer in the graph`,
          variant: 'destructive',
          duration: 3000
        });
        return;
      }
      const current = useEditorStore.getState().selectedNodeId;
      if (current) {
        navigationHistoryRef.current.push(current);
        if (navigationHistoryRef.current.length > 100) navigationHistoryRef.current.shift();
      }
      isHistoryNavigationRef.current = true;
      requestNavigationArrival(next);
      storeSelectNode(next, { reapplyFocusMode: true });
      updateHistoryFlags();
      if (!focusMode && shouldCenterNavigationTarget(next)) {
        graphRef.current?.focusNode(next);
      }
    }, [
      focusMode,
      showToast,
      shouldCenterNavigationTarget,
      storeSelectNode,
      storeNodes,
      updateHistoryFlags,
      requestNavigationArrival
    ]);

    const handleEditorPageKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        // Must be *exactly* Alt (no Ctrl/Meta/Shift) — Ctrl+Alt+Arrow and
        // Cmd+Alt+Arrow are already bound to focus-prev-panel/focus-next-panel,
        // and Shift+Alt+Arrow to reorder-tab-left/reorder-tab-right
        // (shell/keyboard.ts). Those bindings are installed via a separate
        // window-level listener (installShellShortcuts) that this handler's
        // preventDefault() doesn't stop, so an altKey-only check here would
        // fire both navigateBack/navigateForward AND the panel action on the
        // same keydown for those combos.
        const plainAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        if ((plainAlt && e.key === 'ArrowLeft') || (e.metaKey && e.key === '[')) {
          e.preventDefault();
          navigateBack();
        } else if ((plainAlt && e.key === 'ArrowRight') || (e.metaKey && e.key === ']')) {
          e.preventDefault();
          navigateForward();
        }
      },
      [navigateBack, navigateForward]
    );

    const handleModelChanged = useCallback(
      (serialized: Map<string, string>) => {
        // The CST-reuse serializer (buildSourceForNamespaces) already produces
        // full merged file text — no separate mergeSerializedIntoSource step.
        const filesAtStart = filesRef.current;
        const merged = filesAtStart.map((f) => {
          if (f.readOnly || f.refOnly) return f;
          for (const [ns, text] of serialized) {
            if (namespaceToFile.get(ns) !== f.path) continue;
            if (text === f.content) return f;
            return { ...f, content: text, dirty: true };
          }
          return f;
        });
        if (!merged.some((e, i) => e !== filesAtStart[i])) return;
        onFilesChange?.(merged);
      },
      [namespaceToFile, onFilesChange]
    );

    // Source-text sync — fires onModelChanged whenever inspector/structure edits
    // change the editor-store, regardless of which center pane is mounted.
    // Previously this subscription lived inside RuneTypeGraph, which is only
    // mounted when the Graph pane is active; Structure-pane edits never reached
    // the source pane (2026-05-21, fix/inspector-source-sync).
    const sourceSync = useModelSourceSync(
      storeNodes,
      storeEdges,
      handleModelChanged,
      storeParseEpoch,
      storePendingEditPatches,
      originalSourceByNamespace,
      storePendingInversePatches
    );

    useEffect(
      () =>
        registerEditorSaveBarrier?.(async () => {
          formCommitRegistry.flush();
          const latest = useEditorStore.getState();
          await sourceSync.flush({
            nodes: latest.nodes,
            edges: latest.edges,
            parseEpoch: latest.parseEpoch,
            patches: latest.pendingEditPatches,
            inversePatches: latest.pendingInversePatches
          });
        }),
      [registerEditorSaveBarrier, formCommitRegistry, sourceSync.flush]
    );

    useLspDiagnosticsBridge(lspClient);
    const { fileDiagnostics } = useDiagnosticsStore();
    const combinedFileDiagnostics = useMemo(
      () => combineFileDiagnostics(fileDiagnostics, files, parseErrors),
      [fileDiagnostics, files, parseErrors]
    );
    const combinedDiagnostics = useMemo(() => countDiagnostics(combinedFileDiagnostics), [combinedFileDiagnostics]);

    useEffect(() => {
      if (!lspClient) return;
      const unsub = lspClient.onDisplayFile(async (uri: string) => {
        let path: string;
        try {
          const parsed = new URL(uri);
          path = decodeURIComponent(parsed.pathname);
        } catch {
          path = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
        }
        const fileName = path.split('/').pop() ?? path;
        const file = files.find((f) => f.path === path || f.path.endsWith(fileName) || path.endsWith(f.path));
        if (!file) {
          // eslint-disable-next-line no-console
          console.warn(`[displayFile] No workspace file found matching URI: ${uri} (fileName: ${fileName})`);
          useOutputStore.getState().addLine(fmtLine('editor', `file not found for URI`, fileName), 'warn');
          return null;
        }
        const arrival = { filePath: file.path, workspaceId };
        setPendingFileArrival(arrival);
        openFileInSource(file.path);
        return new Promise<import('@codemirror/view').EditorView | null>((resolve) => {
          const existing = pendingDisplayFileRef.current.get(file.path);
          if (existing) existing(null);
          const resolveView = (view: import('@codemirror/view').EditorView | null) => {
            setPendingFileArrival((current) => (current === arrival ? null : current));
            resolve(view);
          };
          pendingDisplayFileRef.current.set(file.path, resolveView);
          const timerId = setTimeout(() => {
            displayFileTimersRef.current.delete(timerId);
            if (pendingDisplayFileRef.current.get(file.path) === resolveView) {
              pendingDisplayFileRef.current.get(file.path)?.(null);
              pendingDisplayFileRef.current.delete(file.path);
              // eslint-disable-next-line no-console
              console.warn(`[displayFile] Timed out waiting for EditorView: "${file.path}"`);
              useOutputStore.getState().addLine(fmtLine('editor', 'editor view timeout', file.path), 'warn');
              resolve(null);
            }
          }, 2000);
          displayFileTimersRef.current.add(timerId);
        });
      });
      return () => {
        unsub();
        for (const id of displayFileTimersRef.current) clearTimeout(id);
        displayFileTimersRef.current.clear();
        // Resolve any pending displayFile promises so LSP client doesn't hang.
        for (const resolve of pendingDisplayFileRef.current.values()) resolve(null);
        pendingDisplayFileRef.current.clear();
      };
    }, [lspClient, files, openFileInSource, workspaceId]);

    const sourceRevealContextRef = useLatestRef({
      selectedNodeId,
      selectedNodeData,
      selectedSourceFilePath,
      workspaceId,
      files,
      parsedModels
    });
    const applyPendingReveal = useCallback(
      (filePath: string) => {
        const pending = pendingRevealRef.current;
        if (!pending || pending.cancelled || pending.filePath !== filePath) return;
        requestAnimationFrame(() => {
          if (pendingRevealRef.current !== pending) return;
          const current = sourceRevealContextRef.current;
          if (
            current.selectedNodeId !== pending.nodeId ||
            current.workspaceId !== pending.workspaceId ||
            current.selectedSourceFilePath !== pending.filePath ||
            useExploreFileNavStore.getState().activeEditorFile !== pending.filePath
          )
            return;
          const file = current.files.find((candidate) => candidate.path === pending.filePath);
          if (!file || !current.selectedNodeData) return;
          // Empty curated placeholders are still waiting for their original source.
          if (file.refOnly && !file.sourceLoaded && file.content.length === 0) return;
          const parsed = current.parsedModels?.find((entry) => entry.filePath === file.path);
          // Editable offsets describe the parsed snapshot, not necessarily the live buffer.
          // Curated source and AST share an immutable artifact identity.
          const coordinatesCurrent =
            parsed?.source === file.content || Boolean(file.readOnly && file.refOnly && file.artifactKey);
          const line = findDeclarationLine(file.content, current.selectedNodeData, coordinatesCurrent);
          if (line !== undefined && sourceEditorRef.current?.revealLine(line, pending.filePath)) {
            pendingRevealRef.current = null;
            setSourceNavigationPending(null);
          } else if (line === undefined) {
            // Retain the intent for a later matching parse, but an unresolved
            // destination is not an active load and must not pulse forever.
            setSourceNavigationPending(null);
          }
        });
      },
      [sourceRevealContextRef]
    );

    const handleEditorViewCreated = useCallback(
      (filePath: string, view: import('@codemirror/view').EditorView) => {
        const resolve = pendingDisplayFileRef.current.get(filePath);
        if (resolve) {
          pendingDisplayFileRef.current.delete(filePath);
          resolve(view);
        }
        const fileArrival = pendingFileArrivalRef.current;
        if (fileArrival?.fileOnly && fileArrival.filePath === filePath) {
          setCompletedFileArrival(fileArrival);
          setPendingFileArrival(null);
        }
        // A hidden Source pane destroys its view. Restore the same selection
        // when it reopens, unless a later file navigation superseded it.
        const intent = sourceRevealIntentRef.current;
        if (intent?.filePath === filePath && !intent.cancelled) {
          pendingRevealRef.current = intent;
        }
        applyPendingReveal(filePath);
      },
      [applyPendingReveal, pendingFileArrivalRef]
    );

    const sourceEditorFiles = useMemo(() => {
      const resolvedActiveFile =
        (activeEditorFile ? files.find((file) => file.path === activeEditorFile) : undefined) ??
        files.find((file) => !file.readOnly) ??
        files[0];
      return resolvedActiveFile ? [resolvedActiveFile] : [];
    }, [activeEditorFile, files]);

    useEffect(() => {
      if (
        !pendingFileArrival?.fileOnly ||
        pendingFileArrival.workspaceId !== workspaceId ||
        pendingFileArrival.filePath !== activeEditorFile ||
        !sourceEditorRef.current ||
        !sourcePaneRef.current
      )
        return;
      const file = sourceEditorFiles.find((candidate) => candidate.path === pendingFileArrival.filePath);
      if (!file || (file.refOnly && !file.sourceLoaded && !file.content.length)) return;
      setCompletedFileArrival(pendingFileArrival);
      setPendingFileArrival(null);
    }, [pendingFileArrival, workspaceId, activeEditorFile, sourceEditorFiles]);
    useEffect(() => {
      if (!completedFileArrival || !sourcePaneRef.current) return;
      return emphasizeNavigationArrival(sourcePaneRef.current);
    }, [completedFileArrival]);
    useEffect(() => {
      setCompletedFileArrival((request) =>
        request && request.filePath === activeEditorFile && request.workspaceId === workspaceId ? request : null
      );
    }, [workspaceId, activeEditorFile]);

    useEffect(() => {
      const pending = pendingRevealRef.current;
      if (pending?.filePath && sourceEditorFiles.some((file) => file.path === pending.filePath)) {
        applyPendingReveal(pending.filePath);
      }
    }, [
      sourceEditorFiles,
      selectedNodeId,
      selectedNodeData,
      workspaceId,
      parsedModels,
      applyPendingReveal,
      navigationRevision,
      isEditRekey
    ]);

    useEffect(() => {
      // Cancel on explicit file navigation, including a tab switch before the
      // scheduled frame. Opening the selected file above updates the store first.
      const unsubscribe = useExploreFileNavStore.subscribe((state, previous) => {
        const fileRequested =
          state.requestedSourceFile !== undefined && state.requestedSourceFile !== previous.requestedSourceFile;
        if (fileRequested) {
          setPendingFileArrival({
            filePath: state.requestedSourceFile!,
            workspaceId: sourceRevealContextRef.current.workspaceId,
            fileOnly: true
          });
        } else if (state.activeEditorFile !== previous.activeEditorFile) {
          setPendingFileArrival((request) => (request?.filePath === state.activeEditorFile ? request : null));
        }
        const intent = sourceRevealIntentRef.current;
        if (
          intent &&
          (fileRequested ||
            (state.activeEditorFile !== previous.activeEditorFile &&
              state.activeEditorFile !== sourceRevealContextRef.current.selectedSourceFilePath &&
              sourceRevealContextRef.current.files.some((file) => file.path === previous.activeEditorFile)))
        ) {
          intent.cancelled = true;
          pendingRevealRef.current = null;
          setSourceNavigationPending(null);
          sourceEditorRef.current?.clearRevealHighlight?.();
        }
      });
      return () => {
        unsubscribe();
        sourceRevealIntentRef.current = null;
        pendingRevealRef.current = null;
      };
    }, [sourceRevealContextRef]);

    const getSerializedFiles = useCallback((): Map<string, string> => {
      const rosettaText = graphRef.current?.exportRosetta?.();
      if (!rosettaText || rosettaText.size === 0) return new Map();
      return rosettaText;
    }, []);

    const validateModelForExport = useCallback((): string[] => {
      const warnings: string[] = [];
      if (combinedDiagnostics.errors > 0) {
        warnings.push(
          `Model has ${combinedDiagnostics.errors} error(s) that may affect code generation output quality.`
        );
      }
      if (combinedDiagnostics.warnings > 0) {
        warnings.push(`Model has ${combinedDiagnostics.warnings} warning(s).`);
      }
      const serialized = getSerializedFiles();
      if (serialized.size === 0) warnings.push('No user-authored files found to export.');
      return warnings;
    }, [combinedDiagnostics.errors, combinedDiagnostics.warnings, getSerializedFiles]);

    const availableTypes: TypeOption[] = useMemo(() => buildTypeOptions(nodeRepository), [nodeRepository]);

    const synonymSourceOptions: SourceRefOption[] = useMemo(() => {
      const out: SourceRefOption[] = [];
      for (const { model } of resolvedModelFiles) {
        const namespace = namespaceFromModelName(model.name) ?? undefined;
        for (const element of model.elements ?? []) {
          if ((element as { $type?: string }).$type === 'RosettaSynonymSource') {
            const name = (element as { name: string }).name;
            out.push({ value: namespace ? `${namespace}.${name}` : name, label: name, namespace });
          }
        }
      }
      return out;
    }, [resolvedModelFiles]);

    const editorActions: EditorFormActions = useMemo(() => {
      const s = useEditorStore.getState;
      return {
        renameType: (nodeId, newName) => s().renameType(nodeId, newName),
        deleteType: (nodeId) => s().deleteType(nodeId),
        updateDefinition: (nodeId, def) => s().updateDefinition(nodeId, def),
        updateComments: (nodeId, comments) => s().updateComments(nodeId, comments),
        addSynonym: (nodeId, synonym) => s().addSynonym(nodeId, synonym),
        removeSynonym: (nodeId, index) => s().removeSynonym(nodeId, index),
        addAttribute: (nodeId, name, type, card) => s().addAttribute(nodeId, name, type, card),
        removeAttribute: (nodeId, name) => s().removeAttribute(nodeId, name),
        updateAttribute: (nodeId, oldN, newN, type, card) => s().updateAttribute(nodeId, oldN, newN, type, card),
        reorderAttribute: (nodeId, from, to) => s().reorderAttribute(nodeId, from, to),
        setInheritance: (childId, parentId) => s().setInheritance(childId, parentId),
        addEnumValue: (nodeId, name, display) => s().addEnumValue(nodeId, name, display),
        removeEnumValue: (nodeId, name) => s().removeEnumValue(nodeId, name),
        updateEnumValue: (nodeId, oldN, newN, display) => s().updateEnumValue(nodeId, oldN, newN, display),
        reorderEnumValue: (nodeId, from, to) => s().reorderEnumValue(nodeId, from, to),
        addEnumValueSynonym: (nodeId, valueIndex, source, value) =>
          s().addEnumValueSynonym(nodeId, valueIndex, source, value),
        removeEnumValueSynonym: (nodeId, valueIndex, synIndex) =>
          s().removeEnumValueSynonym(nodeId, valueIndex, synIndex),
        setEnumParent: (nodeId, parentId) => s().setEnumParent(nodeId, parentId),
        addChoiceOption: (nodeId, type) => s().addChoiceOption(nodeId, type),
        removeChoiceOption: (nodeId, type) => s().removeChoiceOption(nodeId, type),
        addInputParam: (nodeId, name, type) => s().addInputParam(nodeId, name, type),
        removeInputParam: (nodeId, name) => s().removeInputParam(nodeId, name),
        updateInputParam: (nodeId, oldN, newN, type, card) => s().updateInputParam(nodeId, oldN, newN, type, card),
        reorderInputParam: (nodeId, from, to) => s().reorderInputParam(nodeId, from, to),
        updateOutputType: (nodeId, type) => s().updateOutputType(nodeId, type),
        setFunctionParent: (nodeId, parentId) => s().setFunctionParent(nodeId, parentId),
        updateTypeAliasType: (nodeId, type) => s().updateTypeAliasType(nodeId, type),
        updateExpression: (...args) => s().updateExpression(...args),
        addAnnotation: (nodeId, name) => s().addAnnotation(nodeId, name),
        removeAnnotation: (nodeId, index) => s().removeAnnotation(nodeId, index),
        addCondition: (nodeId, condition) => s().addCondition(nodeId, condition),
        removeCondition: (nodeId, index) => s().removeCondition(nodeId, index),
        updateCondition: (nodeId, index, updates) => s().updateCondition(nodeId, index, updates),
        reorderCondition: (nodeId, from, to) => s().reorderCondition(nodeId, from, to),
        validate: () => s().validate()
      };
    }, []);

    const handleFitView = useCallback(() => {
      graphRef.current?.fitView();
    }, []);
    const handleRelayout = useCallback(() => {
      graphRef.current?.relayout({
        engine: useEditorStore.getState().layoutOptions.engine ?? 'elk',
        direction: getResponsiveGraphDirection(),
        groupByInheritance: groupedLayout
      });
    }, [getResponsiveGraphDirection, groupedLayout]);
    const handleToggleFocusMode = useCallback(() => {
      const nextFocusMode = !focusMode;
      storeToggleFocusMode();
      if (!nextFocusMode) {
        setTimeout(() => {
          graphRef.current?.relayout({
            engine: useEditorStore.getState().layoutOptions.engine ?? 'elk',
            direction: graphLayoutDirectionRef.current,
            groupByInheritance: groupedLayoutRef.current
          });
        }, 0);
      }
    }, [focusMode, storeToggleFocusMode]);
    const handleToggleGroupedLayout = useCallback(() => {
      // The relayout side effect lives here in the event handler, not inside
      // the state updater passed to setGroupedLayout — an updater must stay
      // pure since React may invoke it more than once.
      const next = !groupedLayout;
      setGroupedLayout(next);
      setTimeout(() => {
        graphRef.current?.relayout({
          engine: useEditorStore.getState().layoutOptions.engine ?? 'elk',
          direction: getResponsiveGraphDirection(),
          groupByInheritance: next
        });
      }, 0);
    }, [groupedLayout, getResponsiveGraphDirection]);

    // ---------- panel components rendered inside dockview ----------

    // NamespaceExplorerPanel manages its own scrolling — the virtualizer
    // (useVirtualTree) must own the scroll element to compute viewport
    // metrics. Wrapping it in a Radix <ScrollArea> creates a double
    // scroll container: the inner virtualized div grows to its natural
    // size and never scrolls, while the outer Radix viewport scrolls
    // with `scrollbar-width: none` (so no native bar shows) and only
    // lazy-mounts its custom scrollbar on hover — producing the
    // "looks nice but un-clickable" scrollbar the user reported.
    const FileTreePanelMounted = useCallback(
      () => (
        <div className="h-full">
          <NamespaceExplorerPanel
            showHeading={false}
            nodeRepository={nodeRepository}
            expandedNamespaces={expandedNamespaces}
            hiddenNodeIds={hiddenNodeIds}
            selectedNodeId={selectedNodeId}
            onToggleNamespace={handleToggleNamespace}
            onExpandAll={storeExpandAllNamespaces}
            onCollapseAll={storeCollapseAllNamespaces}
            onSelectNode={navigateToNode}
            dragSourceId={dragSource?.typeId}
            onSetDragSource={setDragSource}
            onClearDragSource={clearDragSource}
          />
        </div>
      ),
      [
        nodeRepository,
        expandedNamespaces,
        hiddenNodeIds,
        selectedNodeId,
        handleToggleNamespace,
        storeExpandAllNamespaces,
        storeCollapseAllNamespaces,
        navigateToNode,
        dragSource,
        setDragSource,
        clearDragSource
      ]
    );

    // workspace.editor and workspace.inspector are rendered inside CenterStackPanel.
    // These stubs are kept so the dockview component registry remains complete,
    // but they are not part of the active layout.
    const SourceEditorPanelMounted = useCallback(() => <div data-testid="panel-editor" />, []);

    const InspectorPanelMounted = useCallback(() => <div data-testid="panel-inspector" />, []);

    // Wrapped in the same `data-testid="panel-problems"` / `data-component`
    // container `ProblemsPanel.tsx` (the DEFAULT_PANEL_REGISTRY entry for
    // `workspace.problems`) uses — this perspective overrides that registry
    // entry to pass `onNavigate`, but the override previously rendered
    // `DiagnosticsPanel` bare, silently dropping the wrapper markers every
    // other consumer of the `workspace.problems` panel id relies on (found
    // live against production: `panel-problems` never mounts in the Explore
    // perspective, the perspective every prod-ux journey exercises, breaking
    // any locator scoped to that testid).
    const ProblemsPanelMounted = useCallback(
      () => (
        <div data-testid="panel-problems" data-component="workspace.problems" className="h-full">
          <DiagnosticsPanel
            fileDiagnostics={combinedFileDiagnostics}
            onNavigate={(uri) => {
              const normPath = uri.startsWith('file://') ? uri.slice(7) : uri;
              const fileName = normPath.split('/').pop() ?? normPath;
              const file = files.find(
                (f) => f.path === normPath || f.name === fileName || normPath.endsWith(f.path ?? '')
              );
              if (file) requestSourceFile(file.path ?? file.name);
            }}
          />
        </div>
      ),
      [combinedFileDiagnostics, files, requestSourceFile]
    );

    // Stable adapter for CodePreviewPanel cross-file source-map navigation.
    const sourceEditorHandle = useMemo<SourceEditorHandle>(
      () => ({
        revealPosition: (position, filePath) => sourceEditorRef.current?.revealPosition(position, filePath)
      }),
      // Intentionally stable — reads ref.current at call time.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

    // CodePreviewPanel is a pure-display consumer of useCodegenStore. The codegen
    // worker is owned by CodegenProvider (mounted by StudioProviders), which feeds
    // results into the store; the panel renders from that store unconditionally.
    const CodePreviewPanelMounted = useCallback(
      () => <CodePreviewPanel sourceEditorRef={sourceEditorHandle} files={files} />,
      [files, sourceEditorHandle]
    );

    const FormPreviewPanelMounted = useCallback(() => <FormPreviewPanelShell />, []);

    const renderGraphPane = useCallback(
      () => (
        <section
          aria-label="Graph"
          data-testid="panel-visualPreview"
          data-component="workspace.visualPreview"
          className="flex h-full min-h-0 flex-col overflow-hidden"
        >
          <div
            role="toolbar"
            aria-label="Graph toolbar"
            className="glass-toolbar flex flex-wrap items-center gap-1 border-b border-border px-2 py-1"
          >
            <Button
              variant="glass"
              size="xs"
              onClick={handleFitView}
              title="Fit to view"
              disabled={visibleGraphCount === 0}
            >
              <Maximize2 />
              Fit View
            </Button>
            <Button
              variant="glass"
              size="xs"
              onClick={handleRelayout}
              title="Re-run auto layout"
              disabled={visibleGraphCount === 0}
            >
              <LayoutGrid />
              Re-layout
            </Button>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Button
              variant="glass"
              aria-pressed={focusMode}
              size="xs"
              onClick={handleToggleFocusMode}
              title="Show the selected type, its inheritance chain, and its direct references only"
            >
              <Network />
              Focus
            </Button>
            <Button
              variant="glass"
              aria-pressed={groupedLayout}
              size="xs"
              onClick={handleToggleGroupedLayout}
              title="Group by inheritance trees"
            >
              <LayoutGrid />
              Grouped
            </Button>
          </div>
          <div ref={setGraphContainerRef} className="min-h-0 flex-1 relative studio-graph-canvas">
            <RuneTypeGraph
              ref={graphRef}
              navigationTarget={currentNavigationTarget}
              config={{
                // 'LR' is a safe default — the ResizeObserver corrects direction on the first frame
                // once the container is measured. The container dimensions aren't available yet here.
                layout: {
                  engine: storeLayoutEngine,
                  direction: graphLayoutDirection,
                  groupByInheritance: groupedLayout
                },
                showControls: visibleGraphCount > 0,
                showMinimap: false,
                readOnly: false
              }}
              callbacks={{
                onNodeDoubleClick: () => {},
                onModelChanged: handleModelChanged,
                onLayoutEngineChange: storeSetLayoutEngine,
                onNavigateToType: navigateToNode
              }}
            />
            {visibleGraphCount === 0 && (
              <div
                data-testid="graph-empty-state"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center"
              >
                <p className="text-sm font-medium">No types are visible in Graph</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Open a type by its name or arrow in Type explorer. Dragging a type changes an association without
                  navigating.
                </p>
                {selectedNodeId && nodeRepository.byId(selectedNodeId) && (
                  <Button variant="secondary" size="sm" onClick={() => navigateToNode(selectedNodeId)}>
                    Show selected type
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      ),
      [
        currentNavigationTarget,
        visibleGraphCount,
        selectedNodeId,
        nodeRepository,
        focusMode,
        groupedLayout,
        graphLayoutDirection,
        handleFitView,
        handleModelChanged,
        handleRelayout,
        handleToggleFocusMode,
        handleToggleGroupedLayout,
        navigateToNode,
        storeLayoutEngine,
        storeSetLayoutEngine,
        setGraphContainerRef
      ]
    );

    const renderSourcePane = useCallback(() => {
      const activeFile = sourceEditorFiles[0];
      const sourcePending = Boolean(activeFile?.refOnly && !activeFile.sourceLoaded && activeFile.content.length === 0);
      const fileExt = activeFile?.name.includes('.') ? `.${activeFile.name.split('.').pop()}` : null;
      const lineEnding = activeFile?.content.includes('\r\n') ? 'CRLF' : 'LF';
      const lineCount = activeFile?.content.split('\n').length ?? 0;
      return (
        <div ref={sourcePaneRef} className="flex flex-col min-h-0 h-full">
          <div className="studio-source-meta" aria-label="Source file path">
            {fileExt && <span className="studio-source-meta__pill">{fileExt}</span>}
            <span className="studio-source-meta__path">{activeFile?.path ?? '—'}</span>
            <span className="studio-source-meta__spacer" />
            {activeFile && !sourcePending && (
              <span className="studio-source-meta__stat">
                UTF-8 · {lineEnding} · {lineCount} lines
              </span>
            )}
          </div>
          {sourcePending ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
              {sourceLoadError && sourceLoadError.path === activeFile?.path
                ? `Source unavailable: ${sourceLoadError.message}`
                : 'Loading source…'}
            </div>
          ) : (
            <SourceEditor
              ref={sourceEditorRef}
              files={sourceEditorFiles}
              activeFile={activeEditorFile}
              lspClient={lspClient}
              lspReady={lspReady}
              onFileSelect={(path) => setActiveEditorFile(path)}
              onContentChange={handleSourceChange}
              onNavigateToNode={handleSourceNavigateToNode}
              onEditorViewCreated={handleEditorViewCreated}
              hideTabs
            />
          )}
        </div>
      );
    }, [
      sourceEditorFiles,
      sourceLoadError,
      activeEditorFile,
      lspClient,
      lspReady,
      handleSourceChange,
      handleSourceNavigateToNode,
      handleEditorViewCreated
    ]);

    // Namespaces that belong to refOnly curated files. Earlier revisions
    // inferred this by matching `deferredExports[i].filePath.split('/')[0]`
    // against loaded refOnly bundle ids — that false-positive'd for user
    // files saved under `${bundleId}/foo.rosetta` paths (Codex P2 review
    // of PR #163). The correct anchor is the workspace file's `refOnly`
    // flag itself; we resolve each refOnly file's server-side filePath
    // (the form the server emits in deferredExports, which is
    // `${bundleId}/${pathInBundle}` without the studio's bracket prefix)
    // and look up the matching deferredExports entry to recover the
    // namespace. Pure intersection — no inference required.
    const refOnlyNamespaces = useMemo(() => {
      if (deferredExports.length === 0) return new Set<string>();
      const refOnlyServerPaths = new Set<string>();
      for (const f of files) {
        if (!f.refOnly) continue;
        const m = /^\[([^\]]+)\]\/(.*)$/.exec(f.path);
        if (m) refOnlyServerPaths.add(`${m[1]}/${m[2]}`);
      }
      if (refOnlyServerPaths.size === 0) return new Set<string>();
      const ns = new Set<string>();
      for (const d of deferredExports) {
        if (refOnlyServerPaths.has(d.filePath)) ns.add(d.namespace);
      }
      return ns;
    }, [files, deferredExports]);

    const selectedNodeIsRefOnly = useMemo(() => {
      const namespace = selectedNodeMeta?.namespace;
      return !!(namespace && refOnlyNamespaces.has(namespace));
    }, [selectedNodeMeta, refOnlyNamespaces]);

    const selectedExpressionFile = files.find((file) => file.path === selectedSourceFilePath);
    const selectedParsedModel = parsedModels?.find((entry) => entry.filePath === selectedSourceFilePath);
    const isParsedFileCurrent = useCallback(
      (file: WorkspaceFile | undefined) => {
        const parsed = file ? parsedModels?.find((entry) => entry.filePath === file.path) : undefined;
        return Boolean(file && parsed?.source === file.content && !parseErrors.get(file.path)?.length);
      },
      [parsedModels, parseErrors]
    );
    const selectedParseCurrent = isParsedFileCurrent(selectedExpressionFile);
    const metadataContext = useLatestRef({
      scope: inspectorScope,
      canEdit: (nodeId: string) => {
        const node = useEditorStore.getState().nodesById.get(nodeId);
        if (!node || node.meta.isReadOnly) return false;
        const path = resolveEditorFilePath(resolveNodeFile(node.data, node.meta), files);
        const file = files.find((candidate) => candidate.path === path);
        if (!file || file.refOnly || file.readOnly) return false;
        return isParsedFileCurrent(file);
      }
    });
    const metadataActions = useMemo(
      () => createScopedMetadataActions(inspectorScope, () => metadataContext.current, useEditorStore.getState()),
      [inspectorScope, metadataContext]
    );

    const renderFunctionBodyEditor = useCallback(
      (props: FunctionBodyEditorSlotProps) => (
        <ExpressionWorkspace
          key={`${workspaceId}:${props.nodeId}`}
          {...props}
          sourceOwner={
            selectedNodeData?.$type === 'RosettaFunction' || selectedNodeData?.$type === 'Data'
              ? selectedNodeData
              : undefined
          }
          file={selectedExpressionFile}
          dependencySnapshot={files}
          parsed={selectedParsedModel}
          loadScope={(region) =>
            requestExpressionScope(selectedExpressionFile!.path, props.nodeId, region, files).then(
              expressionScopeFromEntries
            )
          }
          documents={expressionDocuments}
          parseCurrent={selectedParseCurrent}
          onContentChange={handleSourceChange}
          onOpenSource={() => {
            if (selectedSourceFilePath) requestSourceFile(selectedSourceFilePath);
          }}
          lspClient={lspClient}
          lspReady={lspReady}
          sourceError={
            sourceLoadError && sourceLoadError.path === selectedSourceFilePath ? sourceLoadError.message : undefined
          }
        />
      ),
      [
        workspaceId,
        selectedNodeData,
        selectedExpressionFile,
        files,
        selectedParsedModel,
        expressionDocuments,
        selectedParseCurrent,
        handleSourceChange,
        selectedSourceFilePath,
        requestSourceFile,
        lspClient,
        lspReady,
        sourceLoadError
      ]
    );

    const renderExpressionEditor = useCallback(
      (props: ExpressionEditorSlotProps) =>
        props.target ? (
          <ExpressionWorkspace
            key={`${workspaceId}:${props.target.nodeId}:${props.target.kind}:${props.target.index}`}
            nodeId={props.target.nodeId}
            target={props.target}
            readOnly={Boolean(props.readOnly)}
            sourceOwner={
              selectedNodeData?.$type === 'RosettaFunction' || selectedNodeData?.$type === 'Data'
                ? selectedNodeData
                : undefined
            }
            file={selectedExpressionFile}
            dependencySnapshot={files}
            parsed={selectedParsedModel}
            loadScope={(region) =>
              requestExpressionScope(selectedExpressionFile!.path, props.target!.nodeId, region, files).then(
                expressionScopeFromEntries
              )
            }
            documents={expressionDocuments}
            parseCurrent={selectedParseCurrent}
            onContentChange={handleSourceChange}
            onOpenSource={() => {
              if (selectedSourceFilePath) requestSourceFile(selectedSourceFilePath);
            }}
            lspClient={lspClient}
            lspReady={lspReady}
            sourceError={
              sourceLoadError && sourceLoadError.path === selectedSourceFilePath ? sourceLoadError.message : undefined
            }
          />
        ) : (
          <ExpressionBuilder {...props} scope={functionScope} />
        ),
      [
        workspaceId,
        selectedNodeData,
        selectedExpressionFile,
        files,
        selectedParsedModel,
        expressionDocuments,
        selectedParseCurrent,
        handleSourceChange,
        selectedSourceFilePath,
        requestSourceFile,
        lspClient,
        lspReady,
        sourceLoadError,
        functionScope
      ]
    );

    useEffect(() => {
      if (
        !navigationRevision ||
        inspectorArrivalRevisionRef.current === navigationRevision ||
        !selectedNodeData ||
        selectedNodeMeta?.deferred ||
        !inspectorArrivalRef.current
      )
        return;
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      let arrivalFrame: number | undefined;
      const frame = requestAnimationFrame(() => {
        arrivalFrame = requestAnimationFrame(() => {
          if (cancelled || !inspectorArrivalRef.current) return;
          inspectorArrivalRevisionRef.current = navigationRevision;
          cleanup = emphasizeNavigationArrival(inspectorArrivalRef.current);
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        if (arrivalFrame !== undefined) cancelAnimationFrame(arrivalFrame);
        cleanup?.();
      };
    }, [navigationRevision, selectedNodeData, selectedNodeMeta?.deferred]);

    const renderInspectorPane = useCallback(
      () => (
        <div ref={inspectorArrivalRef} className="studio-scroll flex flex-col min-h-0 h-full overflow-hidden">
          <EditorFormPanel
            nodeData={selectedNodeData}
            meta={selectedNodeMeta}
            nodeId={selectedNodeId}
            refOnly={selectedNodeIsRefOnly}
            isHydrating={selectedNodeIsHydrating}
            availableTypes={availableTypes}
            synonymSourceOptions={synonymSourceOptions}
            actions={editorActions}
            metadataActions={metadataActions}
            scopeKey={inspectorScope}
            parseEpoch={storeParseEpoch}
            registerCommitFlush={formCommitRegistry.register}
            allNodes={storeNodes}
            nodeRepository={nodeRepository}
            renderExpressionEditor={renderExpressionEditor}
            renderFunctionBodyEditor={renderFunctionBodyEditor}
            structuralEditsDisabled={
              !selectedNodeIsRefOnly &&
              !selectedExpressionFile?.readOnly &&
              (selectedNodeType === 'RosettaFunction' || selectedNodeType === 'Data') &&
              !selectedParseCurrent
            }
            compactConditions
            onClose={() => {
              /* pane visibility handled by paneswitch */
            }}
            onNavigateToNode={navigateToNode}
          />
        </div>
      ),
      [
        metadataActions,
        inspectorScope,
        storeParseEpoch,
        formCommitRegistry,
        selectedNodeData,
        selectedNodeMeta,
        selectedNodeId,
        selectedNodeIsRefOnly,
        selectedNodeIsHydrating,
        availableTypes,
        synonymSourceOptions,
        editorActions,
        storeNodes,
        nodeRepository,
        renderExpressionEditor,
        renderFunctionBodyEditor,
        selectedNodeType,
        selectedParseCurrent,
        selectedExpressionFile,
        navigateToNode
      ]
    );

    // Structure pane — focusedTypeId gated by node $type (Data / Choice / Enum only)
    const structureFocusedTypeId = useMemo(() => {
      if (!selectedNodeId) return undefined;
      // Phase C — Functions are now a supported structure-view root alongside
      // Data / Choice / Enum.
      if (
        selectedNodeType === 'Data' ||
        selectedNodeType === 'Choice' ||
        selectedNodeType === 'RosettaEnumeration' ||
        selectedNodeType === 'RosettaFunction'
      )
        return selectedNodeId;
      // Unsupported kind — pass undefined so StructureView shows its empty-selection state
      return undefined;
    }, [selectedNodeId, selectedNodeType]);

    // e2e-batch fix #10: when the user has selected a type whose kind isn't
    // supported in Structure View, expose the name + kind so the empty state can
    // explain WHY the pane is blank instead of repeating the generic prompt.
    // Selected-but-supported types fall through to the regular focused-type
    // render path; unsupported types produce { name, kind } for the targeted
    // empty state in StructureView.
    const structureUnsupportedSelectedType = useMemo<{ name: string; kind: string } | undefined>(() => {
      if (!selectedNodeId || structureFocusedTypeId) return undefined;
      if (!selectedNodeType) return undefined;
      const node = nodeRepository.byId(selectedNodeId);
      const name = (node?.data as { name?: string } | undefined)?.name ?? nameFromNodeId(selectedNodeId);
      // Map AST $type → user-friendly kind label. Codex review (e2e-batch
      // adversarial) flagged the previous map as non-exhaustive — it omitted
      // RosettaTypeAlias, RosettaBasicType, RosettaSynonymSource,
      // RosettaExternalFunction, RosettaMetaType, RosettaBody, RosettaCorpus,
      // RosettaSegment, RosettaExternalRuleSource, RosettaReport, RosettaRule,
      // any of which a user could select from the explorer. Missing entries
      // previously fell through to the raw $type string (ugly but not crash-y);
      // now we cover the common cases AND `formatUnknownKind` strips the
      // `Rosetta` prefix + inserts spaces so unmapped types still render as
      // "Type alias" / "Basic type" / "Synonym source" etc.
      const KIND_LABEL: Record<string, string> = {
        Function: 'Function',
        RosettaFunction: 'Function',
        TypeAlias: 'Type alias',
        RosettaTypeAlias: 'Type alias',
        Record: 'Record',
        RosettaRecordType: 'Record',
        RosettaBasicType: 'Basic type',
        Annotation: 'Annotation',
        RosettaMetaType: 'Meta type',
        RosettaSynonymSource: 'Synonym source',
        RosettaExternalFunction: 'External function',
        RosettaBody: 'Body',
        RosettaCorpus: 'Corpus',
        RosettaSegment: 'Segment',
        RosettaExternalRuleSource: 'External rule source',
        RosettaReport: 'Report',
        RosettaRule: 'Rule'
      };
      return { name, kind: KIND_LABEL[selectedNodeType] ?? formatUnknownKind(selectedNodeType) };
    }, [selectedNodeId, selectedNodeType, structureFocusedTypeId, nodeRepository]);

    const adapterDocument = useMemo(
      () => (storeNodes.length > 0 ? graphNodesToAdapterDocument(storeNodes) : undefined),
      [storeNodes]
    );

    // Memoize cell components to preserve prop identity across renders — avoids
    // unnecessary ReactFlow reconciliation when unrelated EditorPage state changes.
    // InheritanceCell is not included here because GroupContainerNode (the base-type
    // wrap) does not expose a cell-injection API; that wiring is a future addition.
    const structureCellComponents = useMemo(
      () => ({
        name: NameCell,
        type: TypePickerCell,
        card: CardinalityCell
      }),
      []
    );

    // ---------------------------------------------------------------------------
    // Spec §8 / §3.3 — enum-nav callback for StructureView (affordance 1).
    // Sets the focused type in the structure pane to the given enum typeId,
    // which re-roots the structure graph on that enum. Also selects the node
    // in the editor store so the inspector + other panels stay in sync.
    // ---------------------------------------------------------------------------
    const handleStructureNavigateToEnumType = useCallback(
      (typeId: string) => {
        requestNavigationArrival(typeId);
        storeSelectNode(typeId, { reapplyFocusMode: false });
      },
      [storeSelectNode, requestNavigationArrival]
    );

    // ---------------------------------------------------------------------------
    // Spec §3.4 — diagnostic left-edge marker for StructureView (affordance 3).
    //
    // Strategy (approach b from spec §3.4):
    //   1. Derive the file URI for the currently focused type from its nodeId.
    //   2. Retrieve LSP diagnostics for that URI from the diagnostics store.
    //   3. Precompute a `lineOffsets` array from the file's source text where
    //      `lineOffsets[line] = character offset of the start of that line`.
    //      Converting an LSP line/character pair to a character offset is then
    //      O(1) direct indexing: `lineOffsets[line] + character`. (The reverse
    //      conversion — offset → line — would need binary search; the previous
    //      comment claimed binary search here in error. Copilot caught it.)
    //   4. Map each LspDiagnostic to a RangeDiagnostic and pass the resulting
    //      array into StructureView. DataNode calls useDiagnosticsForRange per row.
    //
    // Keeping the conversion here (rather than in a hook or in DataNode) lets
    // the memoized lineOffsets array amortize the cost across all rows in one
    // render pass instead of recomputing it once per row.
    //
    // **astRange-threading gap (deferred PR #207 follow-up):** in studio-created
    // rows today, `StructureRow.astRange` is `undefined` because
    // `graphNodesToAdapterDocument` forwards attributes from the dehydrated
    // node data (which carries no `$cstNode`) and never derives an
    // offset range. The wiring on this side (RangeDiagnostic[] → StructureView →
    // useDiagnosticsForRange) is correct and exercised by synthetic tests; the
    // severity marker just won't fire in production until upstream threading
    // lands.
    // ---------------------------------------------------------------------------

    // Resolve file path for the focused structure node (ns.TypeName format).
    const structureFilePath = useMemo(() => {
      if (!structureFocusedTypeId) return undefined;
      return nodeIdToFilePath.get(structureFocusedTypeId);
    }, [structureFocusedTypeId, nodeIdToFilePath]);

    // Source text for the focused file (to build lineOffsets).
    const structureFileContent = useMemo(() => {
      if (!structureFilePath) return undefined;
      return files.find((f) => f.path === structureFilePath)?.content;
    }, [structureFilePath, files]);

    // Precomputed lineOffsets: lineOffsets[i] = character offset of the start
    // of line i in structureFileContent. Direct-indexed (O(1)) for the
    // line/character → offset conversion in `structureDiagnostics` below.
    const structureLineOffsets = useMemo<readonly number[]>(() => {
      if (!structureFileContent) return [];
      const offsets: number[] = [0];
      for (let i = 0; i < structureFileContent.length; i++) {
        if (structureFileContent[i] === '\n') {
          offsets.push(i + 1);
        }
      }
      return offsets;
    }, [structureFileContent]);

    // Raw LSP diagnostics for the focused file.
    // `fileDiagnostics` is already subscribed at line ~968 via useDiagnosticsStore() —
    // reuse that reference here; no duplicate subscriber needed.
    const structureLspDiagnostics = useMemo(() => {
      if (!structureFilePath) return undefined;
      const uri = pathToUri(structureFilePath);
      return fileDiagnostics.get(uri);
    }, [structureFilePath, fileDiagnostics]);

    // Convert LSP diagnostics (line/character) to RangeDiagnostic (character offsets).
    const structureDiagnostics = useMemo<readonly RangeDiagnostic[]>(() => {
      if (!structureLspDiagnostics || structureLspDiagnostics.length === 0 || structureLineOffsets.length === 0) {
        return EMPTY_RANGE_DIAGNOSTICS;
      }
      const result: RangeDiagnostic[] = [];
      const lineCount = structureLineOffsets.length;
      for (const d of structureLspDiagnostics) {
        const startLine = d.range.start.line;
        const endLine = d.range.end.line;
        // Skip diagnostics whose line indices are out of bounds for the current
        // source — this happens when source has changed but the diagnostic store
        // hasn't caught up. Previously falling back to offset 0 would map stale
        // diagnostics to the start of the file and produce false-positive markers
        // on completely unrelated rows. Copilot caught this on PR #207.
        if (startLine >= lineCount || endLine >= lineCount) continue;
        const start = structureLineOffsets[startLine]! + d.range.start.character;
        const end = structureLineOffsets[endLine]! + d.range.end.character;
        if (end > start) {
          result.push({ start, end, severity: d.severity ?? 3, message: d.message });
        }
      }
      return result.length > 0 ? result : EMPTY_RANGE_DIAGNOSTICS;
    }, [structureLspDiagnostics, structureLineOffsets]);

    const renderStructurePane = useCallback(
      () => (
        <div className="h-full min-h-0 studio-graph-canvas">
          <StructureView
            focusedTypeId={structureFocusedTypeId}
            navigationRevision={navigationRevision}
            adapterDoc={adapterDocument}
            expansionMap={expansionMap}
            cellComponents={structureCellComponents}
            onToggleExpansion={toggleExpansion}
            unsupportedSelectedType={structureUnsupportedSelectedType}
            onNodeSelect={(canonicalId) => storeSelectNode(canonicalId, { reapplyFocusMode: false })}
            onNavigateToEnumType={handleStructureNavigateToEnumType}
            structureDiagnostics={structureDiagnostics}
            pendingHydrationNamespaces={pendingHydrationNamespaces}
          />
        </div>
      ),
      [
        navigationRevision,
        structureFocusedTypeId,
        adapterDocument,
        expansionMap,
        structureCellComponents,
        toggleExpansion,
        structureUnsupportedSelectedType,
        storeSelectNode,
        handleStructureNavigateToEnumType,
        structureDiagnostics,
        pendingHydrationNamespaces
      ]
    );

    const VisualPreviewPanelMounted = useCallback(
      () => (
        <CenterStackPanel
          renderGraph={renderGraphPane}
          renderSource={renderSourcePane}
          renderInspector={renderInspectorPane}
          renderStructure={renderStructurePane}
        />
      ),
      [renderGraphPane, renderSourcePane, renderInspectorPane, renderStructurePane]
    );

    // Memoize the overrides object so DockShell's useMemo([panelComponents])
    // only recomputes the dockview component map when a callback actually changes,
    // not on every EditorPage render.
    const panelComponents = useMemo(
      () => ({
        'workspace.fileTree': FileTreePanelMounted,
        'workspace.editor': SourceEditorPanelMounted,
        'workspace.inspector': InspectorPanelMounted,
        'workspace.problems': ProblemsPanelMounted,
        'workspace.visualPreview': VisualPreviewPanelMounted,
        'workspace.formPreview': FormPreviewPanelMounted,
        'workspace.codePreview': CodePreviewPanelMounted
      }),
      [
        FileTreePanelMounted,
        SourceEditorPanelMounted,
        InspectorPanelMounted,
        ProblemsPanelMounted,
        VisualPreviewPanelMounted,
        FormPreviewPanelMounted,
        CodePreviewPanelMounted
      ]
    );

    const totalProblemCount = useMemo(() => combinedDiagnostics.total, [combinedDiagnostics.total]);
    const panelTabMeta = useMemo(
      () => ({
        'workspace.problems': { count: totalProblemCount }
      }),
      [totalProblemCount]
    );
    const focusPanelRequest = useMemo(
      () =>
        inspectorFocusNonce > 0 ? { component: 'workspace.inspector' as const, nonce: inspectorFocusNonce } : null,
      [inspectorFocusNonce]
    );

    // Empty-content guard (keep-alive hazard): ExplorePerspective is ALWAYS
    // mounted by PerspectiveHost (display:none when inactive), including before
    // any user files OR reference models exist. With neither editable files,
    // materialized models, nor deferred curated exports, the dockview/graph/
    // structure workbench has nothing meaningful to render, and mounting
    // DockShell against an empty corpus risks running layout/effects with no
    // graph data. Deferred-only curated loads are valid Explore content because
    // loadModels([]) materializes placeholder nodes from deferredExports.
    if (fileCount === 0 && models.length === 0 && deferredExports.length === 0) {
      return <div data-testid="explore-workbench" className="flex flex-col h-full overflow-hidden" />;
    }

    return (
      <div
        className="flex flex-col h-full overflow-hidden"
        data-testid="explore-workbench"
        onKeyDown={handleEditorPageKeyDown}
        tabIndex={-1}
      >
        <div className="flex flex-1 min-h-0">
          <SourceNavigationFeedbackContext.Provider
            value={
              activeEditorFile &&
              sourceLoadError?.path !== activeEditorFile &&
              (loadingSourcePaths.has(activeEditorFile) ||
                sourceEditorFiles.some(
                  (file) =>
                    file.path === activeEditorFile &&
                    (Boolean(file.namespace && pendingHydrationNamespaces.includes(file.namespace)) ||
                      !file.refOnly ||
                      file.sourceLoaded ||
                      file.content.length > 0)
                ))
                ? pendingFileArrival?.filePath === activeEditorFile && pendingFileArrival.workspaceId === workspaceId
                  ? pendingFileArrival
                  : sourceNavigationPending &&
                      sourceNavigationPending.nodeId === selectedNodeId &&
                      sourceNavigationPending.workspaceId === workspaceId &&
                      sourceNavigationPending.filePath === activeEditorFile
                    ? sourceNavigationPending
                    : null
                : null
            }
          >
            <DockShell
              studioVersion={studioVersion}
              workspaceId={workspaceId}
              focusPanel={focusPanelRequest}
              panelComponents={panelComponents}
              panelTabMeta={panelTabMeta}
              onNavigateBack={navigateBack}
              onNavigateForward={navigateForward}
              canNavigateBack={canGoBack}
              canNavigateForward={canGoForward}
            />
          </SourceNavigationFeedbackContext.Provider>
        </div>

        <footer className="glass-statusbar flex items-center gap-4 px-3 py-1 text-xs text-muted-foreground border-t border-border">
          <span>
            {models.length} model{models.length === 1 ? '' : 's'}
          </span>
          <span>{files.filter((f) => f.dirty).length} modified</span>
          {selectedNodeId && <span>{selectedNodeId}</span>}
          {(combinedDiagnostics.errors > 0 || combinedDiagnostics.warnings > 0) && (
            <span>
              {combinedDiagnostics.errors} err / {combinedDiagnostics.warnings} warn
            </span>
          )}
          {transportState && <LspConnectionBadge state={transportState} onRetry={onReconnect} />}
          {transportState && <ConnectionStatus state={transportState} onReconnect={onReconnect} />}
        </footer>

        <ExportDialog
          open={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          getUserFiles={getSerializedFiles}
          validateModel={validateModelForExport}
        />

        <ImportDialog
          open={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          files={files}
          onFilesChange={(next) => onFilesChange?.(next)}
          onFileFocused={openFileInSource}
          namespaceToFile={namespaceToFile}
          optionsFormsByFormat={IMPORT_OPTIONS_FORMS_BY_FORMAT}
        />

        {/*
    Curated Models dialog — reuses the same <ModelLoader /> the welcome
    screen mounts. ModelLoader pulls from useModelStore directly so no
    props need to be threaded through. We leave the dialog open after a
    load click so the user can see progress/badges. Dismiss paths
    (Radix defaults): Esc, the X close button, AND click on the overlay
    outside the dialog content — all close via `onOpenChange(false)`.
    If "Esc only / outside-click does nothing" is ever wanted, attach
    `onInteractOutside={(e) => e.preventDefault()}` to DialogContent
    (Copilot review on PR #215). A future task will replace this with
    a bottom-bar multi-selector — see PR description.
  */}
        <Dialog open={showCuratedModels} onOpenChange={setShowCuratedModels}>
          <DialogContent
            className="w-[640px] max-w-[92vw] max-h-[80vh] overflow-y-auto"
            data-testid="curated-models-dialog"
            overlayProps={{ 'data-testid': 'curated-models-dialog-overlay' }}
          >
            <DialogHeader>
              <DialogTitle>Reference Models</DialogTitle>
              <DialogDescription>
                Load curated reference bundles to explore them alongside your workspace.
              </DialogDescription>
            </DialogHeader>
            <ModelLoader />
          </DialogContent>
        </Dialog>
      </div>
    );
  },
  { op: 'ExplorePerspective' }
);
