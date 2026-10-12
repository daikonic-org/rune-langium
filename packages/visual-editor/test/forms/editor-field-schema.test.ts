// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { SCHEMA_BY_TYPE } from '../../src/schemas/schema-by-type.js';
import { getEditorFieldSchema } from '../../src/schemas/editor-field-schema.js';

describe('canonical editor field schema', () => {
  it('retains canonical identifier union and nested optional field constraints', () => {
    const name = getEditorFieldSchema(SCHEMA_BY_TYPE.Data, 'attributes.0.name')!;
    expect(name.safeParse('field').success).toBe(true);
    expect(name.safeParse('').success).toBe(false);
    expect(
      getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaFunction, 'inputs.1.definition')!.safeParse(undefined).success
    ).toBe(true);
    expect(
      getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaEnumeration, 'enumValues.0.display')!.safeParse(undefined).success
    ).toBe(true);
    expect(getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaEnumeration, 'enumValues.0.labels')).toBeUndefined();
    expect(getEditorFieldSchema(SCHEMA_BY_TYPE.Data, 'attributes.nope.name')).toBeUndefined();
  });
});
