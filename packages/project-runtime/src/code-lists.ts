// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { RepositoryFileSourceSchema, type RepositoryFileSource } from '@rune-langium/core/project-contract';
import { openGitHubRepository } from './repository-source.js';
import { z } from 'zod';
import type { CodeListValue } from '@rune-langium/codegen/export';
const date = z.iso.date();
const text = z.string().min(1);
const entry = z.object({
  value: text,
  label: text,
  description: text.optional(),
  source: text.optional(),
  effectiveDate: date.optional(),
  deprecatedDate: date.optional()
});
const cdm = z
  .object({
    identification: z
      .object({
        shortName: text,
        version: text,
        canonicalUri: text.regex(/^[a-zA-Z][a-zA-Z\d+.-]*:/),
        canonicalVersionUri: text.optional()
      })
      .passthrough(),
    codes: z.array(
      z
        .object({
          value: text,
          description: text.optional(),
          source: text.optional(),
          effectiveDate: date.optional(),
          deprecatedDate: date.optional()
        })
        .passthrough()
    )
  })
  .passthrough();
export interface CodeListExpectation {
  format: 'json' | 'cdm-json';
  canonicalUri?: string;
  version?: string;
}
/** Decode saved bytes once; scheme URIs are identities and are never dereferenced. */
export function decodeProjectCodeList(
  text: string,
  expected: CodeListExpectation = { format: 'json' }
): {
  values: CodeListValue[];
  canonicalUri?: string;
  version?: string;
} {
  const raw: unknown = JSON.parse(text);
  let values: CodeListValue[], canonicalUri: string | undefined, version: string | undefined;
  if (expected.format === 'cdm-json') {
    const parsed = cdm.parse(raw);
    ({ canonicalUri, version } = parsed.identification);
    values = parsed.codes.map(({ description, ...code }) => ({
      ...code,
      label: code.value,
      ...(description ? { description } : {})
    }));
  } else {
    values = z.array(entry).parse(raw);
  }
  if (expected.canonicalUri !== undefined && expected.canonicalUri !== canonicalUri)
    throw new Error('The code-list scheme URI differs from the configured identity.');
  if (expected.version !== undefined && expected.version !== version)
    throw new Error('The code-list version differs from the configured version.');
  if (new Set(values.map((code) => code.value)).size !== values.length)
    throw new Error('Expected distinct code-list entries with string value and label.');
  return { values, ...(canonicalUri ? { canonicalUri } : {}), ...(version ? { version } : {}) };
}

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
