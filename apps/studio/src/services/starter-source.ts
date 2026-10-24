// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { PortableProjectPathSchema } from '@rune-langium/project-config';
import type { StarterProject } from './starter-registry.js';
import type { StarterSource } from '../workspace/open-starter.js';
import { withInstrumentation } from './instrumentation/core.js';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const commitSchema = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) });
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: PortableProjectPathSchema,
        type: z.enum(['blob', 'tree', 'commit']),
        mode: z.string(),
        sha,
        size: z.number().int().nonnegative().optional()
      })
    )
    .max(512)
});
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
      if (size > limit) throw new Error('The starter source exceeds its size limit.');
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
/** Reads public Git objects only; no auth cookies, tokens, recursive partial tree or symlink traversal. */
export const readStarterSource = withInstrumentation(
  async function readStarterSource(
    starter: StarterProject,
    signal: AbortSignal,
    fetcher: typeof fetch = fetch
  ): Promise<StarterSource> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(starter.repository)) throw new Error('Invalid starter repository.');
    const base = `https://api.github.com/repos/${starter.repository}`;
    const request = (url: string, raw = false) =>
      fetcher(url, {
        signal,
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' }
      });
    const json = async (url: string) =>
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(await request(url), 2 * 1024 * 1024))
      );
    signal.throwIfAborted();
    const commit = commitSchema.parse(await json(`${base}/commits/${encodeURIComponent(starter.ref)}`));
    const tree = treeSchema.parse(await json(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`));
    if (tree.truncated) throw new Error('The starter source tree was truncated. No partial copy was created.');
    const files = new Map<string, string>();
    let total = 0;
    for (const entry of tree.tree) {
      signal.throwIfAborted();
      if (entry.type === 'tree') continue;
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
        throw new Error('Starter symlinks and submodules are unsupported.');
      if (entry.size === undefined || entry.size > 1024 * 1024 || total + entry.size > 8 * 1024 * 1024)
        throw new Error('The starter source exceeds its size limit.');
      const bytes = await readBytes(await request(`${base}/git/blobs/${entry.sha}`, true), 1024 * 1024);
      if (bytes.length !== entry.size) throw new Error('Starter source size changed.');
      const header = new TextEncoder().encode(`blob ${bytes.length}\0`),
        object = new Uint8Array(header.length + bytes.length);
      object.set(header);
      object.set(bytes, header.length);
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-1', object))]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      if (checksum !== entry.sha) throw new Error('Starter source checksum mismatch.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('This starter includes unsupported binary files.');
      files.set(entry.path, text);
      total += bytes.length;
    }
    return { files, commit: commit.sha };
  },
  {
    op: 'readStarterSource',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
