// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { vi } from 'vitest';
import type { HydrateRequest, WorkerRequest } from '../../src/workers/parser-worker.js';

/** Mirrors the worker's deferred hydration so corruption is discovered on link. */
export function deferredCuratedWorker() {
  const received: WorkerRequest[] = [];
  class DeferredWorker extends EventTarget {
    documents: HydrateRequest['documents'] = [];
    postMessage(request: WorkerRequest) {
      received.push(request);
      if (request.type === 'hydrate') this.documents = request.documents;
      const invalid = this.documents.filter((doc) => doc.serializedModel === '{broken');
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data:
              request.type === 'hydrate'
                ? { type: 'hydrateResult', id: request.id, ok: true }
                : {
                    type: 'linkDocumentResult',
                    id: request.id,
                    linked: invalid.length === 0,
                    errors: invalid.length ? ['Invalid serialized model'] : [],
                    newModels: [],
                    invalidArtifactKeys: invalid.map((doc) => doc.artifactKey)
                  }
          })
        )
      );
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', DeferredWorker);
  return received;
}
