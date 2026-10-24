// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
const text = z.string().min(1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const DeclarationIdentitySchema = z.object({
  model: text,
  namespace: text,
  kind: text,
  name: text,
  dispatch: text.optional()
});
export type DeclarationIdentity = z.infer<typeof DeclarationIdentitySchema>;
export const ProjectResolutionReceiptSchema = z.object({
  revision: digest,
  lockDigest: digest,
  overridesDigest: digest
});
export type ProjectResolutionReceipt = z.infer<typeof ProjectResolutionReceiptSchema>;
/** Sent with a complete retained document set, after its semantic snapshots have arrived. */
export const ProjectResolutionContextSchema = z.object({
  schemaVersion: z.literal(1),
  receipt: ProjectResolutionReceiptSchema,
  models: z.record(text, text),
  lock: z.unknown().nullable(),
  overrides: z.array(z.unknown()).max(4096)
});
export type ProjectResolutionContext = z.infer<typeof ProjectResolutionContextSchema>;
