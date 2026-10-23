// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { ExcelOptionsSchema } from './excel-options.js';
import { OpenApiOptionsSchema } from './openapi-options.js';

const moduleLayout = z.enum(['per-namespace', 'barrel', 'single-file']);
const flatLayout = z.enum(['per-namespace', 'single-file']);
export const TARGET_LAYOUT_SCHEMAS = {
  zod: moduleLayout,
  typescript: moduleLayout,
  'json-schema': flatLayout,
  sql: flatLayout,
  markdown: z.enum(['per-namespace', 'barrel'])
};
export const ZodOptionsSchema = z.object({ layout: moduleLayout.optional() });
export const TypescriptOptionsSchema = ZodOptionsSchema.extend({ inputChecks: z.boolean().optional() });
export const JsonSchemaOptionsSchema = z.object({ layout: flatLayout.optional() });
export const SqlOptionsSchema = z.object({
  dialect: z.enum(['postgres', 'sqlserver']).optional(),
  inheritance: z.enum(['single-table', 'table-per-type']).optional(),
  enumStrategy: z.enum(['check', 'table']).optional(),
  layout: flatLayout.optional()
});
export const MarkdownOptionsSchema = z.object({ layout: TARGET_LAYOUT_SCHEMAS.markdown.optional() });
export const TARGET_OPTIONS_SCHEMAS = {
  zod: ZodOptionsSchema,
  typescript: TypescriptOptionsSchema,
  'json-schema': JsonSchemaOptionsSchema,
  sql: SqlOptionsSchema,
  markdown: MarkdownOptionsSchema,
  excel: ExcelOptionsSchema,
  openapi: OpenApiOptionsSchema,
  xsd: z.object({}),
  graphql: z.object({})
};
export type ZodOptions = z.infer<typeof ZodOptionsSchema>;
export type TypescriptOptions = z.infer<typeof TypescriptOptionsSchema>;
export type JsonSchemaOptions = z.infer<typeof JsonSchemaOptionsSchema>;
export type SqlOptions = z.infer<typeof SqlOptionsSchema>;
export type MarkdownOptions = z.infer<typeof MarkdownOptionsSchema>;
