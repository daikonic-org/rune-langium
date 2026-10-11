// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstanceInspectorPanel } from '../../../src/shell/panels/InstanceInspectorPanel.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../src/store/prototype-view-store.js';

vi.mock('../../../src/shell/panels/InstanceFormPanel.js', () => ({
  InstanceFormPanel: () => (
    <div data-field-path="party">
      <input aria-label="Party" />
    </div>
  )
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = vi.fn();
  usePrototypeViewStore.getState().patch({ inspectorTab: 'form' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('cues and focuses the scoped field on each repeated payload jump, then clears on unmount', () => {
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  const outside = document.createElement('div');
  outside.dataset.fieldPath = 'party';
  document.body.prepend(outside);
  const { rerender, unmount } = render(
    <InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />
  );
  act(() => vi.advanceTimersByTime(16));
  const field = screen.getByLabelText('Party').parentElement!;
  expect(field).toHaveClass('navigation-arrival');
  expect(outside).not.toHaveClass('navigation-arrival');
  expect(screen.getByLabelText('Party')).toHaveFocus();
  act(() => vi.advanceTimersByTime(1000));
  expect(field).not.toHaveClass('navigation-arrival');
  rerender(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={2} />);
  act(() => vi.advanceTimersByTime(16));
  expect(field).toHaveClass('navigation-arrival');
  unmount();
  expect(field).not.toHaveClass('navigation-arrival');
  outside.remove();
});

it('uses a static arrival and instant scrolling for reduced motion, and cancels superseded frames', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  const { rerender } = render(
    <InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />
  );
  rerender(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/missing" focusRequestId={2} />);
  act(() => vi.advanceTimersByTime(16));
  const field = screen.getByLabelText('Party').parentElement!;
  expect(field).not.toHaveClass('navigation-arrival');
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  rerender(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={3} />);
  act(() => vi.advanceTimersByTime(16));
  expect(field).toHaveClass('navigation-arrival');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
});
