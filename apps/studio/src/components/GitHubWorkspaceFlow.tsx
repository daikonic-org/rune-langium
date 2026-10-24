// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * GitHubWorkspaceFlow — wraps the auth dialog with a follow-up
 * "paste your repo URL" step + the actual clone (T032e).
 *
 * Lifecycle:
 *  1. mount        → render <GitHubConnectDialog/>; user does device flow
 *  2. on token     → render the URL form; user enters repo URL + branch
 *  3. on submit    → call WorkspaceManager.createGitBacked + onCreated
 *  4. cancel/back  → onCancel closes the whole flow
 *
 * This is the missing piece between US5's auth dialog (T031/T032b) and
 * actual workspace creation. It exists as a separate component so the
 * auth dialog stays focused on the device-flow handshake.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@rune-langium/design-system/ui/alert';
import type { GitHubInitializationSession } from '../workspace/project-initialization.js';
import { ProjectInitializationReview } from './ProjectInitializationReview.js';
import { GitHubConnectDialog } from './GitHubConnectDialog.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface GitHubWorkspaceFlowProps {
  authBase: string;
  /** Called when the user successfully clones a repo into a new workspace. */
  onCreated: (workspaceId: string) => void | Promise<void>;
  openProjectInitialization?: (workspaceId: string) => Promise<GitHubInitializationSession | undefined>;
  /** Called when the user closes the flow without creating a workspace. */
  onCancel: () => void;
  /**
   * Performs the actual clone. Injected so this component is testable
   * without a real OPFS root. Production callers pass a thin wrapper
   * over `WorkspaceManager.createGitBacked`.
   */
  createWorkspace: (input: {
    name: string;
    repoUrl: string;
    branch: string;
    user: string;
    token: string;
  }) => Promise<{ id: string }>;
}

interface FlowState {
  phase: 'auth' | 'url' | 'cloning' | 'error' | 'review' | 'opening';
  workspaceId?: string;
  token?: string;
  errorReason?: string;
}

/**
 * Translate raw clone errors (e.g. "HTTP 404", network failures) into copy
 * the user can act on. Falls back to the raw message for anything we don't
 * recognise so we never silently swallow a useful detail.
 */
function friendlyCloneError(raw: string): { headline: string; hint?: string } {
  const msg = raw.trim();
  // isomorphic-git surfaces server status as "HTTP Error: 404 Not Found".
  if (/\b(HTTP\s*(Error)?:?\s*)?404\b/i.test(msg)) {
    return {
      headline: 'Repository not found',
      hint: "Check the URL — the repo may not exist, or it may be private and your account doesn't have access. Public repos work without extra permissions; private repos need a token with repo scope."
    };
  }
  if (/\b(HTTP\s*(Error)?:?\s*)?(401|403)\b/i.test(msg) || /unauthor|forbidden|denied/i.test(msg)) {
    return {
      headline: 'Permission denied',
      hint: "Your GitHub authorisation doesn't have access to this repository. If it's a private repo, reconnect and grant access, or pick a different repo."
    };
  }
  if (/network|fetch|failed to fetch|timeout|offline/i.test(msg)) {
    return {
      headline: 'Network problem',
      hint: "We couldn't reach GitHub. Check your connection and try again."
    };
  }
  if (/\bbranch\b/i.test(msg) && /not found|unknown/i.test(msg)) {
    return {
      headline: 'Branch not found',
      hint: "Double-check the branch name (case-sensitive). Most repos use 'main' or 'master'."
    };
  }
  return { headline: 'Clone failed', hint: msg };
}

/**
 * Best-effort parse of a GitHub repo URL into `{ owner, repo, user }`.
 * Recognises the four common shapes so the user can paste any of them:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 *   - owner/repo
 */
function parseRepoUrl(raw: string): { user: string; repo: string; canonicalUrl: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) m = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) m = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!m) return null;
  const user = m[1]!;
  const repo = m[2]!;
  return { user, repo, canonicalUrl: `https://github.com/${user}/${repo}.git` };
}

