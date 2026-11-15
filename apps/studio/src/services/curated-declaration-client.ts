// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { InspectNamespaceRequest, InspectNamespaceResponse } from '../workers/parser-worker.js';
import { withAbortTimeout } from './with-abort-timeout.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Read alongside linking without putting another Core build on the UI thread. */
export const inspectCapturedDeclarations = withInstrumentation(
  function inspectCapturedDeclarations(
    documents: InspectNamespaceRequest['documents'],
    signal: AbortSignal
  ): Promise<InspectNamespaceResponse['models']> {
    return withAbortTimeout(async (timeoutSignal) => {
      const operation = AbortSignal.any([signal, timeoutSignal]);
      operation.throwIfAborted();
      const worker = new Worker(new URL('../workers/curated-declaration-worker.ts', import.meta.url), {
        type: 'module'
      });
      const result = Promise.withResolvers<InspectNamespaceResponse['models']>();
      const abort = () => result.reject(operation.reason);
      operation.addEventListener('abort', abort, { once: true });
      try {
        worker.onmessage = (event: MessageEvent<InspectNamespaceResponse>) => {
          const reply = event.data;
          if (reply?.type !== 'inspectNamespaceResult' || reply.id !== 'declaration' || !Array.isArray(reply.models))
            result.reject(new Error('Worker returned an invalid declaration snapshot'));
          else if (reply.error) result.reject(new Error(reply.error));
          else result.resolve(reply.models);
        };
        worker.onerror = (event) => result.reject(new Error(event.message || 'Declaration worker failed'));
        worker.onmessageerror = () => result.reject(new Error('Declaration snapshot could not be deserialized'));
        const request: InspectNamespaceRequest = { type: 'inspectNamespace', id: 'declaration', documents };
        worker.postMessage(request);
        return await result.promise;
      } finally {
        operation.removeEventListener('abort', abort);
        worker.terminate();
      }
    }, 30_000);
  },
  { op: 'inspectCapturedDeclarations', capture: 0 }
);
