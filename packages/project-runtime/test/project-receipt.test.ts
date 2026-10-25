// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { referenceFixture } from '../../../test/helpers/project-reference-fixture.js';
import { createProjectReceipt, projectReceiptMatches } from '../src/project-receipt.js';
it('requires exact revision, lock and override acknowledgements', async () => {
  const { snapshot } = await referenceFixture();
  const expected = await createProjectReceipt(snapshot);
  expect(projectReceiptMatches(expected, expected)).toBe(true);
  expect(projectReceiptMatches(expected, undefined)).toBe(false);
  for (const key of ['revision', 'lockDigest', 'overridesDigest'] as const)
    expect(projectReceiptMatches(expected, { ...expected, [key]: 'stale' })).toBe(false);
});

it('rejects a resolution envelope whose actual lock or override map differs from its receipt', async () => {
  const { createProjectResolutionContext, readProjectResolutionContext } = await import('../src/project-context.js');
  const { snapshot } = await referenceFixture();
  const context = await createProjectResolutionContext(snapshot, {});
  expect((await readProjectResolutionContext(context)).overrides).toEqual([]);
  for (const key of ['lockDigest', 'overridesDigest'] as const)
    await expect(
      readProjectResolutionContext({ ...context, receipt: { ...context.receipt, [key]: 'f'.repeat(64) } })
    ).rejects.toThrow(/digest|receipt/i);
});
