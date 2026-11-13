// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** z2f's generated-form contract, backed by the existing design system. */
import type { ReactElement, ReactNode } from 'react';
import { Field as DSField } from '@rune-langium/design-system/ui/field';
import { withInstrumentation } from '../services/instrumentation/core.js';

export { Checkbox, Checkbox as Switch } from '@rune-langium/design-system/ui/checkbox';
export { Input } from '@rune-langium/design-system/ui/input';
export { Textarea } from '@rune-langium/design-system/ui/textarea';
export { Label } from '@rune-langium/design-system/ui/label';
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
export { RadioGroup, RadioGroupItem } from '@rune-langium/design-system/ui/radio-group';
export { FieldLabel, FieldDescription, FieldError } from '@rune-langium/design-system/ui/field';
export { FieldTemplate, type FieldTemplateProps } from '@rune-langium/visual-editor/components';

// The generated shadcn preset fixes sibling order: label, control, help, error.
// Keep its adapter hook for checkbox alignment while the DS owns field styling.
export const Field = withInstrumentation(
  function Field({ children }: { children: ReactNode }): ReactElement {
    return <DSField className="z2f-field">{children}</DSField>;
  },
  { op: 'Field' }
);
