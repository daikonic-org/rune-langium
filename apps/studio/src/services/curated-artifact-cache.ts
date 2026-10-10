// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { z } from 'zod';
import { CuratedModelIdSchema, CuratedSerializedDocumentExportSchema } from '@rune-langium/curated-schema';
import type { HydrateRequest } from '../workers/parser-worker.js';
import { withInstrumentation } from './instrumentation/core.js';

type HydrationDocument = HydrateRequest['documents'][number];
type SourceDocument = Pick<HydrationDocument, 'uri' | 'content'>;
type CacheKind = 'documents' | 'source';

// Bump when the serialized hydration contract changes. This disposable database
// is separate from workspace storage, so eviction never touches user files.
const FORMAT_VERSION = 1;
const DB_NAME = 'rune-curated-artifacts';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 512;

const ArtifactKeySchema = z.tuple([CuratedModelIdSchema, z.string()]);
const SourceDocumentSchema = z.object({ uri: z.string().min(1), content: z.string() });
const SourcesSchema = z.array(SourceDocumentSchema);
const DocumentSchema = SourceDocumentSchema.extend({
  serializedModel: z.string().min(1),
  exports: z.array(CuratedSerializedDocumentExportSchema),
  bundleId: CuratedModelIdSchema,
  artifactKey: z.string(),
  namespace: z.string().min(1),
  sourceLoaded: z.boolean().optional()
});
const DocumentsSchema = z.array(DocumentSchema);

interface CacheEntry {
  id: string;
  artifactKey: string;
  kind: CacheKind;
  formatVersion: number;
  sizeBytes: number;
  lastUsedAt: number;
}

interface CuratedCacheDB extends DBSchema {
  entries: { key: string; value: CacheEntry };
  payloads: { key: string; value: string };
}

