// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { decodeCuratedCdmCodeList } from '../code-lists.js';

type CdmCodeList = NonNullable<ReturnType<typeof decodeCuratedCdmCodeList>> & { sourcePath: string };
export type CdmCodeListCatalog = ReadonlyMap<string, CdmCodeList>;

/** Same filename convention as the handwritten CDM classpath loader. */
export function cdmCodeListResource(path: string) {
  const match = /^(?:[^/]+\/)?(rosetta-source\/src\/main\/resources\/codelist\/json\/([^/]+)-(\d+-\d+)\.json)$/.exec(
    path
  );
  if (match) return { path: match[1]!, domain: match[2]!.toLowerCase(), version: match[3]! };
}

/** Prepare one catalog from the same pinned bytes shipped in the curated source archive. */
export function prepareCdmCodeLists(files: readonly { path: string; content: string }[]): CdmCodeListCatalog {
  const catalogs = new Map<string, CdmCodeList | undefined>();
  for (const { path, content } of files) {
    const resource = cdmCodeListResource(path);
    if (!resource) continue;
    const { domain, version } = resource;
    if (catalogs.has(domain)) throw new Error('Ambiguous CDM code-list domain: ' + domain);
    const list = decodeCuratedCdmCodeList(content, version);
    catalogs.set(domain, list && { ...list, sourcePath: resource.path });
  }
  const available = [...catalogs].flatMap(([domain, list]) => (list ? [[domain, list] as const] : []));
  return new Map(available.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
