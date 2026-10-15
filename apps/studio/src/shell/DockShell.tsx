// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * DockShell — host for the locked Studio panels, backed by `dockview-react`.
 *
 * Responsibilities:
 *  - register the locked panel components by their names
 *    (`workspace.fileTree` etc., from contracts/dockview-panel-registry.md)
 *  - apply the saved `PanelLayoutRecord` on mount via the bridge:
 *      • factory-shape layout (fresh / Reset)  → addPanel calls
 *      • dockview-native layout (returning user) → api.fromJSON
 *  - serialize the live layout via `api.toJSON()` on each onDidLayoutChange
 *    and forward to the workspace persistence layer
 *  - install the keyboard shortcut layer
 *  - expose Reset Layout as a button (command-palette wiring lands in Phase 8)
 *
 * In jsdom (vitest) the real DockviewReact can't render — its layout
 * engine depends on getBoundingClientRect / ResizeObserver. Tests mock
 * the `dockview-react` module and assert through plain DOM. The component
 * continues to mount the panel ARIA-host elements directly so role/test
 * assertions remain reachable.
 */

import { recordOperation } from '../services/operation-feedback.js';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { ComponentType } from 'react';
import type { DockviewApi, IDockviewHeaderActionsProps } from 'dockview-react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLatestRef } from '@rune-langium/visual-editor';
import { FileTreePanel } from './panels/FileTreePanel.js';
import { EditorPanel } from './panels/EditorPanel.js';
import { InspectorPanel } from './panels/InspectorPanel.js';
import { ProblemsPanel } from './panels/ProblemsPanel.js';
import { ActivityPanel } from './panels/ActivityPanel.js';
import { OutputPanel } from './panels/OutputPanel.js';
// VisualPreviewPanel removed in Phase 7.5 — structure view is now a peer
// segment in CenterStackPanel wired from EditorPage.
import { FormPreviewPanel } from './panels/FormPreviewPanel.js';
import { CodePreviewPanel as CodePreviewPanelShell } from './panels/CodePreviewPanel.js';
import { buildDefaultLayout, LAYOUT_SCHEMA_VERSION, PANEL_COMPONENT_NAMES, PANEL_TITLES } from './layout-factory.js';
import type { LayoutPreset } from './layout-factory.js';
import { sanitizeLayoutWithDiagnostics } from './layout-migrations.js';
import { applyLayout } from './dockview-bridge.js';
import { WorkbenchHost, resetWorkbench } from './WorkbenchHost.js';
import type { WorkbenchDefinition } from './workbench-types.js';
import { installShellShortcuts, type ShellAction } from './keyboard.js';
import type { PanelLayoutRecord } from '../workspace/persistence.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { Alert, AlertDescription } from '@rune-langium/design-system/ui/alert';
import { IconButtonGroup } from '@rune-langium/design-system/ui/icon-button-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@rune-langium/design-system/ui/tooltip';
import { UtilityTrayContext, type UtilityGroupApi } from './utility-tray-context.js';
import { UtilityHeaderActionsContext, UtilityHeaderActionsProvider } from './utility-header-actions-context.js';
import { PerspectiveHeading } from './perspectives/PerspectiveHeading.js';
import { CenterPanesContext, type CenterPane } from './center-panes-context.js';
import { useExploreFileNavStore } from './explore-file-nav-store.js';
import { useStudioToast } from '../components/StudioToastProvider.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { StudioDockTab, type StudioDockTabParams } from './StudioDockTab.js';
import { useDesignPreviewStore } from '../store/design-preview-store.js';
import { PanelCollapseButton } from './PanelCollapseButton.js';

const UTILITY_PANEL_IDS = new Set(['workspace.problems', 'workspace.activity', 'workspace.output']);

/**
 * Right-side actions rendered in the dockview group header (FIRST row).
 * For the utility tray group only: the active panel's published toolbar
 * (filters / "..." — see utility-header-actions-context) followed by the
 * open/close chevron. Living in the tab row keeps the whole toolbar
 * visible while the tray is collapsed to header height.
 */
