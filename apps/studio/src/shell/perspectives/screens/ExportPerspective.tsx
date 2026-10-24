// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Declaration-scoped export workbench: roots, settings, then captured output. */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview-react';
import type { ExportSelection } from '@rune-langium/codegen/export';
import type { WorkbenchDefinition } from '../../workbench-types.js';
import { WorkbenchHost } from '../../WorkbenchHost.js';
import type { WorkspaceFile } from '../../../services/workspace.js';
import { downloadExportArtifact } from '../../../services/export-artifact.js';
import { withInstrumentation } from '../../../services/instrumentation/core.js';
import { useExportWorkbenchStore } from '../../../store/export-workbench-store.js';
import { exportSourceFingerprint } from '../../../services/export-request.js';
import { useExportNavigationStore } from '../../../services/export-navigation.js';
import { ExportSelectionPanel } from '../../panels/ExportSelectionPanel.js';
import { ExportSettingsPanel } from '../../panels/ExportSettingsPanel.js';
import { useProject } from '../../providers/project-context.js';
import { useWorkspaceOptional } from '../../providers/workspace-context.js';
import { ExportPreviewPanel } from '../../panels/ExportPreviewPanel.js';

export interface ExportPerspectiveProps {
  files?: ReadonlyArray<WorkspaceFile>;
  /** Stable workspace identity for artifact ownership and settings persistence. */
  workspaceId?: string;
}

const COMPACT_OUTPUT_HEIGHT = 128;
const EXPANDED_OUTPUT_HEIGHT = 256;

/** Constraints belong to dock groups, so restored layouts receive them too. */
function reconcileExportLayout(api: DockviewApi): void {
  const selection = api.getPanel('export.selection');
  const settings = api.getPanel('export.settings');
  const preview = api.getPanel('export.preview');
  const height = api.height || 640;
  selection?.group.api.setConstraints({ minimumHeight: Math.min(352, Math.floor(height * 0.55)) });
  if (preview && preview.group !== selection?.group) {
    preview.group.api.setConstraints({ minimumHeight: Math.min(96, Math.floor(height * 0.2)) });
  }
  if (settings && settings.group !== selection?.group && api.width >= 768) {
    settings.group.api.setConstraints({ minimumWidth: 320 });
  }
}

