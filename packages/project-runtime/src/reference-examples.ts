// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { declarationKey } from '@rune-langium/core/project-contract';
import type { DeclarationIdentity, RepositoryExampleSource } from '@rune-langium/core/project-contract';
import { parseProjectPayload, isRuneJsonPayload } from '@rune-langium/core/serialization';
import { openGitHubRepository, type RepositoryFile } from './repository-source.js';
export { openGitHubRepository } from './repository-source.js';
export type { RepositoryFile } from './repository-source.js';
export type ReferenceExampleOrigin = Omit<RepositoryExampleSource, 'path' | 'format' | 'version'>;
export interface PreparedReferenceExample {
  name: string;
  type: DeclarationIdentity;
  data: unknown;
  source: RepositoryExampleSource;
  warnings: readonly string[];
}
/** Known payload roots, excluding ingestion configuration, source code, build output and PDFs. */
export function isRepositoryExample(path: string): boolean {
  return (
    path.endsWith('.json') &&
    (/(^|\/)(examples|samples|testdata|test-data)\//.test(path) ||
      /\/resources\/(ingest\/output|functions)\//.test(path)) &&
    !/(^|\/)(node_modules|target|dist)\//.test(path) &&
    !/(descriptor|test-pack|pipeline)[^/]*[.]json$/.test(path)
  );
}
export async function openReferenceExamples(
  origin: ReferenceExampleOrigin,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
) {
  if (!/^https:\/\/github[.]com\/[\w.-]+\/[\w.-]+$/.test(origin.repository) || !/^[a-f0-9]{40}$/.test(origin.commit))
    throw new Error('The active reference has no verified GitHub source commit. Refresh it before browsing examples.');
  const repo = await openGitHubRepository(
    origin.repository.slice('https://github.com/'.length),
    origin.commit,
    signal,
    fetcher
  );
  return {
    origin,
    entries: repo.files.filter(
      (file) => isRepositoryExample(file.path) && file.type === 'blob' && ['100644', '100755'].includes(file.mode)
    ),
    async read(file: RepositoryFile) {
      if (!isRepositoryExample(file.path)) throw new Error('This is not an example payload path.');
      return repo.read(file, 8 * 1024 * 1024);
    }
  };
}
/** Resolves a complete source identity; labels and bare names never pick a declaration. */
export function prepareReferenceExample(
  origin: ReferenceExampleOrigin,
  path: string,
  text: string,
  symbols: readonly DeclarationIdentity[],
  selectedType?: DeclarationIdentity
): PreparedReferenceExample {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Choose a single object payload, not a test descriptor or batch.');
  const wire = raw as Record<string, unknown>;
  const isRune = isRuneJsonPayload(raw);
  const format = isRune ? 'RUNE_JSON' : 'JSON';
  const embeddedType = wire['@type'];
  const embeddedModel = wire['@model'];
  if (embeddedModel !== undefined && embeddedModel !== origin.model)
    throw new Error('The example model differs from the selected reference model.');
  if (embeddedType !== undefined && typeof embeddedType !== 'string')
    throw new Error('The Rune JSON type header is invalid.');
  const matches = symbols.filter(
    (symbol) =>
      symbol.model === origin.model &&
      ['Data', 'Choice'].includes(symbol.kind) &&
      (!selectedType || symbol.kind === selectedType.kind) &&
      (embeddedType !== undefined
        ? symbol.namespace + '.' + symbol.name === embeddedType
        : selectedType &&
          symbol.namespace === selectedType.namespace &&
          symbol.name === selectedType.name &&
          symbol.kind === selectedType.kind)
  );
  if (matches.length !== 1)
    throw new Error(
      embeddedType === undefined
        ? 'This legacy payload has no type header. Choose its exact object type before importing.'
        : 'The example type is missing or ambiguous in the active reference model. Refresh the selected model or choose another example.'
    );
  const type = matches[0]!;
  if (
    selectedType &&
    (selectedType.model !== type.model ||
      selectedType.kind !== type.kind ||
      selectedType.namespace !== type.namespace ||
      selectedType.name !== type.name)
  )
    throw new Error('The example type differs from the chosen object type.');
  const version = wire['@version'];
  if (version !== undefined && typeof version !== 'string') throw new Error('The Rune JSON version header is invalid.');
  const warnings: string[] = [];
  if (typeof version === 'string') {
    const same =
      origin.release === 'nightly'
        ? /(?:SNAPSHOT|nightly)/i.test(version)
        : version.replace(/^v/, '') === origin.release.replace(/^v/, '');
    if (!same)
      warnings.push(
        `Payload version ${version} differs from selected reference ${origin.release}. Import only if you intend to validate it against that reference.`
      );
  } else warnings.push('The payload has no version header. It will be validated against the selected reference.');
  return {
    name: path
      .split('/')
      .pop()!
      .replace(/[.]json$/, ''),
    type,
    data: parseProjectPayload(text, format),
    source: { ...origin, path, format, ...(typeof version === 'string' ? { version } : {}) },
    warnings
  };
}
/** Used for duplicate detection without relying on user-editable example names. */
export function referenceExampleKey(source: RepositoryExampleSource, type?: DeclarationIdentity): string {
  return JSON.stringify([
    source.model,
    source.repository,
    source.commit,
    source.path,
    type ? declarationKey(type) : null
  ]);
}
