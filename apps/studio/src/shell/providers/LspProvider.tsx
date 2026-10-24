// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { recordOperation } from '../../services/operation-feedback.js';
import type React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { LspContext, type LspContextValue } from './lsp-context.js';
import { useWorkspace } from './workspace-context.js';
import { useProject } from './project-context.js';
import { collectProjectLspInput } from '../../services/project-lsp-input.js';
import { useExploreFileNavStore } from '../explore-file-nav-store.js';
import { createLspClientService, type LspClientService } from '../../services/lsp-client.js';
import { createTransportProvider, type TransportState } from '../../services/transport-provider.js';
import { getLspSessionId } from '../../services/lsp-session.js';
import { config } from '../../config.js';
import { collectLspWorkspaceModels, type LspModelCacheEntry } from '../../services/lsp-workspace-models.js';
import { BUNDLE_MARKER_SUFFIX } from '../../services/workspace.js';
import { useStudioToast } from '../../components/StudioToastProvider.js';
import { useOutputStore, fmtLine } from '../../store/output-store.js';
import { useActivityStore } from '../../store/activity-store.js';
import { allocateOpId } from '../../services/op-log.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const LspProvider = withInstrumentation(
  function LspProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const { files, parsedModels } = useWorkspace();
    const { runtime } = useProject();
    const activeEditorFile = useExploreFileNavStore((s) => s.activeEditorFile);
    const modelCache = useRef(new Map<string, LspModelCacheEntry>());
    const semanticInput = useMemo(() => {
      if (runtime && runtime.status !== 'legacy') {
        if (!runtime.input)
          return {
            unavailable:
              runtime.diagnostics.map((issue) => issue.message).join('\n') ||
              'Applying the current project configuration…'
          };
        try {
          return collectProjectLspInput(runtime.input, parsedModels, modelCache.current, activeEditorFile);
        } catch (error) {
          return { unavailable: error instanceof Error ? error.message : 'Current project models are unavailable.' };
        }
      }
      return { models: collectLspWorkspaceModels(files, parsedModels, modelCache.current, activeEditorFile) };
    }, [files, parsedModels, activeEditorFile, runtime?.input, runtime?.status]);
    const lspClientRef = useRef<LspClientService | null>(null);
    const providerRef = useRef<ReturnType<typeof createTransportProvider> | null>(null);
    const [transportState, setTransportState] = useState<TransportState>({
      mode: 'disconnected',
      status: 'disconnected'
    });
    const { showToast } = useStudioToast();
    const showToastRef = useRef(showToast);
    useEffect(() => {
      showToastRef.current = showToast;
    }, [showToast]);
    const prevStatusRef = useRef<TransportState['status']>('disconnected');
    const hasConnectedOnceRef = useRef(false);

    useEffect(() => {
      if (!config.lspEnabled) {
        setTransportState({ mode: 'disconnected', status: 'disconnected' });
        providerRef.current = null;
        lspClientRef.current = null;
        return undefined;
      }
      const connectOpId = allocateOpId();
      const connectStartedAt = performance.now();
      const provider = createTransportProvider({ workspaceId: getLspSessionId() });
      providerRef.current = provider;
      const unsub = provider.onStateChange((state) => {
        setTransportState(state);
        if (state.status === 'connected') {
          // Reconnects have their own operation IDs and timing spans.
          if (!hasConnectedOnceRef.current) {
            hasConnectedOnceRef.current = true;
            const durationMs = performance.now() - connectStartedAt;
            useOutputStore
              .getState()
              .addLine(fmtLine('lsp', 'connected'), 'success', { op: 'lsp', opId: connectOpId, durationMs });
            useActivityStore.getState().addActivity('lsp', true, 'connected', { opId: connectOpId, durationMs });
          }
        } else if (state.status === 'disconnected' && prevStatusRef.current === 'connected') {
          useOutputStore.getState().addLine(fmtLine('lsp', 'disconnected'), 'warn');
          useActivityStore.getState().addActivity('lsp', false, 'disconnected');
        }
        prevStatusRef.current = state.status;
      });
      const client = createLspClientService({ transportProvider: provider });
      lspClientRef.current = client;
      client.connect().catch((err) => {
        // End the initial span so reconnects cannot log it again.
        hasConnectedOnceRef.current = true;
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = performance.now() - connectStartedAt;
        console.error('[LspProvider] LSP connect failed:', err);
        useOutputStore
          .getState()
          .addLine(fmtLine('lsp', 'connect failed', msg), 'error', { op: 'lsp', opId: connectOpId, durationMs });
        useActivityStore.getState().addActivity('lsp', false, `connect failed · ${msg}`, {
          opId: connectOpId,
          durationMs
        });
        showToastRef.current({
          title: 'Language server unavailable',
          description:
            err instanceof Error ? err.message : 'LSP connection failed. Diagnostics and completions will not work.',
          variant: 'destructive'
        });
      });
      return () => {
        unsub();
        client.dispose();
        provider.dispose();
      };
    }, []);

    useEffect(() => {
      const client = lspClientRef.current;
      if (!client) return;
      if ('unavailable' in semanticInput) {
        client.suspendProjectResolution(semanticInput.unavailable!);
        return;
      }
      const sync =
        'resolution' in semanticInput
          ? client.syncWorkspaceModels(semanticInput.models, semanticInput.resolution)
          : client.syncWorkspaceModels(semanticInput.models);
      void sync.catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useOutputStore.getState().addLine(fmtLine('lsp', 'dependency sync failed', msg), 'error');
      });
    }, [semanticInput]);

    // Keep full syntax trees only for the active source document.
    useEffect(() => {
      const active = files.filter(
        (f) => f.path === activeEditorFile && !f.path.endsWith(BUNDLE_MARKER_SUFFIX) && (!f.refOnly || f.sourceLoaded)
      );
      lspClientRef.current?.syncWorkspaceFiles(active);
    }, [files, activeEditorFile]);

    const reconnect = useCallback(() => {
      void (async () => {
        if (!lspClientRef.current) {
          useOutputStore
            .getState()
            .addLine(fmtLine('lsp', 'reconnect unavailable — language server is disabled'), 'warn');
          useActivityStore.getState().addActivity('lsp', false, 'reconnect unavailable — language server is disabled');
          return;
        }
        const opId = allocateOpId();
        const startedAt = performance.now();
        try {
          await lspClientRef.current.reconnect();
          const durationMs = performance.now() - startedAt;
          useOutputStore.getState().addLine(fmtLine('lsp', 'reconnected'), 'success', { op: 'lsp', opId, durationMs });
          useActivityStore.getState().addActivity('lsp', true, 'reconnected', { opId, durationMs });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const durationMs = performance.now() - startedAt;
          console.error('[LspProvider] LSP reconnect failed:', err);
          recordOperation('lsp', `reconnect failed · ${msg}`, 'error', { opId, durationMs });
          showToast({
            title: 'LSP reconnect failed',
            description: err instanceof Error ? err.message : 'Could not reconnect to the language server.',
            variant: 'destructive'
          });
        }
      })();
    }, [showToast]);

    // Client ref changes also update transportState, refreshing this value.
    const value: LspContextValue = useMemo(
      () => ({ lspClient: lspClientRef.current, transportState, reconnect }),
      [transportState, reconnect]
    );
    return <LspContext.Provider value={value}>{children}</LspContext.Provider>;
  },
  { op: 'LspProvider' }
);
