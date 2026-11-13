// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { configureInstrumentation, resetInstrumentationForTests } from '@rune-langium/instrumentation-core';
import { InstrumentationErrorBoundary } from '../../src/components/InstrumentationErrorBoundary.js';

function Bomb(): never {
  throw new Error('render crash');
}

describe('InstrumentationErrorBoundary', () => {
  it('renders a fallback and emits an error-level record when a child throws during render', () => {
    resetInstrumentationForTests();
    const emitted: unknown[] = [];
    configureInstrumentation((r) => emitted.push(r));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs the caught error too
    render(
      <InstrumentationErrorBoundary>
        <Bomb />
      </InstrumentationErrorBoundary>
    );
    expect(screen.getByRole('heading', { name: 'Studio couldn’t display this view' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload Studio' })).toBeVisible();
    expect(screen.queryByText('render crash')).not.toBeInTheDocument();
    expect(emitted).toEqual([expect.objectContaining({ op: 'ReactRenderCrash', level: 'error' })]);
    consoleError.mockRestore();
  });
});
