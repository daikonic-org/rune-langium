// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkflowArrival } from '../../../src/services/workflow-arrival.js';
function Arrival({ revision = 1, available = true }: { revision?: number; available?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useWorkflowArrival(root, 'stored', '/name', revision, available);
  return (
    <div ref={root}>
      <div data-field-path="name">
        <input aria-label="Unbound field" />
      </div>
      {available ? (
        <section data-workflow-source="stored">
          <div data-field-path="value.name">
            <input aria-label="Bound field" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('scopes payload arrival to the bound object and supports delayed schemas and repeated jumps', () => {
  const { rerender, unmount } = render(<Arrival available={false} />);
  act(() => vi.advanceTimersByTime(16));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  rerender(<Arrival />);
  act(() => vi.advanceTimersByTime(16));
  expect(screen.getByLabelText('Bound field')).toHaveFocus();
  expect(screen.getByLabelText('Unbound field')).not.toHaveFocus();
  expect(screen.getByLabelText('Bound field').parentElement).toHaveClass('navigation-arrival');
  rerender(<Arrival revision={2} />);
  act(() => vi.advanceTimersByTime(16));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  unmount();
  expect(document.querySelector('.navigation-arrival')).toBeNull();
});