export const ExportPerspective = withInstrumentation(
  function ExportPerspective({ files, workspaceId }: ExportPerspectiveProps): ReactElement {
    const project = useProject();
    const projectCapture = project.runtime?.status === 'captured' ? project.runtime.input : undefined;
    const projectUnavailable =
      project.runtime && project.runtime.status !== 'legacy' && !projectCapture
        ? project.runtime.diagnostics.map((issue) => issue.message).join('\n') ||
          'Applying the current project configuration…'
        : undefined;
    const projectRequest = useMemo(
      () => ({
        ...(projectCapture ? { project: projectCapture } : {}),
        ...(projectUnavailable ? { projectUnavailable } : {})
      }),
      [projectCapture, projectUnavailable]
    );
    const workspace = useWorkspaceOptional();
    const selectedTargetName = useExportWorkbenchStore((state) => state.selectedTargetName);
    const targetDirty = useExportWorkbenchStore((state) => state.targetDirty);
    const bindProject = useExportWorkbenchStore((state) => state.bindProject);
    const selectTarget = useExportWorkbenchStore((state) => state.selectTarget);
    const saveTarget = useExportWorkbenchStore((state) => state.saveTarget);
    const buildTargets = useExportWorkbenchStore((state) => state.buildTargets);
    const config = useExportWorkbenchStore((state) => state.config);
    const run = useExportWorkbenchStore((state) => state.run);
    const activeFile = useExportWorkbenchStore((state) => state.activeFile);
    const nativeLayout = useExportWorkbenchStore((state) => state.nativeLayout);
    const activate = useExportWorkbenchStore((state) => state.activate);
    const configure = useExportWorkbenchStore((state) => state.configure);
    const generate = useExportWorkbenchStore((state) => state.generate);
    const cancel = useExportWorkbenchStore((state) => state.cancel);
    const invalidate = useExportWorkbenchStore((state) => state.invalidate);
    const setActiveFile = useExportWorkbenchStore((state) => state.setActiveFile);
    const setNativeLayout = useExportWorkbenchStore((state) => state.setNativeLayout);
    const [sourceRevision, setSourceRevision] = useState(0);
    const [activationReady, setActivationReady] = useState(false);
    const sourceRevisionRef = useRef(sourceRevision);
    const activationRef = useRef<{ workspaceId: string; promise: Promise<void> } | undefined>(undefined);
    const [workbenchApi, setWorkbenchApi] = useState<DockviewApi>();
    const hasArtifact =
      run.status === 'ready' ||
      run.status === 'stale' ||
      ((run.status === 'generating' || run.status === 'failed') && run.previous !== undefined);
    const hadArtifact = useRef(hasArtifact);
    const compactOutput = useRef<{ groupId: string; height: number } | undefined>(undefined);

    useEffect(() => {
      const arrived = hasArtifact && !hadArtifact.current;
      hadArtifact.current = hasArtifact;
      if (!arrived || !workbenchApi) return;
      const initialOutput = compactOutput.current;
      compactOutput.current = undefined;
      const preview = workbenchApi.getPanel('export.preview');
      // Only expand the untouched default. Restored, resized, or tabbed groups
      // retain their arrangement, including deliberately compact output.
      if (
        preview &&
        initialOutput?.groupId === preview.group.id &&
        preview.group.panels.length === 1 &&
        Math.abs(preview.group.api.height - initialOutput.height) <= 2
      ) {
        preview.group.api.setSize({ height: Math.min(EXPANDED_OUTPUT_HEIGHT, workbenchApi.height * 0.4) });
      }
    }, [hasArtifact, workbenchApi]);
    const requiredBy = useMemo(
      () =>
        new Map(
          Object.entries(run.status === 'ready' ? (run.artifact.manifest.resolvedSelection?.requiredBy ?? {}) : {})
        ),
      [run]
    );
    const sourceFingerprint = useMemo(() => exportSourceFingerprint(workspaceId, files ?? []), [files, workspaceId]);

    useEffect(() => {
      if (!workspaceId) {
        setActivationReady(false);
        return;
      }
      if (activationRef.current?.workspaceId !== workspaceId) {
        setActivationReady(false);
        activationRef.current = { workspaceId, promise: activate(workspaceId) };
      }
      let cancelled = false;
      void activationRef.current.promise.then(() => {
        if (cancelled) return;
        const intent = useExportNavigationStore.getState().consume(workspaceId);
        if (intent) configure({ ...useExportWorkbenchStore.getState().config, selection: intent.selection });
        setActivationReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [activate, configure, workspaceId]);
    useEffect(
      () => bindProject(project.controller, workspace?.workspaceName),
      [bindProject, project.controller, workspace?.workspaceName]
    );
    useEffect(() => {
      const revision = sourceRevisionRef.current + 1;
      sourceRevisionRef.current = revision;
      setSourceRevision(revision);
      invalidate(revision);
    }, [invalidate, sourceFingerprint, projectCapture?.receipt.revision, projectUnavailable]);

    const handleSelectionChange = useCallback(
      (selection: ExportSelection) => configure({ ...config, selection }),
      [config, configure]
    );
    const handleGenerate = useCallback(() => {
      void generate({
        workspaceId: workspaceId ?? 'unsaved-workspace',
        sourceRevision,
        projectRevision: project.snapshot?.revision,
        ...projectRequest,
        config,
        files: files ?? []
      });
    }, [config, files, generate, sourceRevision, workspaceId, project.snapshot?.revision, projectRequest]);
    const definition = useMemo<WorkbenchDefinition>(
      () => ({
        id: 'export',
        panels: {
          'export.selection': () => (
            <div data-testid="export-selection" className="h-full min-h-0">
              <ExportSelectionPanel
                selection={config.selection}
                requiredBy={requiredBy}
                included={run.status === 'ready' ? run.artifact.manifest.resolvedSelection?.included : undefined}
                includedCount={
                  run.status === 'ready' ? run.artifact.manifest.resolvedSelection?.included.length : undefined
                }
                onChange={handleSelectionChange}
              />
            </div>
          ),
          'export.settings': () => (
            <div data-testid="export-settings" className="h-full min-h-0">
              <ExportSettingsPanel
                config={config}
                onChange={configure}
                onGenerate={handleGenerate}
                onCancel={cancel}
                status={run.status}
                projectEnabled={Boolean(project.controller)}
                projectSnapshot={project.snapshot}
                projectDiagnostics={project.diagnostics}
                selectedTargetName={selectedTargetName}
                targetDirty={targetDirty}
                onSelectTarget={selectTarget}
                onSaveTarget={async (name) => {
                  await saveTarget(name, config);
                }}
                onReloadProject={async () => {
                  await project.controller?.load();
                }}
                onBuildTargets={(names) => {
                  void buildTargets(names, {
                    workspaceId: workspaceId ?? 'unsaved-workspace',
                    sourceRevision,
                    ...projectRequest,
                    config,
                    files: files ?? []
                  });
                }}
              />
            </div>
          ),
          'export.preview': () => (
            <div data-testid="export-preview" className="h-full min-h-0">
              <ExportPreviewPanel
                run={run}
                activeFile={activeFile}
                onActiveFileChange={setActiveFile}
                onDownload={() => {
                  if (run.status === 'ready') downloadExportArtifact(run.artifact);
                }}
              />
            </div>
          )
        },
        titles: {
          'export.selection': 'Selection',
          'export.settings': 'Settings',
          'export.preview': 'Generated output'
        },
        buildDefault(api, width) {
          const selection = api.addPanel({
            id: 'export.selection',
            component: 'export.selection',
            title: 'Selection'
          });
          api.addPanel({
            id: 'export.settings',
            component: 'export.settings',
            title: 'Settings',
            position:
              width < 768
                ? { referenceGroup: selection.group, direction: 'within' }
                : { referencePanel: selection.id, direction: 'right' }
          });
          const preview = api.addPanel({
            id: 'export.preview',
            component: 'export.preview',
            title: 'Generated output',
            position: { referencePanel: selection.id, direction: 'below' }
          });
          reconcileExportLayout(api);
          preview.group.api.setSize({ height: hasArtifact ? EXPANDED_OUTPUT_HEIGHT : COMPACT_OUTPUT_HEIGHT });
          compactOutput.current = hasArtifact
            ? undefined
            : { groupId: preview.group.id, height: preview.group.api.height };
          if (width < 768) selection.api.setActive();
        },
        reconcile: reconcileExportLayout
      }),
      [
        activeFile,
        cancel,
        config,
        configure,
        handleGenerate,
        handleSelectionChange,
        hasArtifact,
        requiredBy,
        run,
        setActiveFile,
        project,
        projectRequest,
        selectedTargetName,
        targetDirty,
        selectTarget,
        saveTarget,
        buildTargets,
        workspaceId,
        sourceRevision,
        files
      ]
    );

    return (
      <section data-testid="export-perspective" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          {activationReady ? (
            <WorkbenchHost
              definition={definition}
              initialNativeLayout={nativeLayout}
              onNativeLayoutChange={setNativeLayout}
              onReady={setWorkbenchApi}
              className="h-full min-w-0 w-full"
            />
          ) : (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              Restoring Export workspace…
            </p>
          )}
        </div>
      </section>
    );
  },
  { op: 'ExportPerspective' }
);
