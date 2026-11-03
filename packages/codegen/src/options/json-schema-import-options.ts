// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { z } from 'zod';

/**
 * Options for the JSON Schema import reader (`readJsonSchema`). Also the
 * base schema `OpenApiImportOptionsSchema` extends — OpenAPI's schema
 * conversion delegates to `readJsonSchema` internally.
 */
export const JsonSchemaImportOptionsSchema = z.object({
  skipConditions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Import types and fields without their validation conditions.')
    .meta({ title: 'Skip validation conditions' }),
  includeUnreferencedDefs: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Include all named type definitions. Turn off to omit isolated definitions that no imported root type uses.'
    )
    .meta({ title: 'Include unused type definitions' })
});

export type JsonSchemaImportOptions = z.input<typeof JsonSchemaImportOptionsSchema>;
