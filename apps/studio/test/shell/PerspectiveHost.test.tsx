// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PerspectiveHost } from '../../src/shell/perspectives/PerspectiveHost.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

// Mock only the Workspaces launcher — the host-level fallback renders it for
// workspace-requiring perspectives with no workspace, and the real one pulls
// in WorkspaceActionsContext + FileLoader/ModelLoader. SettingsPerspective is
// left real (test 1 asserts its rendered output).
vi.mock('../../src/shell/perspectives/screens/WorkspacesPerspective.js', () => ({
  WorkspacesPerspective: () => <div data-testid="workspaces-perspective" />
}));

// PerspectiveHost now renders the real ExplorePerspective in its keep-alive
// slot. Mock it with a mount-count probe so the keep-alive assertion (Explore
// subtree NOT remounted across a perspective switch) is exercised against the
// production wiring rather than a prop that no longer exists.
const { exploreMounts } = vi.hoisted(() => ({ exploreMounts: { count: 0 } }));
vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useEffect: useEffectImpl } = await import('react');
  function ExploreProbe() {
    useEffectImpl(() => {
      exploreMounts.count += 1;
    }, []);
    return <div data-testid="explore-probe" />;
  }
  return { ExplorePerspective: ExploreProbe };
});

describe('PerspectiveHost', () => {
  beforeEach(() => {
    exploreMounts.count = 0;
    usePerspectiveStore.setState({ activePerspective: 'explore' });
  });

  it('keeps Explore mounted (never remounts) across a switch away and back', () => {
    render(<PerspectiveHost hasWorkspace hasExploreContent />);
    const slot = () => screen.getByTestId('explore-probe').closest('[data-perspective-slot="explore"]') as HTMLElement;
    const editor = screen.getByTestId('explore-probe');
    expect(exploreMounts.count).toBe(1);
    expect(slot().style.display).not.toBe('none'); // visible when active

    act(() => usePerspectiveStore.getState().setActivePerspective('settings'));
    // Explore probe still in the DOM (kept alive), just hidden — NOT remounted
    expect(exploreMounts.count).toBe(1);
    expect(screen.getByTestId('explore-probe')).toBeTruthy();
    expect(slot().style.display).toBe('none');
    expect(screen.getByTestId('settings-perspective')).toBeTruthy(); // the active screen renders

    act(() => usePerspectiveStore.getState().setActivePerspective('explore'));
    expect(exploreMounts.count).toBe(1); // STILL 1 — definitive: no remount
    expect(screen.getByTestId('explore-probe')).toBe(editor);
    expect(slot().style.display).not.toBe('none');
  });

  it('git/export fall back to the Workspaces launcher without a workspace (no blank pane, Codex P2 #238)', () => {
    usePerspectiveStore.setState({ activePerspective: 'git' });
    render(<PerspectiveHost hasWorkspace={false} hasExploreContent={false} />);
    // git is workspace-requiring, so with no workspace it must NOT render…
    expect(screen.queryByTestId('git-perspective')).toBeNull();
    // …and the host falls back to the always-available Workspaces launcher.
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
  });

  it('renders PrototypePerspective when the active perspective is "prototype" (Task 17: was previously a blank pane)', () => {
    usePerspectiveStore.setState({ activePerspective: 'prototype' });
    render(<PerspectiveHost hasWorkspace hasExploreContent />);
    expect(screen.getByTestId('prototype-perspective')).toBeTruthy();
  });
});

it('keeps a visited Prototype mounted across perspective switches and disposes it across workspaces', async () => {
  usePerspectiveStore.setState({ activePerspective: 'prototype' });
  const { rerender } = render(<PerspectiveHost hasWorkspace hasExploreContent workspaceId="first" />);
  const prototype = screen.getByTestId('prototype-perspective');
  act(() => usePerspectiveStore.getState().setActivePerspective('settings'));
  expect(screen.getByTestId('prototype-perspective')).toBe(prototype);
  expect(prototype).not.toBeVisible();
  act(() => usePerspectiveStore.getState().setActivePerspective('prototype'));
  expect(screen.getByTestId('prototype-perspective')).toBe(prototype);
  expect(prototype).toBeVisible();
  act(() => usePerspectiveStore.getState().setActivePerspective('settings'));
  rerender(<PerspectiveHost hasWorkspace hasExploreContent workspaceId="second" />);
  expect(screen.queryByTestId('prototype-perspective')).not.toBeInTheDocument();
});
