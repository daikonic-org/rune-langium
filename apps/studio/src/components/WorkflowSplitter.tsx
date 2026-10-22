// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useRef, type RefObject } from 'react';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkflowSplitter = withInstrumentation(
  function WorkflowSplitter({
    label,
    value,
    max = 40,
    className,
    container,
    onChange,
    onCommit
  }: {
    label: string;
    value: number;
    max?: number;
    className: string;
    container: RefObject<HTMLElement | null>;
    onChange(value: number): void;
    onCommit(value: number): void;
  }) {
    const drag = useRef<{ id: number; x: number; value: number; latest: number } | undefined>(undefined);
    const clamp = (next: number) => Math.max(22, Math.min(max, next));
    const finish = () => {
      if (!drag.current) return;
      const next = drag.current.latest;
      drag.current = undefined;
      onCommit(next);
    };
    return (
      <div
        role="separator"
        className={className}
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={22}
        aria-valuemax={max}
        aria-valuenow={value}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowLeft'
              ? value - 2
              : event.key === 'ArrowRight'
                ? value + 2
                : event.key === 'Home'
                  ? 22
                  : event.key === 'End'
                    ? max
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          onChange(clamp(next));
          onCommit(clamp(next));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, value, latest: value };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          const next = clamp(
            current.value + ((event.clientX - current.x) / (container.current?.clientWidth ?? 1)) * 100
          );
          current.latest = next;
          onChange(next);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    );
  },
  {
    op: 'WorkflowSplitter',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
