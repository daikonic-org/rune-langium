// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { vi } from 'vitest';
import { createReferenceArtifacts } from './project-reference-artifacts.js';
export { repository } from './project-reference-artifacts.js';
/** Vitest spies wrap the same immutable artifacts used by browser journeys. */
export async function referenceFixture(...args: Parameters<typeof createReferenceArtifacts>) {
  const fixture = await createReferenceArtifacts(...args);
  return {
    ...fixture,
    transport: { catalog: vi.fn(fixture.transport.catalog), artifact: vi.fn(fixture.transport.artifact) }
  };
}
