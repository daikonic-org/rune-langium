// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { ProjectResolutionReceipt } from '@rune-langium/core/project-contract';
import { projectReceiptMatches } from '@rune-langium/project-runtime/receipt';
import { withInstrumentation } from './instrumentation/core.js';

export interface ProjectWorkerState {
  managed: boolean;
  receipt?: ProjectResolutionReceipt;
}

/** Keep unavailable outcomes on the existing operation-specific response channels. */
export const projectOperationError = withInstrumentation(
  function projectOperationError(message: Record<string, unknown>, error: string): Record<string, unknown> | undefined {
    const base = { requestId: message.requestId };
    switch (message.type) {
      case 'preview:execute':
        return { ...base, type: 'preview:execute-error', funcName: message.funcName, error };
      case 'preview:generate':
        return {
          ...base,
          type: 'preview:stale',
          targetId: message.targetId,
          reason: 'generation-error',
          message: error
        };
      case 'instance:generateSchema':
        return { ...base, type: 'instance:generateSchemaStale', reason: 'generation-error', message: error };
      case 'instance:validate':
        return {
          ...base,
          type: 'instance:validateResult',
          unavailable: error,
          diagnostics: [{ path: '', message: error }]
        };
      case 'projection:generate':
        return { ...base, type: 'projection:error', error };
      case 'codegen:generate':
        return { ...base, type: 'codegen:error', target: message.target, message: error };
      default:
        return undefined;
    }
  },
  { op: 'projectOperationError', capture: 0 }
);

/** One receipt boundary for all clients sharing the dedicated preview worker. */
export const createProjectWorkerBridge = withInstrumentation(
  function createProjectWorkerBridge(raw: Worker, state: () => ProjectWorkerState): Worker {
    const messages = new EventTarget();
    const pending = new Map<string, { message: Record<string, unknown>; receipt?: ProjectResolutionReceipt }>();
    let installed: ProjectWorkerState = { managed: false };
    let onmessage: Worker['onmessage'] = null;
    const same = (a: ProjectWorkerState, b: ProjectWorkerState) =>
      a.managed === b.managed && (a.receipt ? projectReceiptMatches(a.receipt, b.receipt) : !b.receipt);
    const deliver = (data: unknown) => {
      const event = new MessageEvent('message', { data });
      messages.dispatchEvent(event);
      onmessage?.call(raw, event);
    };
    const fail = (entry: { message: Record<string, unknown> }, error: string) => {
      const response = projectOperationError(entry.message, error);
      if (response) deliver(response);
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'preview:files-ready' || !message.requestId) return deliver(message);
      const entry = pending.get(message.requestId);
      const current = state();
      const expected = entry ? { managed: Boolean(entry.receipt), receipt: entry.receipt } : current;
      const actual = { managed: Boolean(message.projectReceipt), receipt: message.projectReceipt };
      if (entry) pending.delete(message.requestId);
      if (!same(expected, current) || !same(expected, actual)) {
        if (entry) fail(entry, 'Project changed before the operation completed. Retry with the current project.');
        return;
      }
      deliver(message);
    };
    raw.addEventListener('message', receive);
    return new Proxy(raw, {
      get(target, property) {
        if (property === 'postMessage')
          return (message: Record<string, unknown>, options?: StructuredSerializeOptions | Transferable[]) => {
            const current = state();
            if (message.type === 'preview:setFiles') {
              if (!same(installed, current)) {
                const cancelled = [...pending.values()];
                pending.clear();
                for (const entry of cancelled)
                  fail(entry, 'Project changed before the operation completed. Retry with the current project.');
              }
              installed = current;
            }
            const operation = projectOperationError(message, '');
            if (operation && current.managed && !current.receipt)
              throw new Error('Project resolution is not available yet.');
            const tagged = operation && current.receipt ? { ...message, projectReceipt: current.receipt } : message;
            if (operation && typeof message.requestId === 'string')
              pending.set(message.requestId, { message, receipt: current.receipt });
            try {
              if (options === undefined) target.postMessage(tagged);
              else if (Array.isArray(options)) target.postMessage(tagged, options);
              else target.postMessage(tagged, options);
            } catch (error) {
              if (typeof message.requestId === 'string') pending.delete(message.requestId);
              throw error;
            }
          };
        if (property === 'addEventListener' || property === 'removeEventListener')
          return (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions
          ) => {
            const owner = type === 'message' ? messages : target;
            owner[property](type, listener, options);
          };
        if (property === 'onmessage') return onmessage;
        if (property === 'terminate')
          return () => {
            raw.removeEventListener('message', receive);
            pending.clear();
            raw.terminate();
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, property, value) {
        if (property === 'onmessage') {
          onmessage = value;
          return true;
        }
        return Reflect.set(target, property, value, target);
      }
    });
  },
  { op: 'createProjectWorkerBridge', capture: 0 }
);
