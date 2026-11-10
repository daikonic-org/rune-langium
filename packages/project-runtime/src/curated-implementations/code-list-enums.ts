// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { CODE_LIST_ENUM_NAMESPACE } from '@rune-langium/core';
import { renderCodeListEnum } from '@rune-langium/codegen/export';
import { CODE_LIST_SOURCE_TEXT } from '../code-list-enums.js';
import { cdmCodeListValues } from '../code-lists.js';
import type { CdmCodeListCatalog } from './code-list-resources.js';

/** Publish non-empty lists as read-only Rune sources in the same cohort as their CDM records. */
export function curatedCdmCodeListSources(lists: CdmCodeListCatalog, commit: string) {
  const files = new Map<string, string>();
  const namespace = `${CODE_LIST_ENUM_NAMESPACE}.cdm`;
  const directory = 'derived/code-lists';
  for (const [domain, { identification, codes, sourcePath }] of lists) {
    if (!codes.length) continue;
    const label = domain
      .split(/[^a-z0-9]+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    const name = /^[A-Z]/.test(label) ? label : 'Code' + label;
    const path = `${directory}/${name}.rosetta`;
    if (files.has(path)) throw new Error('Ambiguous curated code-list enum name: ' + name);
    const provenance = [
      '// SPDX-License-Identifier: Apache-2.0',
      '// Derived from the FINOS Common Domain Model code list.',
      '// Source: ' + JSON.stringify(`https://github.com/finos/common-domain-model/blob/${commit}/${sourcePath}`),
      '// Scheme: ' + JSON.stringify(identification.canonicalUri),
      '// Version: ' + JSON.stringify(identification.version)
    ];
    files.set(path, [...provenance, renderCodeListEnum(name, cdmCodeListValues(codes), { namespace })].join('\n'));
  }
  if (!files.size) return [];
  return [
    { path: `${directory}/source.rosetta`, content: CODE_LIST_SOURCE_TEXT },
    ...Array.from(files, ([path, content]) => ({ path, content }))
  ];
}
