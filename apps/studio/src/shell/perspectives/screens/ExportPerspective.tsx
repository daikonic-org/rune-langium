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
import { useWorkspaceActionsOptional } from '../workspace-actions-context.js';
import type { ProjectController } from '../../../workspace/project-controller.js';
import { exportSourceFingerprint } from '../../../services/export-request.js';
import type { ExportInput } from '../../../services/export-request.js';
import { useExportNavigationStore } from '../../../services/export-navigation.js';
import { ExportSelectionPanel } from '../../panels/ExportSelectionPanel.js';
import { ExportSettingsPanel } from '../../panels/ExportSettingsPanel.js';
import { useProject } from '../../providers/project-context.js';
import { useWorkspaceOptional } from '../../providers/workspace-context.js';
import { ExportPreviewPanel } from '../../panels/ExportPreviewPanel.js';
import { ExportWorkspacePanel } from '../../panels/ExportWorkspacePanel.js';

export interface ExportPerspectiveProps {
  files?: ReadonlyArray<WorkspaceFile>;
  /** Stable workspace identity for artifact ownership and settings persistence. */
  workspaceId?: string;
}

/** Keep the task surface usable beside a compact selection explorer. */
function reconcileExportLayout(api: DockviewApi): void {
  const selection = api.getPanel('export.selection');
  const settings = api.getPanel('export.settings');
  if (settings && settings.group !== selection?.group && api.width >= 768) {
    settings.group.api.setConstraints({ minimumWidth: 320 });
    selection?.group.api.setConstraints({ minimumWidth: 220 });
  }
}

