// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkflowArrival } from '../../../src/services/workflow-arrival.js';
function Arrival({
  revision = 1,
  available = true,
  pointer = '/name',
  prefix = 'value',
  collapsed = false
}: {
  revision?: number;
  available?: boolean;
  pointer?: string;
  prefix?: string;
  collapsed?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useWorkflowArrival(root, 'stored', pointer, revision, available);
  return (
    <div ref={root}>
      <div data-field-path="name">
        <input aria-label="Unbound field" />
      </div>
      {available ? (
        <section data-workflow-source="stored" data-workflow-source-path={prefix}>
          <div data-field-path={collapsed ? `${prefix}.items` : `${prefix}.name`}>
            {collapsed ? <button>Collection action</button> : null}
            {collapsed ? (
              <div data-field-path={`${prefix}.items[0]`}>
                <button>Open bound row</button>
              </div>
            ) : null}
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
it.each(['party', 'parties[0]'])('focuses the closest collapsed row within binding %s', (prefix) => {
  render(<Arrival pointer="/items/0/nested" prefix={prefix} collapsed />);
  act(() => vi.advanceTimersByTime(16));
  expect(screen.getByRole('button', { name: 'Open bound row' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Collection action' })).not.toHaveFocus();
  expect(screen.getByRole('button', { name: 'Open bound row' }).parentElement).toHaveClass('navigation-arrival');
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
