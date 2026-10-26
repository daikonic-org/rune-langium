// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { PortableProjectPathSchema } from '@rune-langium/project-config';

export interface RepositoryFile {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
const shaPattern = /^[a-f0-9]{40}$/;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function readBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error(`GitHub source unavailable (${response.status}). Check access or try again later.`);
  if (!response.body) throw new Error('GitHub returned no source body.');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('The repository source exceeds its size limit.');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
/** Immutable Git object reader shared by starter copies and reference examples. */
export async function openGitHubRepository(
  repository: string,
  ref: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  limits = { entries: 50_000, treeBytes: 16 * 1024 * 1024 }
): Promise<{
  commit: string;
  files: readonly RepositoryFile[];
  read(file: RepositoryFile, limit: number): Promise<string>;
}> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const base = `https://api.github.com/repos/${repository}`;
  const request = (url: string, raw = false) =>
    fetcher(url, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' }
    });
  const json = async (url: string, limit: number): Promise<unknown> =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(await request(url), limit)));
  signal.throwIfAborted();
  const commit = await json(`${base}/commits/${encodeURIComponent(ref)}`, 2 * 1024 * 1024);
  if (
    !object(commit) ||
    typeof commit.sha !== 'string' ||
    !shaPattern.test(commit.sha) ||
    !object(commit.commit) ||
    !object(commit.commit.tree) ||
    typeof commit.commit.tree.sha !== 'string' ||
    !shaPattern.test(commit.commit.tree.sha)
  )
    throw new Error('GitHub returned an invalid commit.');
  if (shaPattern.test(ref) && commit.sha !== ref)
    throw new Error('GitHub source commit differs from the active model.');
  const tree = await json(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`, limits.treeBytes);
  if (!object(tree) || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > limits.entries)
    throw new Error('The repository source tree is invalid or truncated. No partial copy was created.');
  const seen = new Set<string>();
  const files = tree.tree.map((entry): RepositoryFile => {
    if (
      !object(entry) ||
      !PortableProjectPathSchema.safeParse(entry.path).success ||
      typeof entry.type !== 'string' ||
      !['blob', 'tree', 'commit'].includes(entry.type) ||
      typeof entry.mode !== 'string' ||
      typeof entry.sha !== 'string' ||
      !shaPattern.test(entry.sha) ||
      (entry.size !== undefined &&
        (typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 0))
    )
      throw new Error('GitHub returned an unsafe repository entry.');
    const path = entry.path as string;
    if (seen.has(path)) throw new Error('GitHub returned a duplicate repository path.');
    seen.add(path);
    return {
      path,
      type: entry.type,
      mode: entry.mode,
      sha: entry.sha,
      ...(typeof entry.size === 'number' ? { size: entry.size } : {})
    };
  });
  const admitted = new Set(files);
  return {
    commit: commit.sha,
    files,
    async read(file, limit) {
      signal.throwIfAborted();
      if (!admitted.has(file) || file.type !== 'blob' || !['100644', '100755'].includes(file.mode))
        throw new Error('Repository symlinks, submodules and foreign entries are unsupported.');
      if (file.size === undefined || file.size > limit)
        throw new Error('The repository source exceeds its size limit.');
      const bytes = await readBytes(await request(`${base}/git/blobs/${file.sha}`, true), limit);
      if (bytes.length !== file.size) throw new Error('Repository source size changed.');
      const header = new TextEncoder().encode(`blob ${bytes.length}\0`),
        data = new Uint8Array(header.length + bytes.length);
      data.set(header);
      data.set(bytes, header.length);
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-1', data))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      if (checksum !== file.sha) throw new Error('Repository source checksum mismatch.');
      signal.throwIfAborted();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('This repository entry includes unsupported binary data.');
      return text;
    }
  };
}
