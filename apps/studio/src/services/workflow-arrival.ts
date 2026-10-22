// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { payloadPointerToFieldPath } from './instance-payload-graph.js';
import { emphasizeNavigationArrival } from '../utils/navigation-arrival.js';
import { withInstrumentation } from './instrumentation/core.js';

export const useWorkflowArrival = withInstrumentation(
  function useWorkflowArrival(
    root: RefObject<HTMLElement | null>,
    instanceId: string | undefined,
    pointer: string | undefined,
    revision: number | undefined,
    schemaRevision: unknown
  ) {
    const request = useMemo(() => ({ instanceId, pointer, revision }), [instanceId, pointer, revision]);
    const consumed = useRef<unknown>(undefined);
    const clear = useRef<(() => void) | undefined>(undefined);
    useEffect(
      () => () => {
        clear.current?.();
        clear.current = undefined;
      },
      [request]
    );
    useEffect(() => {
      if (!pointer || consumed.current === request) return;
      const path = payloadPointerToFieldPath(pointer);
      if (!path) return;
      const frame = requestAnimationFrame(() => {
        const owner = [...(root.current?.querySelectorAll<HTMLElement>('[data-workflow-source]') ?? [])].find(
          (el) => el.dataset.workflowSource === instanceId
        );
        const fields = [...(owner?.querySelectorAll<HTMLElement>('[data-field-path]') ?? [])];
        const field =
          fields.find((el) => el.dataset.fieldPath === path || el.dataset.fieldPath?.endsWith('.' + path)) ??
          fields
            .filter((el) => path.startsWith(`${el.dataset.fieldPath}.`) || path.startsWith(`${el.dataset.fieldPath}[`))
            .sort((a, b) => b.dataset.fieldPath!.length - a.dataset.fieldPath!.length)[0];
        if (!field) return;
        consumed.current = request;
        field.scrollIntoView({ block: 'center' });
        clear.current = emphasizeNavigationArrival(field);
        (field.querySelector<HTMLElement>('input,button,[role="combobox"]') ?? field).focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }, [root, request, schemaRevision]);
  },
  {
    op: 'useWorkflowArrival',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