async function updateCache<T>(
  db: IDBPDatabase<CuratedCacheDB>,
  update: (tx: IDBPTransaction<CuratedCacheDB, ['entries', 'payloads'], 'readwrite'>) => Promise<T>
): Promise<T> {
  const tx = db.transaction(['entries', 'payloads'], 'readwrite');
  void tx.done.catch(() => {});
  try {
    const result = await update(tx);
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

function artifactBundle(key: string): string | undefined {
  try {
    const parsed = ArtifactKeySchema.safeParse(JSON.parse(key));
    if (!parsed.success) return undefined;
    const [bundleId, artifact] = parsed.data;
    const prefix = `https://www.daikonic.dev/curated/${bundleId}/`;
    const path = artifact.startsWith(prefix) ? artifact.slice(prefix.length) : artifact;
    // The publisher includes the content digest in this directory. Floating
    // pointers and legacy date-only paths must always go through the server.
    return /^artifacts\/\d{4}-\d{2}-\d{2}-[a-f0-9]{12}\/ns\/[^/?#]+\.json\.gz$/.test(path) ? bundleId : undefined;
  } catch {
    return undefined;
  }
}

function entryId(kind: CacheKind, artifactKey: string): string {
  return JSON.stringify([kind, artifactKey]);
}

/** Best-effort, bounded storage for immutable public curated artifacts. */
export const createCuratedArtifactCache = withInstrumentation(
  function createCuratedArtifactCache(options: { databaseName?: string; maxBytes?: number; maxEntries?: number } = {}) {
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const maxEntries = options.maxEntries ?? MAX_ENTRIES;
    let connection: Promise<IDBPDatabase<CuratedCacheDB> | undefined> | undefined;

    function getDb(): Promise<IDBPDatabase<CuratedCacheDB> | undefined> {
      if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
      connection ??= openDB<CuratedCacheDB>(options.databaseName ?? DB_NAME, 1, {
        upgrade(db) {
          db.createObjectStore('entries', { keyPath: 'id' });
          db.createObjectStore('payloads');
        },
        blocking() {
          void connection?.then((db) => db?.close());
          connection = undefined;
        },
        terminated() {
          connection = undefined;
        }
      }).catch(() => {
        connection = undefined;
        return undefined;
      });
      return connection;
    }

    async function remove(ids: readonly string[]): Promise<void> {
      try {
        const db = await getDb();
        if (!db) return;
        await updateCache(db, async (tx) => {
          for (const id of ids) {
            await tx.objectStore('entries').delete(id);
            await tx.objectStore('payloads').delete(id);
          }
        });
      } catch {
        // Cache failure never prevents normal loading.
      }
    }

    const read = withInstrumentation(
      async function readCuratedArtifact(kind: CacheKind, artifactKey: string): Promise<unknown> {
        if (!artifactBundle(artifactKey)) return undefined;
        const id = entryId(kind, artifactKey);
        try {
          const db = await getDb();
          if (!db) return undefined;
          return await updateCache(db, async (tx) => {
            const entry = await tx.objectStore('entries').get(id);
            const payload = await tx.objectStore('payloads').get(id);
            if (
              !entry ||
              entry.formatVersion !== FORMAT_VERSION ||
              entry.kind !== kind ||
              entry.artifactKey !== artifactKey ||
              typeof payload !== 'string' ||
              payload.length * 2 !== entry.sizeBytes
            ) {
              await tx.objectStore('entries').delete(id);
              await tx.objectStore('payloads').delete(id);
              return undefined;
            }
            await tx.objectStore('entries').put({ ...entry, lastUsedAt: Date.now() });
            return JSON.parse(payload);
          });
        } catch {
          await remove([id]);
          return undefined;
        }
      },
      { op: 'curatedCacheRead', level: 'trace' }
    );

    const write = withInstrumentation(
      async function writeCuratedArtifact(kind: CacheKind, artifactKey: string, value: unknown): Promise<void> {
        if (!artifactBundle(artifactKey)) return;
        try {
          const payload = JSON.stringify(value);
          const sizeBytes = payload.length * 2;
          if (sizeBytes > maxBytes) return;
          const db = await getDb();
          if (!db) return;
          const id = entryId(kind, artifactKey);
          await updateCache(db, async (tx) => {
            const entries = (await tx.objectStore('entries').getAll()).filter((entry) => entry.id !== id);
            entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
            let bytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, sizeBytes);
            while (entries.length && (bytes > maxBytes || entries.length >= maxEntries)) {
              const oldest = entries.shift()!;
              bytes -= oldest.sizeBytes;
              await tx.objectStore('entries').delete(oldest.id);
              await tx.objectStore('payloads').delete(oldest.id);
            }
            await tx.objectStore('entries').put({
              id,
              artifactKey,
              kind,
              formatVersion: FORMAT_VERSION,
              sizeBytes,
              lastUsedAt: Date.now()
            });
            await tx.objectStore('payloads').put(payload, id);
          });
        } catch {
          // Private browsing, eviction and quota errors are ordinary cache misses.
        }
      },
      { op: 'curatedCacheWrite', level: 'trace' }
    );

    const documentKeys = withInstrumentation(
      async function listCuratedArtifacts(): Promise<string[]> {
        try {
          const db = await getDb();
          if (!db) return [];
          const entries = await db.getAll('entries');
          return entries
            .filter(
              (entry) =>
                entry.kind === 'documents' &&
                entry.formatVersion === FORMAT_VERSION &&
                artifactBundle(entry.artifactKey)
            )
            .map((entry) => entry.artifactKey);
        } catch {
          return [];
        }
      },
      { op: 'curatedCacheIndex', level: 'trace' }
    );

    return {
      documentKeys,
      async documents(artifactKey: string): Promise<HydrationDocument[] | undefined> {
        const value = await read('documents', artifactKey);
        const parsed = DocumentsSchema.safeParse(value);
        const bundleId = artifactBundle(artifactKey);
        if (
          parsed.success &&
          parsed.data.every((doc) => doc.artifactKey === artifactKey && doc.bundleId === bundleId)
        ) {
          return parsed.data;
        }
        await remove([entryId('documents', artifactKey)]);
        return undefined;
      },
      async source(artifactKey: string): Promise<SourceDocument[] | undefined> {
        const parsed = SourcesSchema.safeParse(await read('source', artifactKey));
        if (parsed.success) return parsed.data;
        await remove([entryId('source', artifactKey)]);
        return undefined;
      },
      putDocuments(artifactKey: string, documents: HydrationDocument[]): Promise<void> {
        const parsed = DocumentsSchema.safeParse(documents);
        const bundleId = artifactBundle(artifactKey);
        if (
          !parsed.success ||
          parsed.data.some((doc) => doc.artifactKey !== artifactKey || doc.bundleId !== bundleId)
        ) {
          return Promise.resolve();
        }
        return write(
          'documents',
          artifactKey,
          parsed.data.map((doc) => ({ ...doc, content: '', sourceLoaded: false }))
        );
      },
      putSource(artifactKey: string, documents: SourceDocument[]): Promise<void> {
        const parsed = SourcesSchema.safeParse(documents);
        return parsed.success ? write('source', artifactKey, parsed.data) : Promise.resolve();
      },
      discardDocuments(keys: readonly string[]): Promise<void> {
        return remove(keys.map((key) => entryId('documents', key)));
      },
      async close(): Promise<void> {
        const db = await connection;
        connection = undefined;
        db?.close();
      }
    };
  },
  { op: 'createCuratedArtifactCache' }
);

export const curatedArtifactCache = createCuratedArtifactCache();
