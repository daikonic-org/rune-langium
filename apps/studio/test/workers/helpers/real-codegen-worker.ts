// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { vi } from 'vitest';

export type WorkerScope = {
  addEventListener: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  importScripts: () => void;
};

export async function loadRealWorker() {
  let handler: ((event: MessageEvent<unknown>) => void) | undefined;
  const scope: WorkerScope = {
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent<unknown>) => void) => {
      if (type === 'message') handler = listener;
    }),
    postMessage: vi.fn(),
    importScripts: () => undefined
  };
  vi.stubGlobal('self', scope);
  // Node runs the same formatter engine without Vite's browser WASM asset loader.
  vi.stubEnv('SSR', true);
  vi.resetModules();
  await import('../../../src/workers/codegen-worker.ts');
  return {
    scope,
    dispatch(data: unknown) {
      if (!handler) throw new Error('worker message handler was not registered');
      handler({ data } as MessageEvent<unknown>);
    }
  };
}
