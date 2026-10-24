// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusBadge } from '../../src/components/SyncStatusBadge.js';

describe('SyncStatusBadge', () => {
  it('renders idle phase', () => {
    render(
      <SyncStatusBadge status={{ phase: 'idle', ahead: 0, behind: 0, lastSyncedSha: 's' }} onResolve={() => {}} />
    );
    expect(screen.getByTestId('sync-status').getAttribute('data-phase')).toBe('idle');
  });
  it('reflects a syncing phase', () => {
    render(
      <SyncStatusBadge status={{ phase: 'pushing', ahead: 1, behind: 0, lastSyncedSha: null }} onResolve={() => {}} />
    );
    expect(screen.getByTestId('sync-status').getAttribute('data-phase')).toBe('pushing');
  });
  it('shows resolve actions when blocked with non-empty conflictPaths', () => {
    render(
      <SyncStatusBadge
        status={{ phase: 'blocked', ahead: 1, behind: 1, lastSyncedSha: null, conflictPaths: ['a'] }}
        onResolve={() => {}}
      />
    );
    expect(screen.getByTestId('sync-resolve-keep-mine')).toBeTruthy();
    expect(screen.getByTestId('sync-resolve-take-remote')).toBeTruthy();
    expect(screen.getByText(/Merge conflict/i)).toBeTruthy();
  });
  it('shows resolve actions when blocked with empty conflictPaths (unsupported-merge path)', () => {
    render(
      <SyncStatusBadge
        status={{ phase: 'blocked', ahead: 1, behind: 1, lastSyncedSha: null, conflictPaths: [] }}
        onResolve={() => {}}
      />
    );
    expect(screen.getByTestId('sync-resolve-keep-mine')).toBeTruthy();
    expect(screen.getByTestId('sync-resolve-take-remote')).toBeTruthy();
    expect(screen.getByText(/auto-merge/i)).toBeTruthy();
  });
  it('shows an error message (no resolve buttons) when blocked without conflictPaths + auth error', () => {
    render(
      <SyncStatusBadge
        status={{
          phase: 'blocked',
          ahead: 1,
          behind: 0,
          lastSyncedSha: null,
          lastError: { code: 'auth', message: 'HTTP 401' }
        }}
        onResolve={() => {}}
      />
    );
    expect(screen.getByTestId('sync-status').getAttribute('data-phase')).toBe('blocked');
    expect(screen.queryByTestId('sync-resolve-keep-mine')).toBeNull();
    expect(screen.queryByTestId('sync-resolve-take-remote')).toBeNull();
    expect(screen.getByText(/reconnect to GitHub/i)).toBeTruthy();
  });
  it('invokes onResolve with the chosen action', async () => {
    const calls: string[] = [];
    render(
      <SyncStatusBadge
        status={{ phase: 'blocked', ahead: 1, behind: 1, lastSyncedSha: null, conflictPaths: ['a'] }}
        onResolve={(c) => calls.push(c)}
      />
    );
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByTestId('sync-resolve-keep-mine'));
    fireEvent.click(screen.getByTestId('sync-resolve-take-remote'));
    expect(calls).toEqual(['keepMine', 'takeRemote']);
  });
});

it('distinguishes uncommitted working-copy changes from synced commits', () => {
  render(
    <SyncStatusBadge
      status={{ phase: 'idle', dirty: true, ahead: 0, behind: 0, lastSyncedSha: 's' }}
      onResolve={() => {}}
    />
  );
  expect(screen.getByTestId('sync-status')).toHaveTextContent('Changes to commit');
  expect(screen.queryByText('Synced')).not.toBeInTheDocument();
});
