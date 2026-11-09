// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { decodeCuratedCdmCodeList } from '../code-lists.js';

export type CdmCodeListCatalog = ReadonlyMap<string, NonNullable<ReturnType<typeof decodeCuratedCdmCodeList>>>;

/** Same filename convention as the handwritten CDM classpath loader. */
export function cdmCodeListResource(path: string) {
  return /^(?:[^/]+\/)?rosetta-source\/src\/main\/resources\/codelist\/json\/([^/]+)-(\d+-\d+)\.json$/.exec(path);
}

/** Prepare one catalog from the same pinned bytes shipped in the curated source archive. */
export function prepareCdmCodeLists(files: readonly { path: string; content: string }[]): CdmCodeListCatalog {
  const catalogs = new Map<string, ReturnType<typeof decodeCuratedCdmCodeList>>();
  for (const { path, content } of files) {
    const match = cdmCodeListResource(path);
    if (!match) continue;
    const domain = match[1]!.toLowerCase();
    if (catalogs.has(domain)) throw new Error('Ambiguous CDM code-list domain: ' + domain);
    catalogs.set(domain, decodeCuratedCdmCodeList(content, match[2]!));
  }
  const available = [...catalogs].flatMap(([domain, list]) => (list ? [[domain, list] as const] : []));
  return new Map(available.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
