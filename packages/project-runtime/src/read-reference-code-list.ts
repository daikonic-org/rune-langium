// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { RepositoryFileSourceSchema, type RepositoryFileSource } from '@rune-langium/core/project-contract';
import { openGitHubRepository } from './repository-source.js';
import { decodeProjectCodeList, type CodeListExpectation } from './code-lists.js';

/** Stage an explicitly selected upstream code list for ordinary workspace Save; no mutable Nightly pin. */
export async function readReferenceCodeList(
  source: RepositoryFileSource,
  signal: AbortSignal,
  expected: CodeListExpectation,
  fetcher: typeof fetch = fetch
) {
  const provenance = RepositoryFileSourceSchema.parse(source);
  const repository = await openGitHubRepository(
    provenance.repository.slice('https://github.com/'.length),
    provenance.commit,
    signal,
    fetcher
  );
  const matches = repository.files.filter((file) => file.path === provenance.path);
  if (matches.length !== 1 || !provenance.path.endsWith('.json'))
    throw new Error('Choose one JSON code-list file at the active reference commit.');
  const content = await repository.read(matches[0]!, 8 * 1024 * 1024);
  const prepared = decodeProjectCodeList(content, expected);
  return { content, provenance, codeList: expected, ...prepared };
}
