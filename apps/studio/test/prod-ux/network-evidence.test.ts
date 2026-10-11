// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import type { Response } from '@playwright/test';
import { captureNetworkResponse } from './network-evidence.js';

function responseFixture(documentCount: number): Response {
  return {
    url: () => 'https://www.daikonic.dev/api/parse',
    status: () => 200,
    headers: () => ({ 'server-timing': 'parse;dur=120' }),
    finished: async () => null,
    json: async () => ({
      hydrationState: {
        documents: Array.from({ length: documentCount }, (_, i) => (i < 2 ? { bundleId: 'cdm' } : {}))
      },
      requiredCuratedArtifacts: [{}]
    }),
    request: () => ({
      headers: () => ({ 'x-studio-op-id': '42' }),
      postDataJSON: () => ({ knownCuratedArtifacts: ['a', 'b'], hydrateNamespaces: ['example'] }),
      timing: () => ({ startTime: 1000, responseStart: 150, responseEnd: 210 }),
      sizes: async () => ({ responseBodySize: 1234 })
    })
  } as unknown as Response;
}

describe('production request evidence', () => {
  it.each([3, 0])('records %i transferred documents independently of advertised receipts', async (documentCount) => {
    const response = responseFixture(documentCount);
    expect(await captureNetworkResponse(response)).toEqual({
      path: '/api/parse',
      status: 200,
      opId: '42',
      startedAt: 1000,
      headersMs: 150,
      totalMs: 210,
      transferMs: 60,
      responseBytes: 1234,
      serverTiming: 'parse;dur=120',
      knownArtifactCount: 2,
      documentCount,
      curatedDocumentCount: Math.min(2, documentCount),
      requiredArtifactCount: 1,
      hydrateNamespaces: ['example']
    });
  });

  it('retains timings when the response body is unavailable without claiming a zero-document cache hit', async () => {
    const response = responseFixture(3);
    vi.spyOn(response, 'json').mockRejectedValue(new Error('response body evicted'));
    const record = await captureNetworkResponse(response);
    expect(record).toMatchObject({ totalMs: 210, responseBytes: 1234, detailsUnavailable: true });
    expect(record.documentCount).toBeUndefined();
    expect(record.curatedDocumentCount).toBeUndefined();
  });
});
