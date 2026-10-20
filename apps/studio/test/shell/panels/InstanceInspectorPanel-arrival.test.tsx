// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstanceInspectorPanel } from '../../../src/shell/panels/InstanceInspectorPanel.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../src/store/prototype-view-store.js';

const formState = vi.hoisted(() => ({ available: true }));

vi.mock('../../../src/shell/panels/InstanceFormPanel.js', () => ({
  InstanceFormPanel: () =>
    formState.available ? (
      <div data-field-path="party">
        <input aria-label="Party" />
      </div>
    ) : null
}));

beforeEach(() => {
  formState.available = true;
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

function deliverSchema() {
  const postMessage = vi.fn();
  const store = useInstanceStore.getState();
  store.setWorker({ postMessage } as unknown as Worker);
  store.dispatchGenerateSchema('test.Trade');
  store.receiveSchemaResult(postMessage.mock.calls.at(-1)![0].requestId, {
    schemaVersion: 1,
    targetId: 'test.Trade',
    title: 'Trade',
    status: 'ready',
    fields: [{ path: 'party', label: 'Party', kind: 'string', required: true }]
  });
}

it('does not refocus, scroll, reopen the form tab, or cue again after schema regeneration', () => {
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  render(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />);
  act(() => vi.advanceTimersByTime(1016));
  const outside = document.createElement('input');
  document.body.append(outside);
  outside.focus();
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  act(() => usePrototypeViewStore.getState().patch({ inspectorTab: 'functions' }));
  act(deliverSchema);
  act(() => vi.advanceTimersByTime(16));
  expect(usePrototypeViewStore.getState().state.inspectorTab).toBe('functions');
  expect(outside).toHaveFocus();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(document.querySelector('.navigation-arrival')).toBeNull();
  outside.remove();
});

it('retries a pending destination when schema makes its field available and consumes it once', () => {
  formState.available = false;
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  render(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />);
  act(() => vi.advanceTimersByTime(16));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  formState.available = true;
  act(deliverSchema);
  act(() => vi.advanceTimersByTime(16));
  expect(screen.getByLabelText('Party').parentElement).toHaveClass('navigation-arrival');
  act(() => vi.advanceTimersByTime(1000));
  act(deliverSchema);
  act(() => vi.advanceTimersByTime(16));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Party').parentElement).not.toHaveClass('navigation-arrival');
});

it('cancels a pending field jump when its request is removed before schema arrival', () => {
  formState.available = false;
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  const { rerender } = render(
    <InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />
  );
  act(() => vi.advanceTimersByTime(16));
  rerender(<InstanceInspectorPanel instanceId={instanceId} />);
  formState.available = true;
  act(deliverSchema);
  act(() => vi.advanceTimersByTime(16));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Party').parentElement).not.toHaveClass('navigation-arrival');
});

it('keeps the original cue lifetime across schema refresh and disposes it when the instance disappears', () => {
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  const { rerender } = render(
    <InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={1} />
  );
  act(() => vi.advanceTimersByTime(16));
  const field = screen.getByLabelText('Party').parentElement!;
  act(() => vi.advanceTimersByTime(500));
  act(deliverSchema);
  expect(field).toHaveClass('navigation-arrival');
  act(() => vi.advanceTimersByTime(500));
  expect(field).not.toHaveClass('navigation-arrival');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  rerender(<InstanceInspectorPanel instanceId={instanceId} focusedPayloadPointer="/party" focusRequestId={2} />);
  act(() => vi.advanceTimersByTime(16));
  expect(field).toHaveClass('navigation-arrival');
  act(() =>
    useInstanceStore.setState((state) => ({
      instances: Object.fromEntries(Object.entries(state.instances).filter(([id]) => id !== instanceId))
    }))
  );
  expect(field).not.toHaveClass('navigation-arrival');
});

it('lands on the nearest collection item when a requested detail field is closed', () => {
  const instanceId = useInstanceStore.getState().createInstance('test.Trade', 'Trade');
  render(
    <InstanceInspectorPanel
      instanceId={instanceId}
      focusedPayloadPointer="/party/contacts/0/email"
      focusRequestId={1}
    />
  );
  act(() => vi.advanceTimersByTime(16));
  expect(screen.getByLabelText('Party').parentElement).toHaveClass('navigation-arrival');
  expect(screen.getByLabelText('Party')).toHaveFocus();
});
