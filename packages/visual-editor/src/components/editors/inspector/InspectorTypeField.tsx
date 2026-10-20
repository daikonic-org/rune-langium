// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useId, type ComponentProps } from 'react';
import { FieldSet } from '@rune-langium/design-system/ui/field';
import { TypeReferenceField, type TypeReferenceFieldProps } from '../TypeReferenceField.js';

/** A shared baseline for a type label and its picker/navigation controls. */
export function InspectorTypeField({
  label,
  fieldsetProps,
  ...props
}: TypeReferenceFieldProps & {
  label: string;
  fieldsetProps?: Pick<ComponentProps<typeof FieldSet>, 'onFocusCapture' | 'onClick'>;
}) {
  const labelId = useId();
  return (
    <FieldSet {...fieldsetProps} aria-labelledby={labelId} className="shrink-0 gap-0">
      <div className="flex min-h-9 min-w-0 items-center gap-3 py-1">
        <span id={labelId} className="max-w-1/2 shrink-0 text-xs text-muted-foreground">
          {label}
        </span>
        <TypeReferenceField {...props} />
      </div>
    </FieldSet>
  );
}
