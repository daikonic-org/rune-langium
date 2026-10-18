// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { parseCuratedCacheSeeds, type CuratedCacheMessage, type CuratedCacheSeed } from './curated-cache-seeds.js';

type Connection = { postMessage(message: CuratedCacheMessage): void; close(): void };

export const createCuratedCacheClient = withInstrumentation(
  function createCuratedCacheClient() {
    let connection: Connection | undefined;
    let seeds: CuratedCacheSeed[] = [];
    let active = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let fallback = false;
    let disposed = false;
    let disabled = false;

    function post(message: CuratedCacheMessage) {
      try {
        connection?.postMessage(message);
      } catch {
        disconnect();
      }
    }

    function disconnect() {
      postDispose();
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    }

    function postDispose() {
      try {
        connection?.postMessage({ type: 'dispose' });
        connection?.close();
      } catch {
        /* Best effort on termination. */
      }
      connection = undefined;
    }

    function connect() {
      if (connection || disposed || disabled || seeds.length === 0 || typeof window === 'undefined') return;
      const network = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
      if (network.connection?.saveData || ['slow-2g', '2g'].includes(network.connection?.effectiveType ?? '')) return;
      const fail = () => {
        disconnect();
        if (!fallback) {
          fallback = true;
          connect();
        } else disabled = true;
      };
      try {
        if (!fallback && typeof SharedWorker !== 'undefined') {
          const worker = new SharedWorker(new URL('../workers/curated-cache-worker.ts', import.meta.url), {
            type: 'module',
            name: 'rune-curated-cache-v1'
          });
          worker.onerror = fail;
          worker.port.start();
          connection = { postMessage: (message) => worker.port.postMessage(message), close: () => worker.port.close() };
        } else {
          fallback = true;
          if (typeof Worker === 'undefined') return;
          const worker = new Worker(new URL('../workers/curated-cache-worker.ts', import.meta.url), {
            type: 'module',
            name: 'rune-curated-cache'
          });
          worker.onerror = fail;
          connection = { postMessage: (message) => worker.postMessage(message), close: () => worker.terminate() };
        }
        post({ type: 'seed', seeds });
        if (active) hold();
      } catch {
        fail();
      }
    }

    function hold() {
      post({ type: 'foreground', active: true });
      heartbeat ??= setInterval(() => post({ type: 'foreground', active: true }), 5000);
    }

    return {
      seed(value: unknown, preferredNamespaces: readonly string[] = []) {
        seeds = parseCuratedCacheSeeds(value);
        const preferred = new Set(preferredNamespaces);
        seeds.sort((a, b) => Number(preferred.has(b.namespace)) - Number(preferred.has(a.namespace)));
        if (connection) post({ type: 'seed', seeds });
        else connect();
      },
      foreground() {
        active++;
        if (connection) hold();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          active--;
          if (!active) {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = undefined;
            post({ type: 'foreground', active: false });
          }
        };
      },
      dispose() {
        disposed = true;
        disconnect();
      },
      suspend() {
        disconnect();
      },
      resume() {
        connect();
      }
    };
  },
  { op: 'createCuratedCacheClient', level: 'trace', capture: 0 }
);

export const curatedCacheClient = createCuratedCacheClient();
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => curatedCacheClient.suspend());
  window.addEventListener('pageshow', () => curatedCacheClient.resume());
}
