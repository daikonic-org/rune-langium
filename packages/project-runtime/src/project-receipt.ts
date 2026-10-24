// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { canonicalProjectJson, projectFileRevision, type ProjectSnapshot } from '@rune-langium/project-config';
import type { ProjectResolutionReceipt as EffectiveProjectReceipt } from '@rune-langium/core/project-contract';
export type { ProjectResolutionReceipt as EffectiveProjectReceipt } from '@rune-langium/core/project-contract';
export async function createProjectReceipt(snapshot: ProjectSnapshot): Promise<EffectiveProjectReceipt> {
  const revision = snapshot.revision;
  const lock = canonicalProjectJson(snapshot.lock ?? null);
  const overrides = canonicalProjectJson(snapshot.project.build.overrides ?? []);
  const [lockDigest, overridesDigest] = await Promise.all([projectFileRevision(lock), projectFileRevision(overrides)]);
  return { revision, lockDigest, overridesDigest };
}
export function projectReceiptMatches(
  expected: EffectiveProjectReceipt,
  actual: EffectiveProjectReceipt | undefined
): boolean {
  return (
    !!actual &&
    expected.revision === actual.revision &&
    expected.lockDigest === actual.lockDigest &&
    expected.overridesDigest === actual.overridesDigest
  );
}
