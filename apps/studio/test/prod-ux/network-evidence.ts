// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Response } from '@playwright/test';

export interface NetworkRecord {
  path: string;
  status: number;
  opId?: string;
  startedAt: number;
  headersMs: number;
  totalMs: number;
  transferMs: number;
  responseBytes?: number;
  serverTiming?: string;
  knownArtifactCount?: number;
  documentCount?: number;
  curatedDocumentCount?: number;
  requiredArtifactCount?: number;
  hydrateNamespaces?: string[];
  detailsUnavailable?: boolean;
}

export async function captureNetworkResponse(response: Response): Promise<NetworkRecord> {
  const request = response.request();
  await response.finished();
  const timing = request.timing();
  const sizes = await request.sizes().catch(() => undefined);
  const path = new URL(response.url()).pathname;
  const record: NetworkRecord = {
    path,
    status: response.status(),
    opId: request.headers()['x-studio-op-id'],
    startedAt: timing.startTime,
    headersMs: timing.responseStart,
    totalMs: timing.responseEnd,
    transferMs: timing.responseEnd - timing.responseStart,
    responseBytes: sizes?.responseBodySize,
    serverTiming: response.headers()['server-timing']
  };
  if (path === '/api/parse') {
    const body = request.postDataJSON();
    record.knownArtifactCount = body?.knownCuratedArtifacts?.length ?? 0;
    record.hydrateNamespaces = body?.hydrateNamespaces ?? [];
    try {
      const data = await response.json();
      const documents = data?.hydrationState?.documents;
      record.documentCount = documents?.length;
      record.curatedDocumentCount = documents?.filter(
        (doc: { bundleId?: string }) => typeof doc.bundleId === 'string'
      ).length;
      record.requiredArtifactCount = data?.requiredCuratedArtifacts?.length;
    } catch {
      record.detailsUnavailable = true;
    }
  }
  return record;
}