export const ExportPerspective = withInstrumentation(
  function ExportPerspective({ files, workspaceId }: ExportPerspectiveProps): ReactElement {
    const project = useProject();
    const actions = useWorkspaceActionsOptional();
    const [preparing, setPreparing] = useState(false);
    const [preparingRevision, setPreparingRevision] = useState<string>();
    const [preparationError, setPreparationError] = useState<string>();
    const preparation = useRef<
      | {
          abort: AbortController;
          controller: ProjectController;
          waiting?: {
            revision: string;
            sourceFingerprint: string;
            resolve(input: ExportInput): void;
            reject(error: Error): void;
          };
        }
      | undefined
    >(undefined);
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
    const removeTarget = useExportWorkbenchStore((state) => state.removeTarget);
    const targetDrafts = useExportWorkbenchStore((state) => state.targetDrafts);
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
    const [view, setView] = useState<'settings' | 'output'>('settings');
    const [expanded, setExpanded] = useState(false);
    const [navigationNotice, setNavigationNotice] = useState<string>();
    const lastArtifact = useRef<unknown>(undefined);
    useEffect(() => {
      if (activationReady && run.status === 'ready' && lastArtifact.current !== run.artifact) {
        lastArtifact.current = run.artifact;
        setView('output');
      }
    }, [run, activationReady]);
    useEffect(() => {
      setView('settings');
      setNavigationNotice(undefined);
      lastArtifact.current = undefined;
    }, [workspaceId]);
    const navigateOutput = useCallback(
      (namespace: string, name: string) => {
        const artifact =
          run.status === 'ready' || run.status === 'stale'
            ? run.artifact
            : run.status === 'generating' || run.status === 'failed'
              ? run.previous?.artifact
              : undefined;
        const file = artifact?.manifest.files.find(
          (file) => file.kind === 'text' && file.namespaces?.includes(namespace)
        );
        if (file) {
          setActiveFile(file.path);
          setView('output');
          setNavigationNotice(undefined);
        } else setNavigationNotice(`Generate output for ${namespace}.${name} to view its source.`);
        workbenchApi?.getPanel('export.settings')?.api.setActive();
      },
      [run, setActiveFile, workbenchApi]
    );
    const requiredBy = useMemo(
      () =>
        new Map(
          Object.entries(run.status === 'ready' ? (run.artifact.manifest.resolvedSelection?.requiredBy ?? {}) : {})
        ),
      [run]
    );
    const cancelPreparation = useCallback(() => {
      const pending = preparation.current;
      preparation.current = undefined;
      pending?.abort.abort();
      pending?.waiting?.reject(new DOMException('Build preparation canceled.', 'AbortError'));
      setPreparing(false);
      setPreparingRevision(undefined);
    }, []);
    const handleCancel = useCallback(() => {
      cancelPreparation();
      cancel();
    }, [cancelPreparation, cancel]);
    useEffect(() => {
      setPreparationError(undefined);
      return cancelPreparation;
    }, [workspaceId, project.controller, cancelPreparation]);
    const sourceFingerprint = useMemo(() => exportSourceFingerprint(workspaceId, files ?? []), [files, workspaceId]);
    const sourceFingerprintRef = useRef(sourceFingerprint);
    sourceFingerprintRef.current = sourceFingerprint;

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

    // Wait for the ordinary provider capture; never construct a parallel reference/override receipt.
    useEffect(() => {
      const pending = preparation.current;
      const waiting = pending?.waiting;
      if (!pending || !waiting || pending.abort.signal.aborted) return;
      const fail = (message: string) => {
        pending.waiting = undefined;
        waiting.reject(new Error(message));
      };
      if (pending.controller.current()?.revision !== waiting.revision) {
        fail('Project files changed while preparing this build. Try building again.');
        return;
      }
      if (project.snapshot?.revision !== waiting.revision) return;
      if (sourceFingerprint !== waiting.sourceFingerprint) {
        fail('Source changed while preparing this build. Try building again.');
        return;
      }
      if (project.runtime?.status === 'loading') return;
      if (projectUnavailable) {
        fail(projectUnavailable);
        return;
      }
      if (projectCapture && projectCapture.snapshot.revision !== waiting.revision) {
        fail('Source changed while preparing this build. Try building again.');
        return;
      }
      pending.waiting = undefined;
      waiting.resolve({
        workspaceId: workspaceId ?? 'unsaved-workspace',
        sourceRevision,
        projectRevision: waiting.revision,
        ...projectRequest,
        config,
        files: files ?? []
      });
    }, [
      preparingRevision,
      project,
      projectUnavailable,
      projectCapture,
      sourceFingerprint,
      sourceRevision,
      projectRequest,
      config,
      files,
      workspaceId
    ]);
    const handleBuildTargets = useCallback(
      async (names: readonly string[] | 'all') => {
        const controller = project.controller;
        if (!controller) return;
        cancelPreparation();
        const pending: NonNullable<typeof preparation.current> = { controller, abort: new AbortController() };
        preparation.current = pending;
        setPreparing(true);
        setPreparationError(undefined);
        try {
          await actions?.flushWorkspaceSave?.();
          pending.abort.signal.throwIfAborted();
          const saved = await controller.load();
          pending.abort.signal.throwIfAborted();
          const input = await new Promise<ExportInput>((resolve, reject) => {
            pending.waiting = {
              revision: saved.revision,
              sourceFingerprint: sourceFingerprintRef.current,
              resolve,
              reject
            };
            setPreparingRevision(saved.revision);
          });
          pending.abort.signal.throwIfAborted();
          setPreparing(false);
          await buildTargets(names, input);
        } catch (error) {
          if (!pending.abort.signal.aborted)
            setPreparationError(error instanceof Error ? error.message : 'Build preparation failed. Try again.');
        } finally {
          if (preparation.current === pending) {
            preparation.current = undefined;
            setPreparing(false);
            setPreparingRevision(undefined);
          }
        }
      },
      [project.controller, actions, cancelPreparation, buildTargets]
    );

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
                onNavigate={navigateOutput}
                onChange={handleSelectionChange}
              />
            </div>
          ),
          'export.settings': () => (
            <ExportWorkspacePanel
              view={view}
              onViewChange={setView}
              expanded={expanded}
              notice={navigationNotice}
              onToggleExpanded={() => {
                const panel = workbenchApi?.getPanel('export.settings');
                if (!workbenchApi || !panel) return;
                if (workbenchApi.hasMaximizedGroup()) workbenchApi.exitMaximizedGroup();
                else workbenchApi.maximizeGroup(panel);
                setExpanded(workbenchApi.hasMaximizedGroup());
              }}
              settings={
                <div data-testid="export-settings" className="h-full min-h-0">
                  <ExportSettingsPanel
                    config={config}
                    onChange={configure}
                    onGenerate={handleGenerate}
                    onCancel={handleCancel}
                    status={preparing ? 'generating' : run.status}
                    projectEnabled={Boolean(project.controller)}
                    projectSnapshot={project.snapshot}
                    projectDiagnostics={project.diagnostics}
                    selectedTargetName={selectedTargetName}
                    targetDirty={targetDirty}
                    dirtyTargets={Object.keys(targetDrafts)}
                    onRemoveTarget={removeTarget}
                    onSelectTarget={selectTarget}
                    onSaveTarget={async (name) => {
                      await saveTarget(name, config);
                    }}
                    onReloadProject={async () => {
                      await project.controller?.load();
                    }}
                    onBuildTargets={(names) => {
                      void handleBuildTargets(names);
                    }}
                  />
                </div>
              }
              output={
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
              }
            />
          )
        },
        titles: {
          'export.selection': 'Selection',
          'export.settings': 'Export'
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
            title: 'Export',
            position:
              width < 768
                ? { referenceGroup: selection.group, direction: 'within' }
                : { referencePanel: selection.id, direction: 'right' }
          });
          reconcileExportLayout(api);
          if (width >= 768) selection.group.api.setSize({ width: Math.min(400, Math.max(240, width * 0.28)) });
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
        view,
        expanded,
        navigationNotice,
        navigateOutput,
        workbenchApi,
        requiredBy,
        run,
        setActiveFile,
        project,
        projectRequest,
        selectedTargetName,
        targetDirty,
        selectTarget,
        saveTarget,
        handleBuildTargets,
        handleCancel,
        preparing,
        workspaceId,
        sourceRevision,
        files
      ]
    );

    return (
      <section data-testid="export-perspective" className="flex h-full min-h-0 flex-col overflow-hidden">
        {preparationError ? (
          <p role="alert" className="border-b border-border px-3 py-2 text-sm text-destructive">
            {preparationError}
          </p>
        ) : null}
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
