// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { TypeReferenceFieldProps } from '../TypeReferenceField.js';
import { InspectorTypeField } from './InspectorTypeField.js';

export function InspectorInheritanceField({
  label = 'Extends',
  ...props
}: TypeReferenceFieldProps & { label?: string }) {
  return <InspectorTypeField label={label} allowClear {...props} />;
}
