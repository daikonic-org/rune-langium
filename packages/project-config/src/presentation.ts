// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { declarationKey } from '@rune-langium/core/project-contract';
import { SymbolIdentitySchema } from './config-schema.js';
import { readPortableRecords } from './portable-records.js';
import type { ProjectSnapshot } from './types.js';
/** Relative source-property paths; the empty path addresses a primitive control itself. */
const propertyPath = z.string().regex(/^(?:[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*)?$/u);
export const PresentationDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: SymbolIdentitySchema,
  fields: z.record(
    propertyPath,
    z.strictObject({
      order: z.number().int().nonnegative().optional(),
      span: z.number().int().min(1).max(3).optional(),
      format: z
        .strictObject({
          kind: z.string().min(1),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          precision: z.number().int().min(0).max(20).optional(),
          grouping: z.boolean().optional()
        })
        .optional()
    })
  ),
  columns: z.number().int().min(1).max(3).optional()
});
export type PresentationDescriptor = z.infer<typeof PresentationDescriptorSchema>;
export function readPresentations(snapshot: ProjectSnapshot, knownSymbols?: ReadonlySet<string>) {
  const read = readPortableRecords(snapshot, {
    root: 'layouts',
    extension: '.layout.json',
    prefix: 'PRESENTATION',
    parse: (value) => PresentationDescriptorSchema.parse(value)
  });
  const seen = new Set<string>();
  for (const { path, value } of read.documents) {
    const key = declarationKey(value.type);
    const issue = (code: string, message: string) => read.diagnostics.push({ code, path, message, severity: 'error' });
    if (seen.has(key))
      issue('PRESENTATION_DUPLICATE_TYPE', 'This type has multiple presentation files. All are retained for repair.');
    seen.add(key);
    if (knownSymbols && !knownSymbols.has(key))
      issue('PRESENTATION_SYMBOL_UNAVAILABLE', 'The presentation type is unavailable. Its layout is retained.');
    for (const field of Object.values(value.fields))
      if (field.format && !['decimal', 'currency', 'date', 'datetime', 'time'].includes(field.format.kind))
        issue(
          'PRESENTATION_FORMAT_UNAVAILABLE',
          'This presentation format is unavailable. Its descriptor is retained.'
        );
  }
  return {
    presentations: read.documents.map((entry) => entry.value),
    documents: read.documents,
    diagnostics: read.diagnostics
  };
}
