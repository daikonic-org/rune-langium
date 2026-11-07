// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from './instrumentation/core.js';
import { decodeReferenceArtifact, type DecodedReferenceArtifact } from '@rune-langium/project-runtime/references';
import { projectFileRevision } from '@rune-langium/project-config';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import {
  compactLspModelJson,
  readLspModelMetadata,
  createRuneDslServices,
  hydrateModelDocument
} from '@rune-langium/core';
import { EmptyFileSystem } from 'langium';
import { curatedArtifactCache } from './curated-artifact-cache.js';

/** Runs in the parser worker. All derived data comes from canonical Core services. */
export const prepareReferenceArtifact = withInstrumentation(
  async function prepareReferenceArtifact(bytes: Uint8Array): Promise<DecodedReferenceArtifact> {
    const bundle: DecodedReferenceArtifact = decodeReferenceArtifact(bytes);
    // Hashing and IndexedDB waits are independent; bound the live Core graphs while overlapping those waits.
    const documents = bundle.documents.values();
    await Promise.all(
      Array.from({ length: Math.min(4, bundle.documents.length) }, async () => {
        for (const doc of documents) {
          const sourceHash = await projectFileRevision(doc.modelJson);
          let derived = await curatedArtifactCache.referenceDerived(sourceHash);
          if (!derived) {
            // Publication indexes contain declaration names, not Core's complete
            // qualified/enum scope. Derive that authoritative index even when present.
            const services = createRuneDslServices(EmptyFileSystem);
            const { document } = hydrateModelDocument(
              services,
              projectReferenceUri(bundle.modelId + '/' + doc.path),
              doc.modelJson,
              { register: 'always' }
            );
            const exports = (await services.RuneDsl.references.ScopeComputation.collectExportedSymbols(document)).map(
              ({ type, name, path }) => ({ type, name, path })
            );
            derived = {
              metadata: readLspModelMetadata(doc.modelJson),
              compact: compactLspModelJson(doc.modelJson),
              exports
            };
            await curatedArtifactCache.putReferenceDerived(sourceHash, derived);
          }
          doc.lsp = { metadata: derived.metadata, compact: derived.compact };
          doc.exports = derived.exports;
        }
      })
    );
    return bundle;
  },
  { op: 'prepareReferenceArtifact', capture: 0 }
);

/** Only verified immutable artifacts enter this bounded, per-session decode cache. */
export const createReferenceArtifactDecoder = withInstrumentation(
  function createReferenceArtifactDecoder(
    decode: (bytes: Uint8Array) => Promise<DecodedReferenceArtifact>,
    maxBytes = 192 * 1024 * 1024
  ) {
    const entries = new Map<string, { value: DecodedReferenceArtifact; size: number }>();
    const pending = new Map<string, Promise<DecodedReferenceArtifact>>();
    let total = 0;
    return async (bytes: Uint8Array, checksum: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      const hit = entries.get(checksum);
      if (hit) {
        entries.delete(checksum);
        entries.set(checksum, hit);
        return hit.value;
      }
      let work = pending.get(checksum);
      if (!work) {
        work = decode(bytes)
          .then((value) => {
            const size = value.documents.reduce(
              (sum, doc) =>
                sum + 2 * (doc.modelJson.length + (doc.content?.length ?? 0) + (doc.lsp?.compact.length ?? 0)),
              0
            );
            if (size <= maxBytes) {
              while (entries.size && total + size > maxBytes) {
                const oldest = entries.keys().next().value!;
                total -= entries.get(oldest)!.size;
                entries.delete(oldest);
              }
              entries.set(checksum, { value, size });
              total += size;
            }
            return value;
          })
          .finally(() => pending.delete(checksum));
        pending.set(checksum, work);
      }
      const value = await work;
      signal.throwIfAborted();
      return value;
    };
  },
  { op: 'createReferenceArtifactDecoder', capture: 0 }
);
