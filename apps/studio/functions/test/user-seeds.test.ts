// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { readSerializedModelMeta } from '../lib/serialized-model-meta.js';
import { collectUserSeedNamespaces } from '../api/parse.js';

describe('collectUserSeedNamespaces', () => {
  it('collects imports and qualified references even before their targets link', () => {
    const model = readSerializedModelMeta(
      JSON.stringify({
        name: 'app',
        imports: [{ importedNamespace: 'cdm.trade' }, { importedNamespace: 'cdm.base.*' }],
        elements: [{ type: { $error: 'Not loaded', $refText: 'fpml.consolidated.loan.FacilitySummary' } }]
      })
    );
    expect([...collectUserSeedNamespaces([model!])].sort()).toEqual([
      'cdm.base.*',
      'cdm.trade',
      'fpml.consolidated.loan'
    ]);
  });
});
