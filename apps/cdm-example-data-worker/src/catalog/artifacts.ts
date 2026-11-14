// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { CatalogArtifacts } from './catalog-schema.js';

/** Both importers verify immutable object readback before making SQL rows visible. */
export async function putImmutableCatalogArtifact(artifacts: CatalogArtifacts, key: string, body: string) {
  const existing = await artifacts.get(key);
  if (existing !== undefined && existing !== body) throw new Error('Immutable benchmark artifact differs.');
  if (existing === undefined) await artifacts.put(key, body);
  if ((await artifacts.get(key)) !== body) throw new Error('Benchmark artifact readback failed.');
}
