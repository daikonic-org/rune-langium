// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for StudioToastProvider's loading-toast support: `showLoadingToast`
 * (spinner, no auto-dismiss timeout) and `dismissToast`, alongside the
 * existing `showToast`. Added for the on-demand curated hydration status
 * toast (docs/superpowers/specs/2026-05-25-curated-on-demand-hydration-design.md).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudioToastProvider, useStudioToast } from '../../src/components/StudioToastProvider.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import {
  configureInstrumentation,
  resetInstrumentationForTests,
  setInstrumentationThreshold,
  withInstrumentation
} from '../../src/services/instrumentation/core.js';

afterEach(() => cleanup());

function LoadingToastHarness() {
  const { showLoadingToast, dismissToast } = useStudioToast();
  return (
    <>
      <button onClick={() => showLoadingToast({ description: 'Loading demo.namespace…' })}>show-loading</button>
      <button
        onClick={() => {
          const id = showLoadingToast({ description: 'Loading demo.namespace…' });
          // Simulate the background process settling immediately.
          dismissToast(id);
        }}
      >
        show-and-dismiss
      </button>
    </>
  );
}

function ShowToastHarness() {
  const { showToast } = useStudioToast();
  return <button onClick={() => showToast({ description: 'Plain notification', variant: 'destructive' })}>show</button>;
}

function NotifyHarness() {
  const { notify } = useStudioToast();
  return (
    <button onClick={() => notify({ title: 'workspace', description: 'testOp', variant: 'default' })}>notify</button>
  );
}

describe('StudioToastProvider', () => {
  it('showLoadingToast renders a spinner and stays open (no auto-dismiss)', async () => {
    render(
      <StudioToastProvider>
        <LoadingToastHarness />
      </StudioToastProvider>
    );

    screen.getByText('show-loading').click();

    const toastRoot = await screen.findByRole('dialog', { name: 'Loading demo.namespace…' });
    expect(toastRoot.getAttribute('data-variant')).toBe('loading');
    expect(toastRoot.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(toastRoot.querySelector('[data-slot="toast-description"]')).toHaveTextContent('Loading demo.namespace…');
  });

  it('dismissToast removes a toast by the id showLoadingToast returned', async () => {
    render(
      <StudioToastProvider>
        <LoadingToastHarness />
      </StudioToastProvider>
    );

    screen.getByText('show-and-dismiss').click();

    // The toast was dismissed synchronously after being shown — it should
    // never end up visible to the user.
    expect(screen.queryByText('Loading demo.namespace…')).toBeNull();
  });

  it('showToast (existing behavior) still renders a non-loading toast with no spinner', async () => {
    render(
      <StudioToastProvider>
        <ShowToastHarness />
      </StudioToastProvider>
    );

    screen.getByText('show').click();

    const toastRoot = await screen.findByRole('dialog', { name: 'Plain notification' });
    expect(toastRoot.getAttribute('data-variant')).toBe('destructive');
    expect(toastRoot.querySelector('[data-slot="spinner"]')).toBeNull();
  });
});

describe('StudioToastProvider — presentation only', () => {
  beforeEach(() => {
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });
  });
  it.each(['show', 'show-and-dismiss'])('does not manufacture operation records for %s', (button) => {
    render(
      <StudioToastProvider>
        <ShowToastHarness />
        <LoadingToastHarness />
      </StudioToastProvider>
    );
    screen.getByText(button).click();
    expect(useActivityStore.getState().entries).toHaveLength(0);
    expect(useOutputStore.getState().lines).toHaveLength(0);
  });
});

describe('StudioToastProvider — notify pass-through', () => {
  beforeEach(() => {
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });
  });

  it('notify renders a toast without touching output-store or activity-store', async () => {
    render(
      <StudioToastProvider>
        <NotifyHarness />
      </StudioToastProvider>
    );
    screen.getByText('notify').click();

    const toast = await screen.findByText('testOp');
    expect(toast).toBeTruthy();
    expect(useOutputStore.getState().lines).toHaveLength(0);
    expect(useActivityStore.getState().entries).toHaveLength(0);
  });

  it('showToast also leaves operation logging to its owner', () => {
    render(
      <StudioToastProvider>
        <ShowToastHarness />
      </StudioToastProvider>
    );
    screen.getByText('show').click();
    expect(useActivityStore.getState().entries).toHaveLength(0);
  });
});

describe('StudioToastProvider — instrumentation Toast sink', () => {
  afterEach(() => {
    resetInstrumentationForTests();
  });

  it('a namespace-tagged instrumented call fires a toast via notify', async () => {
    render(
      <StudioToastProvider>
        <div />
      </StudioToastProvider>
    );
    configureInstrumentation(() => {});
    setInstrumentationThreshold('info');
    const wrapped = withInstrumentation(() => 'ok', { op: 'downloadCode', level: 'info', namespace: 'codegen' });
    wrapped();

    const toast = await screen.findByText('downloadCode');
    expect(toast).toBeTruthy();
    const toastRoot = toast.closest('[data-slot="toast"]');
    expect(toastRoot!.getAttribute('data-variant')).toBe('default');
  });

  it('an ordinary unhandled error with NO namespace does NOT fire a toast', () => {
    render(
      <StudioToastProvider>
        <div />
      </StudioToastProvider>
    );
    configureInstrumentation(() => {});
    setInstrumentationThreshold('error');
    const wrapped = withInstrumentation(
      () => {
        throw new Error('boom');
      },
      { op: 'explode' }
    );
    expect(() => wrapped()).toThrow('boom');
    expect(screen.queryByText('explode')).toBeNull();
  });

  it('a handled:true error (demoted to warn) still renders a destructive toast', async () => {
    render(
      <StudioToastProvider>
        <div />
      </StudioToastProvider>
    );
    configureInstrumentation(() => {});
    setInstrumentationThreshold('warn');
    const wrapped = withInstrumentation(
      () => {
        throw new Error('boom');
      },
      { op: 'hydrationRetryExhausted', namespace: 'curated', handled: true }
    );
    expect(() => wrapped()).toThrow('boom');

    const toast = await screen.findByText('hydrationRetryExhausted');
    const toastRoot = toast.closest('[data-slot="toast"]');
    expect(toastRoot!.getAttribute('data-variant')).toBe('destructive');
  });
});
