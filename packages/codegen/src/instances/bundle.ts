// SPDX-License-Identifier: MIT
import type { LangiumDocument } from 'langium';
import { z } from 'zod';
import { DeclarationIdentitySchema } from '@rune-langium/core/project-contract';
import { sha256Hex } from './fingerprint.js';

const InstanceProvenanceSchema = z.object({
  codec: z.string(),
  source: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  importedAt: z.number()
});
export type InstanceProvenance = z.infer<typeof InstanceProvenanceSchema>;
const ValidationDiagnosticSchema = z.object({
  path: z.string(),
  message: z.string(),
  conditionName: z.string().optional()
});
export type ValidationDiagnostic = z.infer<typeof ValidationDiagnosticSchema>;

const InstanceRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  typeFqn: z.string().min(1),
  concreteTypeFqn: z.string().optional(),
  typeIdentity: DeclarationIdentitySchema.optional(),
  data: z.unknown(),
  provenance: InstanceProvenanceSchema.optional(),
  createdAt: z.number(),
  modifiedAt: z.number(),
  stale: z.object({ reason: z.string(), diagnostics: z.array(ValidationDiagnosticSchema) }).optional()
});

export type InstanceRecord = z.infer<typeof InstanceRecordSchema>;

/** Decode the legacy record envelope; arbitrary hidden JSON is not an example. */
export function parseInstanceRecord(json: string): InstanceRecord {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'data')) {
    throw new Error('An example record must include its data.');
  }
  return InstanceRecordSchema.parse(value);
}

export interface BundleManifestInstanceEntry {
  id: string;
  name: string;
  typeFqn: string;
}

export interface BundleManifest {
  formatVersion: 1;
  modelFingerprint: string;
  gitCommitSha?: string;
  instances: BundleManifestInstanceEntry[];
}

const FORMAT_VERSION = 1;

/**
 * Content hash of the currently-loaded model's serialized parsed documents.
 * Gates staleness on bundle import — see design doc §4.
 *
 * Uses `JSON.stringify` on the sorted text array (not `.join('\n')`) as the
 * hash input — a plain `\n`-join is ambiguous across document boundaries:
 * a single document `"a\nb"` and two documents `"a"`, `"b"` both join to
 * the identical string `"a\nb"` and would hash identically even though
 * they're different document sets. `JSON.stringify` on the array preserves
 * document boundaries unambiguously.
 */
export async function computeModelFingerprint(documents: LangiumDocument[]): Promise<string> {
  const serialized = JSON.stringify(documents.map((doc) => doc.textDocument.getText()).sort());
  return sha256Hex(new TextEncoder().encode(serialized));
}

export function buildManifest(
  instances: InstanceRecord[],
  modelFingerprint: string,
  gitCommitSha: string | undefined
): BundleManifest {
  return {
    formatVersion: FORMAT_VERSION,
    modelFingerprint,
    ...(gitCommitSha ? { gitCommitSha } : {}),
    instances: instances.map((r) => ({ id: r.id, name: r.name, typeFqn: r.typeFqn }))
  };
}

export function serializeManifest(manifest: BundleManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseManifest(json: string): BundleManifest {
  const parsed = JSON.parse(json) as BundleManifest;
  if (parsed.formatVersion !== FORMAT_VERSION) {
    throw new Error(`bundle manifest: unsupported formatVersion ${parsed.formatVersion}, expected ${FORMAT_VERSION}`);
  }
  return parsed;
}
