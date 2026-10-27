// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T032e — GitHubWorkspaceFlow happy-path + URL parsing.
 *
 * Verifies the auth → URL form → clone → onCreated transition.
 * The `createWorkspace` prop is injected so the test doesn't need a
 * real OPFS root or a real git clone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { GitHubInitializationSession } from '../../src/workspace/project-initialization.js';
import { GitHubWorkspaceFlow } from '../../src/components/GitHubWorkspaceFlow.js';

const AUTH_BASE = 'https://www.daikonic.dev/rune-studio/api/github-auth';

describe('GitHubWorkspaceFlow (T032e / FR-012)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock the device-flow init so the auth dialog mounts cleanly. Poll
    // returns the access token on the first call so the click-then-poll
    // path completes synchronously inside the test's waitFor budget;
    // the multi-poll behaviour is covered by GitHubConnectDialog's own
    // tests, not here.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: URL | string) => {
      const u = String(url);
      if (u === 'https://api.github.com/user') return Promise.resolve(Response.json({ login: 'octocat' }));
      if (u === 'https://api.github.com/repos/example/starter/forks')
        return Promise.resolve(
          Response.json(
            {
              name: 'starter',
              owner: { login: 'octocat' },
              default_branch: 'release',
              fork: true,
              parent: { full_name: 'example/starter' }
            },
            { status: 202 }
          )
        );
      if (u.endsWith('/device-init')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              device_code: 'devcode',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      if (u.endsWith('/device-poll')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'gho_test', scope: 'repo' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as unknown as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => fetchSpy.mockRestore());

  it('creates a real user fork after sign-in and retries only cloning that fork', async () => {
    const createWorkspace = vi
      .fn()
      .mockRejectedValueOnce(new Error('GitHub is preparing the fork.'))
      .mockResolvedValueOnce({ id: 'fork-workspace' });
    const onCreated = vi.fn();
    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        forkSource="example/starter"
        onCreated={onCreated}
        onCancel={vi.fn()}
        createWorkspace={createWorkspace}
      />
    );
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/forks'))).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create fork' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is preparing');
    expect(createWorkspace).toHaveBeenCalledWith({
      name: 'octocat/starter',
      repoUrl: 'https://github.com/octocat/starter.git',
      branch: 'release',
      user: 'octocat',
      token: 'gho_test'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open fork' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('fork-workspace'));
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/forks'))).toHaveLength(1);
  });

  it('after auth, surfaces a repo-URL form (transitions auth → url)', async () => {
    const createWorkspace = vi.fn();
    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        onCreated={() => {}}
        onCancel={() => {}}
        createWorkspace={createWorkspace}
      />
    );
    // Force the dialog out of pending by clicking "I've authorised — check now".
    const checkBtn = await screen.findByRole('button', { name: /check now/i });
    fireEvent.click(checkBtn);
    await waitFor(() => {
      expect(screen.getByTestId('github-repo-form')).toBeInTheDocument();
    });
    expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
  });

  it('Clone button is disabled until a parseable repo URL is typed', async () => {
    const createWorkspace = vi.fn();
    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        onCreated={() => {}}
        onCancel={() => {}}
        createWorkspace={createWorkspace}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
    await waitFor(() => screen.getByTestId('github-repo-form'));

    const cloneBtn = screen.getByRole('button', { name: /^Clone$/ });
    expect(cloneBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'pradeepmouli/rune-langium' }
    });
    expect(cloneBtn).not.toBeDisabled();
  });

  it('Clone calls createWorkspace with the parsed canonical URL + token', async () => {
    const createWorkspace = vi
      .fn<
        (input: {
          name: string;
          repoUrl: string;
          branch: string;
          user: string;
          token: string;
        }) => Promise<{ id: string }>
      >()
      .mockResolvedValue({ id: 'NEW_WS_ID' });
    const onCreated = vi.fn();

    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        onCreated={onCreated}
        onCancel={() => {}}
        createWorkspace={createWorkspace}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
    await waitFor(() => screen.getByTestId('github-repo-form'));

    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/pradeepmouli/rune-langium' }
    });
    fireEvent.click(screen.getByRole('button', { name: /^Clone$/ }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledOnce();
    });
    expect(createWorkspace).toHaveBeenCalledWith({
      name: 'pradeepmouli/rune-langium',
      repoUrl: 'https://github.com/pradeepmouli/rune-langium.git',
      branch: 'main',
      user: 'pradeepmouli',
      token: 'gho_test'
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('NEW_WS_ID');
    });
  });

  it('shows an inline error banner when createWorkspace throws', async () => {
    const createWorkspace = vi
      .fn<
        (input: {
          name: string;
          repoUrl: string;
          branch: string;
          user: string;
          token: string;
        }) => Promise<{ id: string }>
      >()
      .mockRejectedValue(new Error('clone failed: 404'));

    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        onCreated={() => {}}
        onCancel={() => {}}
        createWorkspace={createWorkspace}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
    await waitFor(() => screen.getByTestId('github-repo-form'));

    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'pradeepmouli/missing' }
    });
    fireEvent.click(screen.getByRole('button', { name: /^Clone$/ }));

    await waitFor(() => {
      expect(screen.getByTestId('github-clone-error')).toBeInTheDocument();
    });
    // Friendly copy: a "404" surfaces as a user-facing "Repository not found"
    // headline; the raw text is no longer leaked into the banner.
    expect(screen.getByTestId('github-clone-error')).toHaveTextContent(/repository not found/i);
  });
  async function cloneForReview(
    openProjectInitialization: (id: string) => Promise<GitHubInitializationSession | undefined>,
    onCreated = vi.fn()
  ) {
    const createWorkspace = vi.fn().mockResolvedValue({ id: 'preserved-clone' });
    render(
      <GitHubWorkspaceFlow
        authBase={AUTH_BASE}
        onCreated={onCreated}
        onCancel={vi.fn()}
        createWorkspace={createWorkspace}
        openProjectInitialization={openProjectInitialization}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
    await screen.findByTestId('github-repo-form');
    fireEvent.change(screen.getByTestId('repo-url-input'), { target: { value: 'example/project' } });
    fireEvent.change(screen.getByTestId('repo-branch-input'), { target: { value: 'release' } });
    fireEvent.click(screen.getByRole('button', { name: /^Clone$/ }));
    return { createWorkspace, onCreated };
  }
  it('reviews settings after clone without activating or changing remote identity', async () => {
    const save = vi.fn();
    const dispose = vi.fn();
    const open = vi.fn().mockResolvedValue({
      snapshot: {},
      prepare: vi
        .fn()
        .mockResolvedValue({ provenance: { profiles: [] }, report: [], writes: [{ path: 'build-config.yml' }] }),
      save,
      dispose
    });
    const { createWorkspace, onCreated } = await cloneForReview(open);
    await screen.findByRole('button', { name: 'Initialize project settings' });
    expect(open).toHaveBeenCalledWith('preserved-clone');
    expect(onCreated).not.toHaveBeenCalled();
    expect(createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: 'https://github.com/example/project.git', branch: 'release' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('preserved-clone'));
    expect(save).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
  it('retains the successfully cloned repository when initialization fails', async () => {
    const { createWorkspace, onCreated } = await cloneForReview(
      vi.fn().mockRejectedValue(new Error('Ambiguous build config'))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Ambiguous build config');
    expect(screen.queryByTestId('github-clone-error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('preserved-clone'));
    expect(createWorkspace).toHaveBeenCalledOnce();
  });
  it('activates plain or configured clones without a review step', async () => {
    const { onCreated } = await cloneForReview(vi.fn().mockResolvedValue(undefined));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('preserved-clone'));
    expect(screen.queryByRole('button', { name: 'Initialize project settings' })).not.toBeInTheDocument();
  });
});
