// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { ProjectResolutionContextSchema, type ProjectResolutionContext } from '@rune-langium/core/project-contract';
import {
  ProjectLockSchema,
  ProjectOverrideSchema,
  canonicalProjectJson,
  projectFileRevision,
  type ProjectSnapshot
} from '@rune-langium/project-config';
import { createProjectReceipt } from './project-receipt.js';
export async function createProjectResolutionContext(
  snapshot: ProjectSnapshot,
  models: Readonly<Record<string, string>>
): Promise<ProjectResolutionContext> {
  const captured = structuredClone(snapshot);
  return ProjectResolutionContextSchema.parse({
    schemaVersion: 1,
    receipt: await createProjectReceipt(captured),
    lock: captured.lock ?? null,
    overrides: captured.project.build.overrides ?? [],
    models: { ...models }
  });
}
/** Hosts acknowledge the configuration they applied, never unchecked digest labels. */
export async function readProjectResolutionContext(input: unknown) {
  const context = ProjectResolutionContextSchema.parse(structuredClone(input));
  const lock = context.lock === null ? null : ProjectLockSchema.parse(context.lock);
  const overrides = context.overrides.map((value) => ProjectOverrideSchema.parse(value));
  const [lockDigest, overridesDigest] = await Promise.all([
    projectFileRevision(canonicalProjectJson(lock)),
    projectFileRevision(canonicalProjectJson(overrides))
  ]);
  if (lockDigest !== context.receipt.lockDigest || overridesDigest !== context.receipt.overridesDigest)
    throw new Error('Project resolution receipt digest differs from its lock or override map.');
  return { context, lock, overrides };
}

export { projectSourceUri, projectReferenceUri } from './project-uri.js';
