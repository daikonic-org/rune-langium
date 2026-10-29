// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { ExecutionCatalogSchema, type ExecutionDescriptor } from '@rune-langium/project-config';
import { declarationKey } from '@rune-langium/core/project-contract';
import type { DeclarationIdentity, RepositoryExampleSource } from '@rune-langium/core/project-contract';
import { parseProjectPayload, isRuneJsonPayload } from '@rune-langium/core/serialization';
import { openGitHubRepository, type RepositoryFile } from './repository-source.js';
export { openGitHubRepository } from './repository-source.js';
export type { RepositoryFile } from './repository-source.js';
export type ReferenceExampleOrigin = Omit<RepositoryExampleSource, 'path' | 'format' | 'version' | 'execution'>;
export interface PreparedReferenceExample {
  name: string;
  type: DeclarationIdentity;
  data: unknown;
  /** The payload supplies its own identity; a manual selection cannot override it. */
  embeddedType: boolean;
  execution?: ReferenceExecutionBinding;
  source: RepositoryExampleSource;
  warnings: readonly string[];
}
export interface ReferenceExecutionBinding {
  descriptorPath: string;
  role: 'input' | 'output';
  descriptor: ExecutionDescriptor;
}
function addExecutionBinding(
  bindings: Map<string, ReferenceExecutionBinding>,
  path: string,
  binding: ReferenceExecutionBinding
): void {
  const previous = bindings.get(path);
  if (
    previous &&
    (previous.role !== binding.role ||
      previous.descriptor.executableFunctionClass !== binding.descriptor.executableFunctionClass)
  )
    throw new Error('Execution catalogs have conflicting bindings for ' + path);
  bindings.set(path, binding);
}
/** Decode the upstream catalog contract once for Studio and corpus verification. */
export function referenceExecutionBindings(
  descriptorPath: string,
  text: string
): ReadonlyMap<string, ReferenceExecutionBinding> {
  const entries = ExecutionCatalogSchema.parse(JSON.parse(text));
  const marker = descriptorPath.indexOf('/resources/');
  const root =
    marker < 0
      ? descriptorPath.slice(0, descriptorPath.lastIndexOf('/') + 1)
      : descriptorPath.slice(0, marker + '/resources/'.length);
  const bindings = new Map<string, ReferenceExecutionBinding>();
  for (const descriptor of entries)
    for (const [role, file] of [
      ['input', descriptor.inputFile],
      ['output', descriptor.expectedOutputFile]
    ] as const) {
      if (!file) continue;
      const path = root + file;
      if (!isRepositoryExample(path))
        throw new Error('Execution catalog points outside supported example payloads: ' + path);
      const binding = { descriptorPath, role, descriptor };
      addExecutionBinding(bindings, path, binding);
    }
  return bindings;
}
/** Known payload roots, excluding ingestion configuration, source code, build output and PDFs. */
export function isRepositoryExample(path: string): boolean {
  return (
    path.endsWith('.json') &&
    (/(^|\/)(examples|samples|testdata|test-data)\//.test(path) ||
      /\/resources\/(ingest\/output|functions)\//.test(path) ||
      /(^|\/)code-snippets\//.test(path) ||
      /\/resources\/seriali[sz]ation\/output\/json\//.test(path)) &&
    !/(^|\/)(node_modules|target|dist)\//.test(path) &&
    !/(^|\/)([^/]*-descriptor|test-pack[^/]*)[.]json$/.test(path)
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
  const bindings = new Map<string, ReferenceExecutionBinding>();
  const descriptors = repo.files.filter(
    (file) =>
      /(^|\/)[^/]*execution-descriptor[.]json$/.test(file.path) &&
      file.type === 'blob' &&
      ['100644', '100755'].includes(file.mode)
  );
  for (const file of descriptors) {
    const catalog = referenceExecutionBindings(file.path, await repo.read(file, 8 * 1024 * 1024));
    for (const [path, binding] of catalog) {
      if (
        !repo.files.some(
          (entry) => entry.path === path && entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)
        )
      )
        throw new Error('Execution catalog payload is missing: ' + path);
      addExecutionBinding(bindings, path, binding);
    }
  }
  return {
    origin,
    bindings,
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
  selectedType?: DeclarationIdentity,
  execution?: ReferenceExecutionBinding
): PreparedReferenceExample {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This example is not valid JSON. Open the source file to inspect it or choose another example.');
  }
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
  const catalogInput = embeddedType === undefined && execution?.role === 'input';
  const matches = symbols.filter(
    (symbol) =>
      symbol.model === origin.model &&
      (embeddedType !== undefined
        ? ['Data', 'Choice'].includes(symbol.kind) && symbol.namespace + '.' + symbol.name === embeddedType
        : catalogInput
          ? symbol.kind === 'RosettaFunction' &&
            symbol.namespace + '.functions.' + symbol.name === execution.descriptor.executableFunctionClass
          : selectedType &&
            ['Data', 'Choice'].includes(symbol.kind) &&
            declarationKey(symbol) === declarationKey(selectedType))
  );
  if (matches.length !== 1)
    throw new Error(
      catalogInput
        ? 'The catalog function ' +
            execution.descriptor.executableFunctionClass +
            ' is unavailable in this reference. Its input bundle cannot be imported as an object of another type.'
        : embeddedType === undefined
          ? 'This legacy payload has no type header. Choose its exact object type before importing.'
          : 'The example type is missing or ambiguous in the active reference model. Refresh the selected model or choose another example.'
    );
  const type = matches[0]!;
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
        `Payload version ${version} differs from selected reference ${origin.release}. It will be imported using that reference.`
      );
  } else warnings.push('The payload has no version header. It will be imported using the selected reference.');
  return {
    name: execution
      ? execution.descriptor.name + (execution.role === 'input' ? ' inputs' : ' output')
      : path
          .split('/')
          .pop()!
          .replace(/[.]json$/, ''),
    type,
    ...(execution ? { execution } : {}),
    data: parseProjectPayload(text, format),
    embeddedType: embeddedType !== undefined,
    source: {
      ...origin,
      path,
      format,
      ...(execution ? { execution } : {}),
      ...(typeof version === 'string' ? { version } : {})
    },
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