function UtilityGroupHeaderActions(props: IDockviewHeaderActionsProps) {
  const { actions } = useContext(UtilityHeaderActionsContext);
  const { utilitiesCollapsed, toggleUtilities } = useContext(UtilityTrayContext);
  // Use `api.component` (the registered component name, e.g.
  // "workspace.problems") rather than `activePanel.id` — in native (fromJSON)
  // layouts dockview may assign a different panel id (e.g. "p-problems"), so
  // id-based lookup misses the header-actions registry entry and the chevron.
  const activeComponent = props.activePanel?.api.component;
  if (!activeComponent || !UTILITY_PANEL_IDS.has(activeComponent)) return null;
  // Pass this header's own group API so the tween resizes THIS group, not
  // whichever utility panel the global panel search happens to find first.
  const groupApi = props.group.api as unknown as UtilityGroupApi;
  return (
    <div className="studio-panel-actions mr-1" aria-label="Utility panel actions">
      {actions.get(activeComponent) ?? null}
      <PanelCollapseButton
        label="Problems & Messages"
        collapsed={utilitiesCollapsed}
        direction="bottom"
        onToggle={() => toggleUtilities(groupApi)}
        testId="toggle-utilities-chevron"
      />
    </div>
  );
}

const DEFAULT_VIEWPORT_WIDTH = 1920;
const DEFAULT_UTILITY_HEIGHT = 220;
// Collapsed target keeps the group's tabs-and-actions row (first row —
// tabs, panel actions, open/close chevron) fully visible; matches
// BOTTOM_GROUP_MIN_HEIGHT in dockview-bridge.ts.
const COLLAPSED_UTILITY_HEIGHT = 42;
const _PRESET_OPTIONS: Array<{ id: LayoutPreset; label: string }> = [
  { id: 'navigate', label: 'Navigate' },
  { id: 'edit', label: 'Edit' },
  { id: 'preview', label: 'Preview' }
] as const;

const _CENTER_PANE_OPTIONS: Array<{ id: CenterPane; label: string; panel: string }> = [
  { id: 'graph', label: 'Graph', panel: 'workspace.visualPreview' },
  { id: 'structure', label: 'Structure', panel: 'workspace.visualPreview' },
  { id: 'source', label: 'Source', panel: 'workspace.editor' },
  { id: 'inspector', label: 'Inspector', panel: 'workspace.inspector' }
];

type PanelTabMeta = StudioDockTabParams;

type PanelComponentName = (typeof PANEL_COMPONENT_NAMES)[number];
type PanelOverrides = Partial<Record<PanelComponentName, ComponentType>>;

interface DockShellProps {
  studioVersion: string;
  workspaceId: string;
  initialLayout?: PanelLayoutRecord | null;
  focusPanel?: { component: PanelComponentName; nonce: number } | null;
  /**
   * Override one or more panels with real content. Components are
   * rendered from a stable dockview panel bridge. Tests omit this
   * (the default stub panels are reachable via test-id); the live app
   * supplies real components from EditorPage so the dock shell hosts
   * the working studio surface.
   */
  panelComponents?: PanelOverrides;
  onLayoutChange?: (layout: PanelLayoutRecord) => void;
  onAction?: (action: ShellAction) => void;
  panelTabMeta?: Partial<Record<PanelComponentName, PanelTabMeta>>;
  /**
   * Node-visit history navigation (back/forward), owned by ExplorePerspective
   * (navigateBack/navigateForward + navigationHistoryRef/navigationForwardRef).
   * Both callbacks must be supplied together for the toolbar buttons to render.
   */
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
}

type PanelRegistry = Record<PanelComponentName, ComponentType>;

const DEFAULT_PANEL_REGISTRY: PanelRegistry = {
  'workspace.fileTree': FileTreePanel,
  'workspace.editor': EditorPanel,
  'workspace.inspector': InspectorPanel,
  'workspace.problems': ProblemsPanel,
  'workspace.activity': ActivityPanel,
  'workspace.output': OutputPanel,
  'workspace.visualPreview': () => null,
  'workspace.formPreview': FormPreviewPanel,
  'workspace.codePreview': CodePreviewPanelShell
};

function mergePanelRegistry(overrides: PanelOverrides | undefined): PanelRegistry {
  return {
    ...DEFAULT_PANEL_REGISTRY,
    ...overrides
  };
}

function applyPanelTabMeta(
  api: DockviewApi | null,
  panelTabMeta: Partial<Record<PanelComponentName, PanelTabMeta>> | undefined
): void {
  if (!api || !panelTabMeta) {
    return;
  }
  for (const [panelId, meta] of Object.entries(panelTabMeta)) {
    if (!meta) {
      continue;
    }
    api.getPanel(panelId)?.api.updateParameters(meta);
  }
}

