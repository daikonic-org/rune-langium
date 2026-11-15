// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import './_studio-dark';
import { useEffect } from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Progress,
  Spinner,
  useToastManager
} from '@rune-langium/design-system';

type Seed = {
  title: string;
  description: string;
  type: 'default' | 'destructive' | 'loading';
  data?: { progress: { completed: number; total: number; label: string } };
};

// Static harness: seeds the toast manager once, renders them the way StudioToastProvider does.
function Seeded({ seeds }: { seeds: Seed[] }) {
  const { toasts, add } = useToastManager<NonNullable<Seed['data']>>();
  useEffect(() => {
    seeds.forEach((s) => add({ ...s, timeout: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ToastViewport aria-label="Studio notifications" className="top-0 bottom-auto">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} variant={t.type as Seed['type']}>
          {t.type === 'loading' && <Spinner className="mt-0.5 size-4 shrink-0 motion-reduce:animate-none" />}
          <div className="grid min-w-0 flex-1 gap-1 [overflow-wrap:anywhere]">
            {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
            <ToastDescription>{t.description}</ToastDescription>
            {t.data?.progress ? (
              <div className="grid gap-1 pt-1">
                <Progress
                  value={t.data.progress.completed}
                  max={t.data.progress.total}
                  aria-label={t.data.progress.label}
                  aria-valuetext={`${t.data.progress.completed} of ${t.data.progress.total} ${t.data.progress.label}`}
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t.data.progress.completed} of {t.data.progress.total} {t.data.progress.label}
                </span>
              </div>
            ) : null}
          </div>
          <ToastClose aria-label="Dismiss notification" />
        </Toast>
      ))}
    </ToastViewport>
  );
}

const Harness = ({ seeds }: { seeds: Seed[] }) => (
  <ToastProvider>
    <div className="h-[200px]" />
    <Seeded seeds={seeds} />
  </ToastProvider>
);

// J11 codegen: success toast after generating output.
export const CodegenSuccess = () => (
  <Harness
    seeds={[
      {
        type: 'default',
        title: 'Generated TypeScript',
        description: '6 namespaces written to cdm-trade-model.zip'
      }
    ]}
  />
);

// J16 resilience: destructive toast when the language server drops.
export const LspDisconnected = () => (
  <Harness
    seeds={[
      {
        type: 'destructive',
        title: 'Language server disconnected',
        description: 'Reconnecting to rune-lsp-worker. Hover and diagnostics are unavailable.'
      }
    ]}
  />
);

// J03 CDM load: persistent loading toast while hydrating the corpus.
export const CdmLoading = () => (
  <Harness
    seeds={[
      {
        type: 'loading',
        title: 'Loading CDM',
        description: 'Fetching cdm.product.template and 3 dependencies...'
      }
    ]}
  />
);

// J20 pinned source: the counter reports completed namespaces while final linking continues.
export const NamespaceLinking = () => (
  <Harness
    seeds={[
      {
        type: 'loading',
        title: 'Loading CDM',
        description: 'Linking cdm.base.datetime…',
        data: { progress: { completed: 2, total: 5, label: 'namespaces' } }
      }
    ]}
  />
);
