// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityBar } from '../../src/shell/ActivityBar.js';
import { PerspectiveHost } from '../../src/shell/perspectives/PerspectiveHost.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

// Mock the four on-demand screens to isolate the rail↔host wiring (each has its
// own tests).
vi.mock('../../src/shell/perspectives/screens/WorkspacesPerspective.js', () => ({
  WorkspacesPerspective: () => <div data-testid="workspaces-perspective" />
}));
vi.mock('../../src/shell/perspectives/screens/SettingsPerspective.js', () => ({
  SettingsPerspective: () => <div data-testid="settings-perspective" />
}));
vi.mock('../../src/shell/perspectives/screens/GitSyncPerspective.js', () => ({
  GitSyncPerspective: () => <div data-testid="git-perspective" />
}));
vi.mock('../../src/shell/perspectives/screens/ExportPerspective.js', () => ({
  ExportPerspective: () => <div data-testid="export-perspective" />
}));

// PerspectiveHost renders the real ExplorePerspective in its keep-alive slot;
// mock it with a mount-count probe so the keep-alive assertion exercises the
// production wiring.
const { exploreMounts } = vi.hoisted(() => ({ exploreMounts: { count: 0 } }));
vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useEffect } = await import('react');
  function ExploreProbe() {
    useEffect(() => {
      exploreMounts.count += 1;
    }, []);
    return <div data-testid="explore-probe" />;
  }
  return { ExplorePerspective: ExploreProbe };
});

function Shell({
  hasWorkspace,
  hasExploreContent = hasWorkspace
}: {
  hasWorkspace: boolean;
  hasExploreContent?: boolean;
}) {
  return (
    <>
      <ActivityBar hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />
      <PerspectiveHost hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />
    </>
  );
}

describe('perspectives rail↔host integration', () => {
  beforeEach(() => {
    exploreMounts.count = 0;
    usePerspectiveStore.setState({ activePerspective: 'explore' });
  });

  it('rail click swaps the content region', () => {
    render(<Shell hasWorkspace />);
    expect(screen.getByTestId('explore-probe')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rail-git'));
    expect(screen.getByTestId('git-perspective')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rail-settings'));
    expect(screen.getByTestId('settings-perspective')).toBeTruthy();
  });

  it('keeps Explore mounted (never remounts) across rail switches', () => {
    render(<Shell hasWorkspace />);
    expect(exploreMounts.count).toBe(1);
    fireEvent.click(screen.getByTestId('rail-git'));
    fireEvent.click(screen.getByTestId('rail-export'));
    fireEvent.click(screen.getByTestId('rail-explore'));
    expect(exploreMounts.count).toBe(1); // definitive keep-alive across multiple switches
  });

  it('disables git/export in the rail without a workspace; workspaces is the entry', () => {
    usePerspectiveStore.setState({ activePerspective: 'workspaces' });
    render(<Shell hasWorkspace={false} />);
    expect((screen.getByTestId('rail-git') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('rail-export') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('rail-explore') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
  });

  it('enables Explore for model-only content while keeping git/export disabled', () => {
    usePerspectiveStore.setState({ activePerspective: 'workspaces' });
    render(<Shell hasWorkspace={false} hasExploreContent />);
    expect((screen.getByTestId('rail-explore') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('rail-git') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('rail-export') as HTMLButtonElement).disabled).toBe(true);
  });

  // Codex P2 (#238): hasWorkspace can drop to false while the store is still on
  // a workspace-requiring perspective (e.g. last editable file deleted in
  // Explore). Without a host-level fallback the content pane goes blank and the
  // rail button is disabled — a dead-end.
  it('falls back to Workspaces when Explore is active without a workspace (no blank pane)', () => {
    usePerspectiveStore.setState({ activePerspective: 'explore' });
    render(<PerspectiveHost hasWorkspace={false} hasExploreContent={false} />);
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
    const exploreSlot = document.querySelector('[data-perspective-slot="explore"]') as HTMLElement;
    expect(exploreSlot).not.toBeVisible();
    expect(exploreSlot).toHaveAttribute('inert');
    expect(exploreSlot.style.display).not.toBe('none');
  });

  it('falls back to Workspaces from git/export without a workspace', () => {
    usePerspectiveStore.setState({ activePerspective: 'git' });
    const { rerender } = render(<PerspectiveHost hasWorkspace={false} hasExploreContent={false} />);
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
    expect(screen.queryByTestId('git-perspective')).toBeNull();

    usePerspectiveStore.setState({ activePerspective: 'export' });
    rerender(<PerspectiveHost hasWorkspace={false} hasExploreContent={false} />);
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
    expect(screen.queryByTestId('export-perspective')).toBeNull();
  });

  it('does NOT fall back when the workspace is present (Explore renders)', () => {
    usePerspectiveStore.setState({ activePerspective: 'explore' });
    render(<PerspectiveHost hasWorkspace hasExploreContent />);
    const exploreSlot = document.querySelector('[data-perspective-slot="explore"]') as HTMLElement;
    expect(exploreSlot.style.display).toBe('');
    expect(screen.queryByTestId('workspaces-perspective')).toBeNull();
  });

  it('does NOT fall back when Explore is active with model-only content', () => {
    usePerspectiveStore.setState({ activePerspective: 'explore' });
    render(<PerspectiveHost hasWorkspace={false} hasExploreContent />);
    const exploreSlot = document.querySelector('[data-perspective-slot="explore"]') as HTMLElement;
    expect(exploreSlot.style.display).toBe('');
    expect(screen.queryByTestId('workspaces-perspective')).toBeNull();
  });
});
