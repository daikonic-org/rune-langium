// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { z } from 'zod';

/** Resolve a declared schema path without copying its constraints. */
export function getEditorFieldSchema(root: z.ZodType, path: string): z.ZodType | undefined {
  let schema: z.ZodType | undefined = root;
  for (const segment of path.split('.')) {
    while (
      schema instanceof z.ZodOptional ||
      schema instanceof z.ZodNullable ||
      schema instanceof z.ZodDefault ||
      schema instanceof z.ZodReadonly ||
      schema instanceof z.ZodLazy
    )
      schema = schema.unwrap() as z.ZodType;
    if (schema instanceof z.ZodObject) schema = schema.shape[segment];
    else if (schema instanceof z.ZodArray && /^\d+$/.test(segment)) schema = schema.element as z.ZodType;
    else return undefined;
  }
  return schema;
}
