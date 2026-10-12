// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { FieldSet, FieldLegend } from '@rune-langium/design-system/ui/field';
import { TypeReferenceField, type TypeReferenceFieldProps } from '../TypeReferenceField.js';

export function InspectorInheritanceField({
  label = 'Extends',
  ...props
}: TypeReferenceFieldProps & { label?: string }) {
  return (
    <FieldSet className="gap-1.5">
      <FieldLegend variant="label" className="mb-0 text-muted-foreground">
        {label}
      </FieldLegend>
      <TypeReferenceField allowClear {...props} />
    </FieldSet>
  );
}
