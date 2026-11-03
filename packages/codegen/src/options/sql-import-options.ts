// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { z } from 'zod';

/**
 * Options for the SQL DDL import reader (`readSql`). No node-kind filter —
 * SQL DDL is already flat (one declaration per CREATE TABLE), there is no
 * other top-level construct kind to filter today. `wasmSource` (browser
 * WASM-loading override) deliberately stays out of this schema/form — it
 * is an internal detail, not a user-facing setting.
 */
export const SqlImportOptionsSchema = z.object({
  dialect: z
    .enum(['postgres', 'sqlserver'])
    .optional()
    .default('postgres')
    .describe('Record the source database dialect. The importer currently accepts both dialects with the same parser.'),
  skipConditions: z
    .boolean()
    .optional()
    .default(false)
    .describe('Import tables and fields without their validation conditions.')
    .meta({ title: 'Skip validation conditions' })
});

export type SqlImportOptions = z.input<typeof SqlImportOptionsSchema>;