export const GitHubWorkspaceFlow = withInstrumentation(
  function GitHubWorkspaceFlow({
    authBase,
    onCreated,
    onCancel,
    createWorkspace,
    openProjectInitialization
  }: GitHubWorkspaceFlowProps): React.ReactElement {
    const [state, setState] = useState<FlowState>({ phase: 'auth' });
    const [repoUrl, setRepoUrl] = useState('');
    const [branch, setBranch] = useState('main');
    const [session, setSession] = useState<GitHubInitializationSession>();
    const sessionRef = useRef<GitHubInitializationSession | undefined>(undefined);
    const alive = useRef(true);
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
        sessionRef.current?.dispose();
      };
    }, []);
    async function activate(workspaceId: string) {
      try {
        setState((current) => ({ ...current, phase: 'opening', workspaceId, errorReason: undefined }));
        await onCreated(workspaceId);
        sessionRef.current?.dispose();
        sessionRef.current = undefined;
      } catch (error) {
        if (alive.current)
          setState((current) => ({
            ...current,
            phase: 'review',
            workspaceId,
            errorReason: error instanceof Error ? error.message : 'The repository could not be activated. Try again.'
          }));
      }
    }
    if (state.phase === 'review' && state.workspaceId) {
      if (session && !state.errorReason)
        return <ProjectInitializationReview session={session} onContinue={() => activate(state.workspaceId!)} />;
      return (
        <section className="space-y-3 text-sm text-left" aria-label="Opened repository">
          <p>The repository was cloned and remains in your workspaces.</p>
          <Alert variant="destructive">
            <AlertDescription>{state.errorReason}</AlertDescription>
          </Alert>
          <Button size="sm" onClick={() => void activate(state.workspaceId!)}>
            Keep browsing
          </Button>
        </section>
      );
    }
    if (state.phase === 'opening') return <p role="status">Opening repository…</p>;

    if (state.phase === 'auth') {
      return (
        <GitHubConnectDialog
          authBase={authBase}
          onConnected={(token) => setState({ phase: 'url', token })}
          onCancel={onCancel}
        />
      );
    }

    if (state.phase === 'cloning') {
      return (
        <div role="dialog" aria-label="Cloning repository" data-testid="github-cloning">
          <p>Cloning repository — this may take ~30 seconds for a fresh repo…</p>
        </div>
      );
    }

    // 'url' or 'error' — both render the form, with an error banner on retry.
    const parsed = parseRepoUrl(repoUrl);
    const canSubmit = parsed !== null;

    return (
      <div role="dialog" aria-label="Choose a repository" data-testid="github-repo-form">
        <p>Authorisation succeeded. Paste the repository URL to clone.</p>
        <label htmlFor="repo-url-input">Repository URL or owner/repo</label>
        <input
          id="repo-url-input"
          data-testid="repo-url-input"
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
        />
        <label htmlFor="repo-branch-input">Branch</label>
        <input
          id="repo-branch-input"
          data-testid="repo-branch-input"
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
        />
        {state.phase === 'error' &&
          state.errorReason &&
          (() => {
            const friendly = friendlyCloneError(state.errorReason);
            return (
              <Alert variant="destructive" data-testid="github-clone-error">
                <AlertTitle>{friendly.headline}</AlertTitle>
                {friendly.hint && <AlertDescription>{friendly.hint}</AlertDescription>}
              </Alert>
            );
          })()}
        <Button
          disabled={!canSubmit}
          onClick={async () => {
            if (!parsed || !state.token) return;
            setState({ phase: 'cloning', token: state.token });
            try {
              const result = await createWorkspace({
                name: `${parsed.user}/${parsed.repo}`,
                repoUrl: parsed.canonicalUrl,
                branch: branch.trim() || 'main',
                user: parsed.user,
                token: state.token
              });
              if (!alive.current) return;
              try {
                const prepared = await openProjectInitialization?.(result.id);
                if (!alive.current) {
                  prepared?.dispose();
                  return;
                }
                if (prepared) {
                  sessionRef.current = prepared;
                  setSession(prepared);
                  setState({ phase: 'review', workspaceId: result.id });
                } else await activate(result.id);
              } catch (error) {
                if (alive.current)
                  setState({
                    phase: 'review',
                    workspaceId: result.id,
                    errorReason: error instanceof Error ? error.message : 'Project settings could not be inspected.'
                  });
              }
            } catch (err) {
              if (!alive.current) return;
              setState({
                phase: 'error',
                token: state.token,
                errorReason: err instanceof Error ? err.message : String(err)
              });
            }
          }}
        >
          Clone
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  },
  { op: 'GitHubWorkspaceFlow' }
);
