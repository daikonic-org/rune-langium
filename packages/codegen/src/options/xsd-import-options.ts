// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { z } from 'zod';

/** Options for the XSD import reader (`readXsd`). */
export const XsdImportOptionsSchema = z.object({
  skipConditions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Import types and fields without their validation conditions.')
    .meta({ title: 'Skip validation conditions' }),
  importTopLevelElements: z
    .boolean()
    .optional()
    .default(false)
    .describe('Create a standalone Rune type for each top-level XML element, as well as the named schema types.')
});

export type XsdImportOptions = z.input<typeof XsdImportOptionsSchema>;