export const DockShell = withInstrumentation(
  function DockShell({
    studioVersion,
    workspaceId,
    initialLayout,
    focusPanel,
    panelComponents,
    onLayoutChange,
    onAction,
    panelTabMeta,
    onNavigateBack,
    onNavigateForward,
    canNavigateBack,
    canNavigateForward
  }: DockShellProps): React.ReactElement {
    const getViewportWidth = () => (typeof window !== 'undefined' ? window.innerWidth : DEFAULT_VIEWPORT_WIDTH);
    const getSanitizedLayout = useCallback(
      (candidate: PanelLayoutRecord | null | undefined) =>
        sanitizeLayoutWithDiagnostics(candidate ?? null, {
          studioVersion,
          viewportWidth: getViewportWidth()
        }),
      [studioVersion]
    );
    const { showToast } = useStudioToast();
    const showToastRef = useLatestRef(showToast);
    const apiRef = useRef<DockviewApi | null>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const watchLocationLayoutRef = useRef<(api: DockviewApi) => void>(() => {});
    useEffect(() => {
      const shell = shellRef.current;
      if (!shell) return;
      let center: Element | null = null;
      const update = () => {
        const next = shell.querySelector('[data-testid="studio-paneswitch"]');
        if (!next) return;
        if (center !== next) {
          if (center) observer.unobserve(center);
          observer.observe(next);
          center = next;
        }
        const rect = next.getBoundingClientRect();
        if (rect.width > 0)
          shell.style.setProperty(
            '--rune-center-stack-start',
            `${Math.max(0, rect.left - shell.getBoundingClientRect().left)}px`
          );
      };
      const observer = new ResizeObserver(update);
      observer.observe(shell);
      let listener: { dispose(): void } | undefined;
      watchLocationLayoutRef.current = (api) => {
        listener?.dispose();
        listener = api.onDidLayoutChange(update);
        update();
      };
      if (apiRef.current) watchLocationLayoutRef.current(apiRef.current);
      const frame = requestAnimationFrame(update);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        listener?.dispose();
        watchLocationLayoutRef.current = () => {};
        shell.style.removeProperty('--rune-center-stack-start');
      };
    }, []);
    const suppressLayoutPersistenceRef = useRef(false);
    const onLayoutChangeRef = useLatestRef(onLayoutChange);

    const [layoutNotice, setLayoutNotice] = useState<string | null>(() => {
      const sanitized = getSanitizedLayout(initialLayout);
      return sanitized.notice ?? null;
    });
    const [layout, setLayout] = useState<PanelLayoutRecord>(() => getSanitizedLayout(initialLayout).layout);
    const [_layoutPreset, setLayoutPreset] = useState<LayoutPreset>(() =>
      layout.dockview && layout.dockview.shape === 'factory' ? (layout.dockview.preset ?? 'edit') : 'edit'
    );
    const [activePanes, setActivePanes] = useState<Set<CenterPane>>(() => new Set<CenterPane>(['structure']));
    const requestedSourceFile = useExploreFileNavStore((state) => state.requestedSourceFile);
    useEffect(() => {
      if (requestedSourceFile === undefined) return;
      setActivePanes((previous) => new Set([...previous, 'source']));
      useExploreFileNavStore.getState().clearSourceRequest();
    }, [requestedSourceFile]);
    const toggleCenterPane = useCallback((pane: CenterPane) => {
      setActivePanes((prev) => {
        const next = new Set(prev);
        if (next.has(pane)) {
          if (next.size <= 1) return prev;
          next.delete(pane);
        } else {
          next.add(pane);
          // Graph ↔ Structure mutual exclusion: showing one always hides
          // the other. They occupy the same conceptual slot (the structural
          // visualisation of the focused type) and the user reported that
          // having both visible at once is wasteful when nodes are expanded.
          if (pane === 'structure' && next.has('graph')) next.delete('graph');
          if (pane === 'graph' && next.has('structure')) next.delete('structure');
        }
        return next;
      });
    }, []);
    // Memoized so CenterPanesContext consumers don't re-render on every
    // DockShell render — only when activePanes itself actually changes
    // (toggleCenterPane is stable via the functional setState form above).
    const centerPanesContextValue = useMemo(
      () => ({ activePanes, toggle: toggleCenterPane }),
      [activePanes, toggleCenterPane]
    );
    const [utilitiesCollapsed, setUtilitiesCollapsedState] = useState<boolean>(() =>
      layout.dockview && layout.dockview.shape === 'factory' ? layout.dockview.bottomGroup.collapsed : false
    );
    const collapseAuxiliary = useDesignPreviewStore((state) => state.preferences.auxiliary);
    const utilitiesCollapsedRef = useLatestRef(utilitiesCollapsed);
    useEffect(() => {
      if (!collapseAuxiliary) return;
      const edge = apiRef.current?.getEdgeGroup('bottom');
      if (!edge) return;
      const originalCollapsed = utilitiesCollapsedRef.current;
      setUtilitiesCollapsedState(edge.isCollapsed());
      const listener = edge.onDidCollapsedChange((event) => setUtilitiesCollapsedState(event.isCollapsed));
      return () => {
        listener.dispose();
        // WorkbenchHost restores the pre-preview grid snapshot; restore its
        // logical flag too, so the next toolbar/header toggle uses that state.
        setUtilitiesCollapsedState(originalCollapsed);
      };
    }, [collapseAuxiliary, utilitiesCollapsedRef]);

    // Refs kept current so stable callbacks always read the latest values
    // without needing them as useCallback deps.
    const layoutRef = useLatestRef(layout);
    const restoredDefaultRef = useRef<PanelLayoutRecord | null>(null);
    const panelTabMetaRef = useLatestRef(panelTabMeta);
    const panelRegistry = useMemo(() => mergePanelRegistry(panelComponents), [panelComponents]);
    const workbenchDefinition = useMemo<WorkbenchDefinition>(
      () => ({
        id: 'explore',
        panels: panelRegistry,
        titles: PANEL_TITLES,
        buildDefault(api, width) {
          const fresh = buildDefaultLayout({ studioVersion, viewportWidth: width });
          restoredDefaultRef.current = fresh;
          applyLayout(api, fresh);
        }
      }),
      [panelRegistry, studioVersion]
    );
    const initialNativeLayout = layout.dockview?.shape === 'native' ? layout.dockview.json : undefined;
    const applyInitialLayout = useCallback((api: DockviewApi) => {
      applyLayout(api, layoutRef.current);
    }, []);

    const handleNativeLayoutChange = useCallback(
      (json: unknown) => {
        if (!onLayoutChangeRef.current || suppressLayoutPersistenceRef.current) return;
        onLayoutChangeRef.current({
          version: LAYOUT_SCHEMA_VERSION,
          writtenBy: studioVersion,
          dockview: { shape: 'native', json }
        });
      },
      [studioVersion]
    );

    const reportNativeLayoutError = useCallback((err: unknown) => {
      console.error('[DockShell] Failed to serialize layout change', err);
      recordOperation(
        'layout',
        `Failed to persist layout change: ${err instanceof Error ? err.message : String(err)}`,
        'warn'
      );
      showToastRef.current({
        title: 'Layout not saved',
        description: 'Could not persist the current panel arrangement.',
        variant: 'destructive'
      });
    }, []);

    const handleRestoreFallback = useCallback(() => {
      const fresh = restoredDefaultRef.current;
      if (!fresh) return;
      setLayout(fresh);
      setLayoutPreset(fresh.dockview?.shape === 'factory' ? (fresh.dockview.preset ?? 'edit') : 'edit');
      setUtilitiesCollapsedState(fresh.dockview?.shape === 'factory' ? fresh.dockview.bottomGroup.collapsed : false);
    }, []);

    const handleWorkbenchReady = useCallback((api: DockviewApi) => {
      apiRef.current = api;
      watchLocationLayoutRef.current(api);
      applyPanelTabMeta(api, panelTabMetaRef.current);
      const currentLayout = restoredDefaultRef.current ?? layoutRef.current;
      if (currentLayout.dockview?.shape === 'factory') {
        setUtilitiesCollapsedState(currentLayout.dockview.bottomGroup.collapsed);
      } else {
        const bottomGroup = api.panels.find((panel) => UTILITY_PANEL_IDS.has(panel.api.component))?.group;
        if (bottomGroup) {
          bottomGroup.api.setConstraints({ minimumHeight: COLLAPSED_UTILITY_HEIGHT });
          setUtilitiesCollapsedState(bottomGroup.api.height <= COLLAPSED_UTILITY_HEIGHT + 8);
        }
      }
      onLayoutChangeRef.current?.(currentLayout);
    }, []);

    const suppressLayoutPersistence = useCallback((work: () => void) => {
      suppressLayoutPersistenceRef.current = true;
      try {
        work();
      } finally {
        queueMicrotask(() => {
          suppressLayoutPersistenceRef.current = false;
        });
      }
    }, []);

    // Monotonically-increasing token so a re-toggle mid-animation cancels the
    // in-flight tween (the stale rAF loop sees a newer token and stops).
    // Bumped on EVERY path (animated, immediate, unmount) so no stale loop
    // survives. `utilityHeightRef` tracks the last height we applied so a
    // mid-flight reversal tweens from where the tray actually is instead of
    // snapping to a hardcoded endpoint.
    const utilityTweenTokenRef = useRef(0);
    const utilityHeightRef = useRef<number | null>(null);

    // Cancel any in-flight tray tween on unmount — the rAF loop would
    // otherwise keep calling setSize on a disposed dockview group.
    useEffect(() => {
      return () => {
        utilityTweenTokenRef.current++;
      };
    }, []);

    const setUtilitiesCollapsed = useCallback((collapsed: boolean, groupApi?: UtilityGroupApi) => {
      setUtilitiesCollapsedState(collapsed);
      const token = ++utilityTweenTokenRef.current;
      // Prefer the caller-supplied group API (from the chevron's own header
      // group) so we always resize the right group. Fall back to a global
      // utility-panel search for callers that don't know which group to target
      // (e.g. the toolbar button, keyboard shortcut).
      const resolvedGroupApi =
        groupApi ?? apiRef.current?.panels.find((p) => UTILITY_PANEL_IDS.has(p.api.component))?.group.api;
      if (!resolvedGroupApi) {
        return;
      }
      if (resolvedGroupApi.location?.type === 'edge') {
        if (collapsed) resolvedGroupApi.collapse?.();
        else resolvedGroupApi.expand?.();
        return;
      }
      const target = collapsed ? COLLAPSED_UTILITY_HEIGHT : DEFAULT_UTILITY_HEIGHT;
      // Animate the tray height with a short ease-out tween. Skip straight to
      // the target when the environment can't animate (jsdom has no
      // matchMedia) or the user prefers reduced motion.
      let reduceMotion = true;
      try {
        reduceMotion =
          typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        reduceMotion = true;
      }
      if (reduceMotion || typeof requestAnimationFrame !== 'function') {
        utilityHeightRef.current = target;
        resolvedGroupApi.setSize({ height: target });
        return;
      }
      // Start from the last height this code applied (mid-flight reversal),
      // falling back to the logical opposite endpoint on the first toggle.
      const from = utilityHeightRef.current ?? (collapsed ? DEFAULT_UTILITY_HEIGHT : COLLAPSED_UTILITY_HEIGHT);
      const durationMs = 220;
      const start = performance.now();
      const step = (now: number) => {
        if (utilityTweenTokenRef.current !== token) return;
        const p = Math.min(1, (now - start) / durationMs);
        const eased = 1 - (1 - p) ** 3; // ease-out cubic
        const height = Math.round(from + (target - from) * eased);
        utilityHeightRef.current = height;
        try {
          resolvedGroupApi.setSize({ height });
        } catch {
          // Group disposed mid-tween (layout reset/teardown) — stop quietly.
          return;
        }
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, []);

    const toggleUtilities = useCallback(
      (groupApi?: UtilityGroupApi) => {
        setUtilitiesCollapsed(!utilitiesCollapsed, groupApi);
      },
      [setUtilitiesCollapsed, utilitiesCollapsed]
    );
    // Memoized so UtilityTrayContext consumers don't re-render on every
    // DockShell render — only when one of these actually changes.
    const utilityTrayContextValue = useMemo(
      () => ({ utilitiesCollapsed, setUtilitiesCollapsed, toggleUtilities }),
      [utilitiesCollapsed, setUtilitiesCollapsed, toggleUtilities]
    );

    useEffect(() => {
      return installShellShortcuts(window, (action) => {
        onAction?.(action);
      });
    }, [onAction]);

    useEffect(() => {
      applyPanelTabMeta(apiRef.current, panelTabMeta);
    }, [panelTabMeta]);

    useEffect(() => {
      if (!focusPanel) {
        return;
      }
      const panel = apiRef.current?.getPanel(focusPanel.component);
      panel?.api.setActive();
    }, [focusPanel]);

    function resetLayout(): void {
      const fresh = buildDefaultLayout({ studioVersion, viewportWidth: getViewportWidth() });
      setLayout(fresh);
      setLayoutPreset(fresh.dockview?.shape === 'factory' ? (fresh.dockview.preset ?? 'edit') : 'edit');
      setUtilitiesCollapsedState(fresh.dockview?.shape === 'factory' ? fresh.dockview.bottomGroup.collapsed : false);
      if (apiRef.current) {
        try {
          const resetDefinition: WorkbenchDefinition = {
            ...workbenchDefinition,
            buildDefault(api) {
              applyLayout(api, fresh);
            }
          };
          suppressLayoutPersistence(() => {
            resetWorkbench(apiRef.current as DockviewApi, resetDefinition, getViewportWidth());
            applyPanelTabMeta(apiRef.current, panelTabMetaRef.current);
          });
        } catch (err) {
          console.error('[DockShell] Failed to reset layout', err);
          recordOperation('layout', err instanceof Error ? err.message : 'Failed to reset layout', 'error');
          showToast({
            title: 'Layout reset failed',
            description: err instanceof Error ? err.message : 'Could not reset the panel layout.',
            variant: 'destructive'
          });
        }
      }
      onLayoutChangeRef.current?.(fresh);
    }

    return (
      <div
        ref={shellRef}
        role="application"
        aria-label="Studio dock shell"
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
        data-testid="dock-shell"
        data-workspace-id={workspaceId}
      >
        <div
          role="toolbar"
          aria-label="Studio layout presets"
          className="studio-layout-presets"
          data-testid="studio-layout-presets"
        >
          <PerspectiveHeading perspectiveId="explore" />
          <div className="studio-layout-presets__group studio-layout-presets__group--actions">
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => toggleUtilities()}
              data-testid="toggle-utilities"
              aria-pressed={!utilitiesCollapsed}
              className="studio-chrome-button"
            >
              {utilitiesCollapsed ? 'Show utilities' : 'Hide utilities'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={resetLayout}
              data-testid="reset-layout"
              className="studio-chrome-button"
            >
              Reset layout
            </Button>
            {onNavigateBack && onNavigateForward ? (
              <TooltipProvider>
                <IconButtonGroup>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={onNavigateBack}
                          disabled={!canNavigateBack}
                          data-testid="navigate-back"
                          className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
                        >
                          <ArrowLeft className="size-3.5" />
                          <span className="sr-only">Navigate back</span>
                        </Button>
                      }
                    />
                    <TooltipContent>Navigate back</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={onNavigateForward}
                          disabled={!canNavigateForward}
                          data-testid="navigate-forward"
                          className="rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
                        >
                          <ArrowRight className="size-3.5" />
                          <span className="sr-only">Navigate forward</span>
                        </Button>
                      }
                    />
                    <TooltipContent>Navigate forward</TooltipContent>
                  </Tooltip>
                </IconButtonGroup>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
        {layoutNotice ? (
          <Alert
            role="status"
            aria-live="polite"
            className="flex items-center justify-between rounded-none border-x-0 border-t-0 bg-muted/60 px-3 py-1.5 text-xs"
            data-testid="layout-reset-notice"
          >
            <AlertDescription className="grid-cols-[1fr_auto] flex w-full items-center justify-between">
              <span>{layoutNotice}</span>
              <button type="button" className="ml-2 font-medium" onClick={() => setLayoutNotice(null)}>
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        ) : null}
        <CenterPanesContext.Provider value={centerPanesContextValue}>
          <UtilityTrayContext.Provider value={utilityTrayContextValue}>
            <UtilityHeaderActionsProvider>
              <div className="min-h-0 min-w-0 flex-1">
                <WorkbenchHost
                  definition={workbenchDefinition}
                  initialNativeLayout={initialNativeLayout}
                  initialLayout={initialNativeLayout === undefined ? applyInitialLayout : undefined}
                  onNativeLayoutChange={handleNativeLayoutChange}
                  onNativeLayoutError={reportNativeLayoutError}
                  onRestoreFallback={handleRestoreFallback}
                  onReady={handleWorkbenchReady}
                  defaultTabComponent={StudioDockTab}
                  rightHeaderActionsComponent={UtilityGroupHeaderActions}
                  className="h-full min-w-0 w-full"
                />
              </div>
            </UtilityHeaderActionsProvider>
          </UtilityTrayContext.Provider>
        </CenterPanesContext.Provider>
      </div>
    );
  },
  { op: 'DockShell' }
);
