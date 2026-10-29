// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { PortableProjectPathSchema } from './portable-records.js';

/** Upstream execution-descriptor.json format; paths are relative to the resource root. */
export const ExecutionDescriptorSchema = z
  .object({
    group: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    inputFile: PortableProjectPathSchema,
    expectedOutputFile: PortableProjectPathSchema.optional(),
    markDownFile: PortableProjectPathSchema.optional(),
    executableFunctionClass: z.string().regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/),
    nativeFunction: z.boolean().optional()
  })
  .passthrough();
export const ExecutionCatalogSchema = z.array(ExecutionDescriptorSchema);
export type ExecutionDescriptor = z.infer<typeof ExecutionDescriptorSchema>;
