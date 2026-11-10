// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
/** Stable project/export identity without object insertion-order differences. */
export function canonicalProjectJson(value: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, ordered(child)])
      );
    return value;
  };
  return JSON.stringify(ordered(value));
}

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
/** Portable identity key; config and parser hosts share this exact representation. */
export function declarationKey(identity: DeclarationIdentity): string {
  return JSON.stringify([identity.model, identity.namespace, identity.kind, identity.name, identity.dispatch ?? null]);
}
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

/** Verified upstream file origin; Nightly commits record provenance, never a reference lock. */
export const RepositoryFileSourceSchema = z.strictObject({
  model: text,
  repository: z.string().regex(/^https:\/\/github[.]com\/[\w.-]+\/[\w.-]+$/),
  release: text,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  path: text
});
export type RepositoryFileSource = z.infer<typeof RepositoryFileSourceSchema>;
export const RepositoryExampleSourceSchema = RepositoryFileSourceSchema.extend({
  format: z.enum(['JSON', 'RUNE_JSON']),
  version: text.optional(),
  /** Original catalog entry retained as provenance; project-config validates its execution contract. */
  execution: z
    .object({ descriptorPath: text, role: z.enum(['input', 'output']), descriptor: z.record(text, z.unknown()) })
    .optional()
});
export type RepositoryExampleSource = z.infer<typeof RepositoryExampleSourceSchema>;

const implementationPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Implementation paths must be relative and contained.'
  );
const implementationParameter = z.strictObject({
  name: text,
  type: text,
  kind: text,
  card: z.tuple([z.number().int().nonnegative(), z.union([z.number().int().nonnegative(), z.literal('*')])]).readonly(),
  plain: z.boolean(),
  enumValues: z.array(z.string()).readonly().optional()
});
export const FunctionImplementationSignatureSchema = z.strictObject({
  inputs: z.array(implementationParameter).readonly(),
  output: implementationParameter.optional()
});
export type FunctionImplementationSignature = z.infer<typeof FunctionImplementationSignatureSchema>;
export const FunctionImplementationTargetSchema = z.strictObject({
  path: implementationPath,
  entrypoint: text,
  expression: text,
  call: z.boolean().optional(),
  dependencies: z.array(text).readonly(),
  moduleSource: text.optional()
});
export type FunctionImplementationTarget = z.infer<typeof FunctionImplementationTargetSchema>;
/** Publication selects one implementation kind. Rune entries cannot carry native targets. */
export const FunctionImplementationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rune'),
    namespace: text,
    name: text,
    signature: FunctionImplementationSignatureSchema,
    path: implementationPath
  }),
  z.strictObject({
    kind: z.literal('language-specific'),
    namespace: text,
    name: text,
    id: text,
    signature: FunctionImplementationSignatureSchema,
    targets: z
      .strictObject({
        typescript: FunctionImplementationTargetSchema.optional(),
        python: FunctionImplementationTargetSchema.optional()
      })
      .refine(
        (value) => value.typescript !== undefined || value.python !== undefined,
        'At least one target is required.'
      )
  })
]);
export type FunctionImplementation = z.infer<typeof FunctionImplementationSchema>;
export const ImplementationSourcePackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  model: text,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.array(z.strictObject({ path: implementationPath, content: text, sha256: digest })).max(128)
});
export type ImplementationSourcePack = z.infer<typeof ImplementationSourcePackSchema>;
