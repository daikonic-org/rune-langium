// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';

const text = z.string().min(1);
export const SymbolIdentitySchema = z.object({
  model: text,
  namespace: text,
  kind: text,
  name: text,
  dispatch: text.optional()
});
export const BuildTargetSchema = z.object({
  generator: text,
  options: z.record(z.string(), z.unknown()).default(() => ({})),
  output: text,
  namespaces: z.array(text).optional()
});
export const ReferenceRequestSchema = z.object({ repository: text, release: text });
export const ProjectOverrideSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('declaration'), source: SymbolIdentitySchema, replacement: SymbolIdentitySchema }),
  z.object({ kind: z.literal('resource'), source: z.object({ model: text, id: text }), path: text }),
  z.object({ kind: z.literal('implementation'), source: SymbolIdentitySchema, provider: text })
]);
export const BuildConfigSchema = z.object({
  schemaVersion: z.literal(1),
  runeConfig: text.default('rune-config.yml'),
  sources: z.array(text).default(() => ['model/**/*.rosetta']),
  resources: z.array(z.object({ path: text })).default(() => [{ path: 'resources' }]),
  references: z.record(z.string(), ReferenceRequestSchema).default(() => ({})),
  targets: z.record(z.string(), BuildTargetSchema).default(() => ({})),
  overrides: z.array(ProjectOverrideSchema).optional()
});
export const StudioConfigSchema = z.object({
  schemaVersion: z.literal(1),
  examples: text.default('examples'),
  workflows: text.default('workflows'),
  layouts: text.default('layouts')
});
export const ProjectLockSchema = z.object({
  schemaVersion: z.literal(1),
  configHash: text,
  toolchain: z.record(z.string(), text),
  references: z.record(
    z.string(),
    z.object({
      repository: text,
      release: text,
      commit: text,
      manifest: text,
      cohort: text,
      checksum: text,
      dependencies: z.record(z.string(), text)
    })
  )
});
