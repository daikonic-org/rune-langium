// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createPreviewSessionClient } from './preview-session-client.js';
import { createProjectWorkerBridge } from './project-worker-bridge.js';
import { createPreviewSetFilesMessage, isPreviewFilesReadyMessage } from './codegen-service.js';
import { projectReceiptMatches } from '@rune-langium/project-runtime/receipt';
import { projectWorkerInput } from './project-runtime-input.js';
import type { PreparedWorkflowData } from './prepared-workflow.js';
import { withInstrumentation } from './instrumentation/core.js';

/** A separate worker keeps prepared providers and caches out of other sessions and editor views. */
export const executePreparedWorkflow = withInstrumentation(
  async function executePreparedWorkflow(
    prepared: PreparedWorkflowData,
    functionFqn: string,
    inputs: Record<string, unknown>,
    signal: AbortSignal,
    createWorker: () => Worker = () =>
      new Worker(new URL('../workers/codegen-worker.ts', import.meta.url), { type: 'module' })
  ): Promise<unknown> {
    signal.throwIfAborted();
    const project = projectWorkerInput(prepared.project);
    const worker = createProjectWorkerBridge(createWorker(), () => ({ managed: true, receipt: project.receipt }));
    const requestId = 'prepared-files:' + crypto.randomUUID();
    let stop = () => {};
    const ready = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Preparing the calculation runtime timed out.')), 30000);
      const abort = () => finish(signal.reason);
      const receive = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (!isPreviewFilesReadyMessage(message) || message.requestId !== requestId) return;
        if (message.projectError) finish(new Error(message.projectError));
        else if (message.filesRevision !== 1 || !projectReceiptMatches(project.receipt, message.projectReceipt))
          finish(new Error('The prepared calculation runtime has a different revision.'));
        else finish();
      };
      const failed = () => finish(new Error('The prepared calculation worker is unavailable.'));
      function finish(error?: unknown) {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.removeEventListener('message', receive);
        worker.removeEventListener('error', failed);
        worker.removeEventListener('messageerror', failed);
        if (error !== undefined) reject(error);
        else resolve(1);
      }
      stop = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      worker.addEventListener('message', receive);
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed);
    });
    const client = createPreviewSessionClient(worker, {
      ensure: () => ready,
      hydrateSchemaDependencies: async () => false,
      dispose() {}
    });
    try {
      signal.throwIfAborted();
      worker.postMessage({ ...createPreviewSetFilesMessage([], requestId, 1), project });
      return await client.execute(functionFqn, inputs, signal);
    } finally {
      stop();
      client.dispose();
      worker.terminate();
    }
  },
  {
    op: 'executePreparedWorkflow',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
