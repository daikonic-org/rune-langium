// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  useToastManager
} from '@rune-langium/design-system/ui/toast';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { addInstrumentationSink, withInstrumentation, type TelemetryRecord } from '../services/instrumentation/core.js';
import { isFailureRecord } from '../services/instrumentation/record-status.js';

type StudioToastVariant = 'default' | 'destructive' | 'loading';

interface StudioToastInput {
  title?: string;
  description: string;
  variant?: StudioToastVariant;
  duration?: number;
}

interface StudioLoadingToastInput {
  title?: string;
  description: string;
  progress?: { completed: number; total: number; label: string };
}

interface StudioToastContextValue {
  showToast: (toast: StudioToastInput) => void;
  /** Keep a background notification open until dismissed; progress reports known work only. */
  showLoadingToast: (toast: StudioLoadingToastInput) => string;
  updateLoadingToast: (id: string, toast: StudioLoadingToastInput) => void;
  /** Dismisses a toast by id (e.g. one returned by `showLoadingToast`). */
  dismissToast: (id: string) => void;
  /**
   * Pure toast render, no output-store/activity-store mirroring. Used by
   * the instrumentation Toast sink, which independently targets Activity
   * itself. The
   * operation owner records Activity/Output independently of notification presentation.
   */
  notify: (toast: StudioToastInput) => void;
}

const StudioToastContext = createContext<StudioToastContextValue | null>(null);

export const StudioToastProvider = withInstrumentation(
  function StudioToastProvider({ children }: { children: ReactNode }) {
    return (
      <ToastProvider duration={4000}>
        <StudioToastInner>{children}</StudioToastInner>
      </ToastProvider>
    );
  },
  { op: 'StudioToastProvider' }
);

function StudioToastInner({ children }: { children: ReactNode }) {
  const { toasts, add, close, update } = useToastManager<{ progress?: StudioLoadingToastInput['progress'] }>();
  const showToast = useCallback(
    (input: StudioToastInput) => {
      add({
        title: input.title,
        description: input.description,
        type: input.variant ?? 'default',
        timeout: input.duration
      });
    },
    [add]
  );

  const showLoadingToast = useCallback(
    (input: StudioLoadingToastInput) => {
      const id = add({
        title: input.title,
        description: input.description,
        type: 'loading',
        data: { progress: input.progress },
        // No auto-dismiss timeout — a background process has no fixed
        // duration; the caller dismisses it explicitly when done.
        timeout: 0
      });
      return id;
    },
    [add]
  );

  const updateLoadingToast = useCallback(
    (id: string, input: StudioLoadingToastInput) => {
      update(id, { title: input.title, description: input.description, data: { progress: input.progress } });
    },
    [update]
  );

  const dismissToast = useCallback(
    (id: string) => {
      close(id);
    },
    [close]
  );

  const notify = showToast;

  useEffect(() => {
    return addInstrumentationSink((record: TelemetryRecord) => {
      // `toast === false` opts a namespace-tagged call OUT of the toast UI
      // specifically while staying Activity/telemetry-eligible — see
      // TelemetryRecord.toast's doc comment. Used by background spans
      // (e.g. transport-provider.ts's connection-establish timing) that
      // fire on every reconnect and would otherwise spam a toast per call.
      if (!record.namespace || record.toast === false) return;
      notify({
        title: record.namespace,
        description: record.message ?? record.op,
        variant: isFailureRecord(record) ? 'destructive' : 'default'
      });
    });
  }, [notify]);

  const contextValue = useMemo<StudioToastContextValue>(
    () => ({ showToast, showLoadingToast, updateLoadingToast, dismissToast, notify }),
    [showToast, showLoadingToast, updateLoadingToast, dismissToast, notify]
  );

  return (
    <StudioToastContext.Provider value={contextValue}>
      {children}
      <ToastViewport aria-label="Studio notifications">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} variant={t.type as StudioToastVariant}>
            <div className="flex items-start gap-2">
              {t.type === 'loading' && <Spinner className="size-4 shrink-0 mt-0.5" />}
              <div className="grid min-w-0 flex-1 gap-1">
                <ToastTitle className={t.title ? undefined : 'sr-only'}>{t.title ?? t.description}</ToastTitle>
                <ToastDescription>{t.description}</ToastDescription>
                {t.type === 'loading' && t.data?.progress && t.data.progress.total > 0 ? (
                  <div className="grid gap-1 pt-1">
                    <progress
                      aria-label={t.data.progress.label}
                      value={Math.max(0, Math.min(t.data.progress.completed, t.data.progress.total))}
                      max={t.data.progress.total}
                      className="h-1.5 w-full accent-primary"
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.data.progress.completed} of {t.data.progress.total} {t.data.progress.label}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <ToastClose aria-label="Dismiss notification" />
          </Toast>
        ))}
      </ToastViewport>
    </StudioToastContext.Provider>
  );
}

const NOOP_TOAST: StudioToastContextValue = {
  showToast: () => {},
  showLoadingToast: () => '',
  updateLoadingToast: () => {},
  dismissToast: () => {},
  notify: () => {}
};

export const useStudioToast = withInstrumentation(
  function useStudioToast(): StudioToastContextValue {
    return useContext(StudioToastContext) ?? NOOP_TOAST;
  },
  { op: 'useStudioToast' }
);
