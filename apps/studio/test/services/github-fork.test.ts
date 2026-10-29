// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { prepareGitHubFork } from '../../src/services/github-fork.js';

const fork = {
  name: 'starter',
  owner: { login: 'octocat' },
  default_branch: 'release',
  fork: true,
  parent: { full_name: 'example/starter' }
};
const signal = () => new AbortController().signal;
it('creates a signed-in user fork and returns only its canonical clone identity', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ login: 'octocat' }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json(fork, { status: 202 }));
  expect(await prepareGitHubFork('example/starter', 'test-token', signal(), fetcher)).toEqual({
    name: 'octocat/starter',
    repoUrl: 'https://github.com/octocat/starter.git',
    branch: 'release',
    user: 'octocat'
  });
  expect(fetcher.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    ['https://api.github.com/user', 'GET'],
    ['https://api.github.com/repos/octocat/starter', 'GET'],
    ['https://api.github.com/repos/example/starter/forks', 'POST']
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      headers: { Authorization: 'Bearer test-token' }
    });
  }
});
it('reuses an existing matching fork without sending another creation request', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ login: 'octocat' }))
    .mockResolvedValueOnce(Response.json(fork));
  await prepareGitHubFork('example/starter', 'test-token', signal(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
it.each([
  { ...fork, fork: false },
  { ...fork, parent: { full_name: 'other/repository' } },
  { ...fork, owner: { login: 'someone-else' } }
])('refuses a repository that is not the user’s matching fork', async (response) => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ login: 'octocat' }))
    .mockResolvedValueOnce(Response.json(response));
  await expect(prepareGitHubFork('example/starter', 'test-token', signal(), fetcher)).rejects.toThrow(/not your fork/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('preserves a denied creation as a recoverable permission error', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ login: 'octocat' }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(prepareGitHubFork('example/starter', 'test-token', signal(), fetcher)).rejects.toThrow(/permissions/);
});
it('does not begin a cancelled operation', async () => {
  const operation = new AbortController();
  operation.abort();
  const fetcher = vi.fn();
  await expect(prepareGitHubFork('example/starter', 'test-token', operation.signal, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
