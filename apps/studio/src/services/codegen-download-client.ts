// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

export type CodegenDownloadReply =
  | { body: ArrayBuffer; status: number; headers: Array<[string, string]> }
  | { error: string };

function hasCuratedSources(body: Record<string, unknown>): boolean {
  return ['curatedBundles', 'curatedDocs'].some((key) => {
    const source = body[key];
    return Array.isArray(source) ? source.length > 0 : Boolean(source);
  });
}

/** Curated downloads need more memory than the Pages runtime permits. */
export const requestCodegenDownload = withInstrumentation(
  function requestCodegenDownload(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    if (!body.project && !hasCuratedSources(body)) {
      return fetch('/api/codegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
    }

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('The code generation request was aborted.', 'AbortError'));
        return;
      }
      const worker = new Worker(new URL('../workers/codegen-download-worker.ts', import.meta.url), { type: 'module' });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        worker.terminate();
      };
      const abort = () => {
        finish();
        reject(signal?.reason ?? new DOMException('The code generation request was aborted.', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        finish();
        reject(new Error('Code generation timed out after 120 seconds. Try a smaller namespace selection.'));
      }, 120_000);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<CodegenDownloadReply>) => {
        finish();
        const reply = event.data;
        if ('error' in reply) reject(new Error(reply.error));
        else resolve(new Response(reply.body, { status: reply.status, headers: reply.headers }));
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || 'Code generation worker failed'));
      };
      worker.onmessageerror = () => {
        finish();
        reject(new Error('Could not read the generated download'));
      };
      try {
        worker.postMessage(body);
      } catch (error) {
        finish();
        reject(error);
      }
    });
  },
  { op: 'codegenDownload' }
);
