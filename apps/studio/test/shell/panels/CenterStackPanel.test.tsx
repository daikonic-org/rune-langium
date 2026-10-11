// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression tests for CenterStackPanel pane-switcher reachability.
 *
 * Phase 7 (PR #182) shipped Structure View as dead code — the feature lived
 * in VisualPreviewPanel which was never mounted at the user-visible site.
 * Phase 7.5 wired it as a 4th peer segment in CenterStackPanel.
 *
 * These tests assert that the Structure segment is present in the pane-switcher
 * and is activatable, preventing a future "ships-but-unreachable" regression
 * of the same class.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CenterPanesContext } from '../../../src/shell/center-panes-context.js';
import type { CenterPanesContextValue } from '../../../src/shell/center-panes-context.js';
import { CenterStackPanel } from '../../../src/shell/panels/CenterStackPanel.js';

// GraphFilterMenu touches its own context — mock it to avoid setup burden.
vi.mock('../../../src/components/GraphFilterMenu.js', () => ({
  GraphFilterMenu: () => React.createElement('div', { 'data-testid': 'graph-filter-menu' })
}));

// lucide-react icons — provide stubs so jsdom doesn't have to handle SVG.
vi.mock('lucide-react', () => ({
  Network: () => React.createElement('span'),
  FileCode2: (props: React.HTMLAttributes<HTMLSpanElement>) => React.createElement('span', props),
  Info: () => React.createElement('span'),
  Layers: () => React.createElement('span'),
  MoreHorizontal: () => React.createElement('span')
}));

function makeContextValue(activePanes: Set<string>): CenterPanesContextValue {
  return {
    activePanes: activePanes as Set<import('../../../src/shell/center-panes-context.js').CenterPane>,
    toggle: vi.fn()
  };
}

function renderWithPanes(activePanes: Set<string>, props?: Partial<React.ComponentProps<typeof CenterStackPanel>>) {
  const ctx = makeContextValue(activePanes);
  return render(
    <CenterPanesContext.Provider value={ctx}>
      <CenterStackPanel
        renderGraph={() => React.createElement('div', { 'data-testid': 'graph-pane' })}
        renderSource={() => React.createElement('div', { 'data-testid': 'source-pane' })}
        renderInspector={() => React.createElement('div', { 'data-testid': 'inspector-pane' })}
        renderStructure={() => React.createElement('div', { 'data-testid': 'structure-empty-state' })}
        {...props}
      />
    </CenterPanesContext.Provider>
  );
}

describe('CenterStackPanel — Structure segment reachability (Phase 7.5 regression guard)', () => {
  it('distinguishes the primary view from panes shown alongside it', () => {
    renderWithPanes(new Set(['structure', 'source']));
    const view = within(screen.getByRole('group', { name: 'View' }));
    expect(view.getByRole('button', { name: 'Graph' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Structure' })).toHaveAttribute('aria-pressed', 'true');
    expect(view.queryByRole('button', { name: 'Source' })).not.toBeInTheDocument();
    const companions = within(screen.getByRole('group', { name: 'Show alongside' }));
    expect(companions.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    expect(companions.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('View')).not.toBeInTheDocument();
    expect(screen.queryByText('Show alongside')).not.toBeInTheDocument();
  });
  it('renders a Structure segment button in the pane-switcher', () => {
    renderWithPanes(new Set(['graph']));
    expect(screen.getByRole('button', { name: /structure/i })).toBeInTheDocument();
  });

  it('renders all 4 pane segments (Graph, Structure, Source, Inspector)', () => {
    renderWithPanes(new Set(['graph']));
    expect(screen.getByRole('button', { name: /graph/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /structure/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /source/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /inspector/i })).toBeInTheDocument();
  });

  it('Structure segment is not active by default', () => {
    renderWithPanes(new Set(['graph']));
    const btn = screen.getByRole('button', { name: /structure/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking the Structure segment calls toggle("structure")', async () => {
    const user = userEvent.setup();
    const ctx = makeContextValue(new Set(['graph']));
    render(
      <CenterPanesContext.Provider value={ctx}>
        <CenterStackPanel
          renderGraph={() => null}
          renderSource={() => null}
          renderInspector={() => null}
          renderStructure={() => React.createElement('div', { 'data-testid': 'structure-empty-state' })}
        />
      </CenterPanesContext.Provider>
    );
    await user.click(screen.getByRole('button', { name: /structure/i }));
    expect(ctx.toggle).toHaveBeenCalledWith('structure');
  });

  it('activating Structure mounts the structure view content', () => {
    // Render with structure already active
    renderWithPanes(new Set(['graph', 'structure']));
    expect(screen.getByTestId('structure-empty-state')).toBeInTheDocument();
  });

  it('Structure segment is marked active when the pane is in activePanes', () => {
    renderWithPanes(new Set(['graph', 'structure']));
    expect(screen.getByRole('button', { name: /structure/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Source navigation feedback', () => {
  it('delays a text-free cue, then clears it on completion', () => {
    vi.useFakeTimers();
    try {
      const request = {};
      const ctx = makeContextValue(new Set(['graph', 'source']));
      const panel = (pending: object | null) => (
        <CenterPanesContext.Provider value={ctx}>
          <CenterStackPanel
            renderGraph={() => null}
            renderSource={() => null}
            renderInspector={() => null}
            renderStructure={() => null}
            sourceNavigationPending={pending}
          />
        </CenterPanesContext.Provider>
      );
      const view = render(panel(request));
      const button = screen.getByRole('button', { name: 'Source' });
      expect(button.querySelector('.studio-navigation-pending')).toBeNull();
      act(() => vi.advanceTimersByTime(250));
      expect(button.querySelector('.studio-navigation-pending')).not.toBeNull();
      expect(button.textContent).toBe('Source');
      view.rerender(panel(null));
      expect(button.querySelector('.studio-navigation-pending')).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cue a hidden source pane', () => {
    vi.useFakeTimers();
    try {
      const view = renderWithPanes(new Set(['graph']), { sourceNavigationPending: {} });
      act(() => vi.advanceTimersByTime(500));
      expect(view.container.querySelector('.studio-navigation-pending')).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
