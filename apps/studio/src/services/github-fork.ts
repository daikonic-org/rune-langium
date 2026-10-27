// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { withInstrumentation } from './instrumentation/core.js';

const account = z.string().regex(/^[\w-]+$/);
const repository = z.string().regex(/^[\w.-]+$/);
const ForkSchema = z.object({
  name: repository,
  owner: z.object({ login: account }),
  default_branch: z.string().min(1),
  fork: z.literal(true),
  parent: z.object({ full_name: z.string() })
});
export interface GitHubFork {
  name: string;
  repoUrl: string;
  branch: string;
  user: string;
}

export const prepareGitHubFork = withInstrumentation(
  async function prepareGitHubFork(
    source: string,
    token: string,
    signal: AbortSignal,
    fetcher: typeof fetch = fetch
  ): Promise<GitHubFork> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source)) throw new Error('Invalid example repository.');
    signal.throwIfAborted();
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const request = (path: string, method = 'GET', body?: object) =>
      fetcher(`https://api.github.com${path}`, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'omit',
        redirect: 'error',
        signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    const identity = await request('/user');
    if (!identity.ok) throw new Error('GitHub sign-in could not be verified. Connect again and retry.');
    const user = z.object({ login: account }).parse(await identity.json()).login;
    const name = source.split('/')[1]!;
    let response = await request(`/repos/${user}/${name}`);
    if (response.status === 404) {
      response = await request(`/repos/${source}/forks`, 'POST', { name, default_branch_only: true });
    }
    if (!response.ok) {
      if (response.status === 403)
        throw new Error('GitHub did not allow this fork. Check your repository permissions.');
      if (response.status === 422)
        throw new Error('GitHub could not create this fork. Check your existing repositories.');
      throw new Error('GitHub did not confirm the fork. Retry checks for your existing fork before creating one.');
    }
    const parsed = ForkSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      parsed.data.owner.login.toLowerCase() !== user.toLowerCase() ||
      parsed.data.name.toLowerCase() !== name.toLowerCase() ||
      parsed.data.parent.full_name.toLowerCase() !== source.toLowerCase()
    ) {
      throw new Error(
        `The repository ${user}/${name} is not your fork of this example. Check it on GitHub before retrying.`
      );
    }
    signal.throwIfAborted();
    return {
      name: `${user}/${name}`,
      repoUrl: `https://github.com/${user}/${name}.git`,
      branch: parsed.data.default_branch,
      user
    };
  },
  {
    op: 'prepareGitHubFork',
    sanitize: () => undefined,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
