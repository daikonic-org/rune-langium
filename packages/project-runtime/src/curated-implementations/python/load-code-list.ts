// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { CdmCodeListCatalog } from '../code-list-resources.js';

export function loadCodeList(lists: CdmCodeListCatalog) {
  const entries = [...lists].map(
    ([domain, { identification, codes }]) =>
      '    ' + JSON.stringify(domain) + ': ' + JSON.stringify(JSON.stringify({ identification, codes }))
  );
  return {
    call: true,
    dependencies: ['json'],
    expression: `(lambda domain: __import__('json').loads({
${entries.join(',\n')}
  }[domain.lower()]))`
  } as const;
}
