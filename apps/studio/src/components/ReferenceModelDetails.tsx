// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useState } from 'react';
import type { CuratedManifest, ReferenceCatalog } from '@rune-langium/curated-schema';
import {
  createMemoryReferenceCache,
  readReferenceManifest,
  readVerifiedReferenceBytes,
  type ReferenceTransport
} from '@rune-langium/project-runtime/references';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface RepositoryDetails {
  description?: string;
  license?: string;
}
export const readReferenceRepositoryDetails = withInstrumentation(
  async function readReferenceRepositoryDetails(repository: string, signal: AbortSignal): Promise<RepositoryDetails> {
    const url = new URL(repository.replace(/\.git$/, ''));
    if (url.origin !== 'https://github.com' || !/^\/[\w.-]+\/[\w.-]+$/.test(url.pathname))
      throw new Error('Unsupported repository.');
    const response = await fetch(`https://api.github.com/repos${url.pathname}`, {
      signal,
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error('Repository details are unavailable.');
    const value = (await response.json()) as { description?: unknown; license?: { spdx_id?: unknown } };
    return {
      description: typeof value.description === 'string' ? value.description : undefined,
      license:
        typeof value.license?.spdx_id === 'string' && value.license.spdx_id !== 'NOASSERTION'
          ? value.license.spdx_id
          : undefined
    };
  },
  {
    op: 'readReferenceRepositoryDetails',
    sanitize: () => undefined,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const ReferenceModelDetails = withInstrumentation(
  function ReferenceModelDetails({
    repository,
    modelId,
    release,
    catalog,
    transport
  }: {
    repository: string;
    modelId: string;
    release: string;
    catalog?: ReferenceCatalog;
    transport: ReferenceTransport;
  }) {
    const [repositoryDetails, setRepositoryDetails] = useState<RepositoryDetails>();
    const [inventory, setInventory] = useState<CuratedManifest>();
    const [inventoryUnavailable, setInventoryUnavailable] = useState(false);
    useEffect(() => {
      const abort = new AbortController();
      setRepositoryDetails(undefined);
      void readReferenceRepositoryDetails(repository, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setRepositoryDetails(result);
        })
        .catch(() => {});
      return () => abort.abort();
    }, [repository]);
    useEffect(() => {
      const abort = new AbortController();
      setInventory(undefined);
      setInventoryUnavailable(false);
      if (!release) return () => abort.abort();
      const load = async () => {
        if (release === 'nightly') return transport.nightly?.(modelId, abort.signal);
        const entries = catalog?.releases.filter((entry) => entry.modelId === modelId && entry.tag === release) ?? [];
        if (entries.length !== 1) return undefined;
        const entry = entries[0]!;
        const cache = createMemoryReferenceCache();
        const staged = new Map<string, Uint8Array>();
        return readReferenceManifest(modelId, { ...entry, release: entry.tag }, (url, checksum) =>
          readVerifiedReferenceBytes(url, checksum, transport, cache, abort.signal, staged)
        );
      };
      void load()
        .then((result) => {
          if (abort.signal.aborted) return;
          if (result?.modelId === modelId) setInventory(result);
          else setInventoryUnavailable(true);
        })
        .catch(() => {
          if (!abort.signal.aborted) setInventoryUnavailable(true);
        });
      return () => abort.abort();
    }, [modelId, release, catalog, transport]);
    const exports = Object.values(inventory?.namespaces ?? {}).flatMap((entry) => entry.exports);
    const typeKinds = new Set([
      'Data',
      'Choice',
      'RosettaEnumeration',
      'RosettaTypeAlias',
      'RosettaBasicType',
      'RosettaRecordType'
    ]);
    const href = repository.replace(/\.git$/, '');
    return (
      <div className="space-y-2 text-xs text-muted-foreground" data-testid="reference-model-details">
        {repositoryDetails?.description && <p>{repositoryDetails.description}</p>}
        <a
          href={`${href}#readme`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          Repository &amp; README
        </a>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {repositoryDetails?.license && (
            <>
              <dt>License</dt>
              <dd>{repositoryDetails.license}</dd>
            </>
          )}
          {inventory?.namespaces && (
            <>
              <dt>Namespaces</dt>
              <dd>{Object.keys(inventory.namespaces).length.toLocaleString()}</dd>
              <dt>Types &amp; enums</dt>
              <dd>{exports.filter((entry) => typeKinds.has(entry.type)).length.toLocaleString()}</dd>
              <dt>Functions</dt>
              <dd>
                {exports
                  .filter((entry) => entry.type === 'RosettaFunction' || entry.type === 'RosettaExternalFunction')
                  .length.toLocaleString()}
              </dd>
            </>
          )}
          {inventory && (
            <>
              <dt>Publication</dt>
              <dd>{inventory.version}</dd>
            </>
          )}
        </dl>
        {release && !inventory && (
          <p>{inventoryUnavailable ? 'Published inventory is unavailable.' : 'Loading published inventory…'}</p>
        )}
      </div>
    );
  },
  {
    op: 'ReferenceModelDetails',
    sanitize: () => undefined,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
