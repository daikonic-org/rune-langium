// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { ProjectResolutionContextSchema } from '@rune-langium/core/project-contract';
import type { LspModelUpdate } from '@rune-langium/lsp-server';

const META_PREFIX = 'model-meta:';
const CHUNK_PREFIX = 'models:';
const CHUNK_SIZE = 16_000;
const RESOLUTION_PREFIX = 'project-resolution:';
interface ModelRecord {
  generation: string;
  count: number;
}
interface TextKey {
  meta: string;
  chunks: string;
}
const modelKey = (uri: string): TextKey => ({ meta: META_PREFIX + uri, chunks: CHUNK_PREFIX + uri + ':' });
const resolutionKey: TextKey = { meta: RESOLUTION_PREFIX + 'meta', chunks: RESOLUTION_PREFIX + 'chunks:' };
const chunkKey = (key: TextKey, generation: string, index: number) => `${key.chunks}${generation}:${index}`;
async function removeText(storage: DurableObjectStorage, key: TextKey, record: ModelRecord): Promise<void> {
  await storage.delete(key.meta);
  for (let i = 0; i < record.count; i++) await storage.delete(chunkKey(key, record.generation, i));
}
async function writeText(storage: DurableObjectStorage, key: TextKey, text: string): Promise<void> {
  const old = await storage.get<ModelRecord>(key.meta);
  const generation = crypto.randomUUID();
  const count = Math.ceil(text.length / CHUNK_SIZE);
  for (let i = 0; i < count; i++)
    await storage.put(chunkKey(key, generation, i), text.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  await storage.put(key.meta, { generation, count });
  if (old) for (let i = 0; i < old.count; i++) await storage.delete(chunkKey(key, old.generation, i));
}
async function readText(storage: DurableObjectStorage, key: TextKey, record: ModelRecord): Promise<string> {
  const chunks: string[] = [];
  for (let i = 0; i < record.count; i++) {
    const chunk = await storage.get<string>(chunkKey(key, record.generation, i));
    if (chunk === undefined) throw new Error('Incomplete persisted LSP model/context');
    chunks.push(chunk);
  }
  return chunks.join('');
}

async function* modelRecords(storage: DurableObjectStorage): AsyncGenerator<[string, ModelRecord]> {
  let startAfter: string | undefined;
  while (true) {
    const page = await storage.list<ModelRecord>({ prefix: META_PREFIX, limit: 128, startAfter });
    if (!page.size) return;
    for (const entry of page) yield entry;
    if (page.size < 128) return;
    startAfter = [...page.keys()].at(-1);
  }
}

/** Publish the pointer only after every chunk is durable (128KiB value limit). */
export async function persistLspModels(storage: DurableObjectStorage, update: LspModelUpdate): Promise<void> {
  if (update.document) await writeText(storage, modelKey(update.document.uri), update.document.modelJson);
  if (Object.hasOwn(update, 'resolution')) {
    if (!update.retain) throw new Error('Project resolution requires the final retained model set.');
    if (update.resolution == null) {
      const record = await storage.get<ModelRecord>(resolutionKey.meta);
      if (record) await removeText(storage, resolutionKey, record);
    } else
      await writeText(storage, resolutionKey, JSON.stringify(ProjectResolutionContextSchema.parse(update.resolution)));
  }
  if (update.retain) {
    const retained = new Set(update.retain);
    for await (const [key, record] of modelRecords(storage)) {
      const uri = key.slice(META_PREFIX.length);
      if (retained.has(uri)) continue;
      await removeText(storage, modelKey(uri), record);
    }
  }
}

/** Stream one model at a time so cold wake never duplicates the full JSON corpus. */
export async function replayLspModels(
  storage: DurableObjectStorage,
  sync: (update: LspModelUpdate) => Promise<unknown>
): Promise<void> {
  const uris: string[] = [];
  for await (const [key, record] of modelRecords(storage)) {
    const uri = key.slice(META_PREFIX.length);
    await sync({ document: { uri, modelJson: await readText(storage, modelKey(uri), record) } });
    uris.push(uri);
  }
  const record = await storage.get<ModelRecord>(resolutionKey.meta);
  const resolution = record
    ? ProjectResolutionContextSchema.parse(JSON.parse(await readText(storage, resolutionKey, record)))
    : undefined;
  if (uris.length || resolution) await sync({ retain: uris, ...(resolution ? { resolution } : {}) });
}

export async function purgeLspModels(storage: DurableObjectStorage): Promise<void> {
  for (const prefix of [META_PREFIX, CHUNK_PREFIX, RESOLUTION_PREFIX]) {
    while (true) {
      const keys = [...(await storage.list({ prefix, limit: 128 })).keys()];
      if (!keys.length) break;
      await storage.delete(keys);
    }
  }
}
