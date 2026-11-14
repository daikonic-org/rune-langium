// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { PortableProjectPathSchema } from './portable-records.js';

const sourcePath = PortableProjectPathSchema.refine((path) => path.endsWith('.rosetta'), 'Use a Rune source path.');
export const WorkflowPreparationSchema = z
  .strictObject({
    module: PortableProjectPathSchema,
    driver: PortableProjectPathSchema,
    outputs: z.array(sourcePath).min(1).max(8),
    parameters: z.json().optional()
  })
  .superRefine((value, context) => {
    if (!/\.(?:m?js|ts)$/.test(value.module))
      context.addIssue({
        code: 'custom',
        message: 'Use a TypeScript or JavaScript preparation module.',
        path: ['module']
      });
    if (value.driver !== value.module.slice(0, value.module.lastIndexOf('/') + 1) + 'driver.js')
      context.addIssue({
        code: 'custom',
        message: 'Keep the pinned driver.js beside the preparation module.',
        path: ['driver']
      });
    if (new Set(value.outputs).size !== value.outputs.length)
      context.addIssue({ code: 'custom', message: 'Preparation output paths must be unique.', path: ['outputs'] });
  });
export type WorkflowPreparation = z.infer<typeof WorkflowPreparationSchema>;

/** Preparation produces normal Rune overrides; it cannot write files or install callbacks. */
export const WorkflowPreparedSourcesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sources: z
    .record(sourcePath, z.string().min(1))
    .refine(
      (sources) => Object.keys(sources).length > 0 && Object.keys(sources).length <= 8,
      'Supply one to eight prepared Rune sources.'
    )
});
export type WorkflowPreparedSources = z.infer<typeof WorkflowPreparedSourcesSchema>;
