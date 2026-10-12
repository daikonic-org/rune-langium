// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useFormState, type FieldErrors } from 'react-hook-form';
import { ErrorsSection } from '../../ErrorsSection.js';
import type { ValidationError } from '../../../types.js';

function messages(errors: FieldErrors): string[] {
  const output: string[] = [];
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== 'object') continue;
    if (typeof value.message === 'string') output.push(value.message);
    else output.push(...messages(value as FieldErrors));
  }
  return output;
}

/** Display canonical validation and only host-reported save status. */
export function InspectorFooter({ errors, status }: { errors: ValidationError[]; status?: string }) {
  const form = useFormState();
  const local = [...new Set(messages(form.errors))];
  return (
    <div className="max-h-32 overflow-auto text-xs">
      {status && (
        <p role="status" className="text-muted-foreground">
          {status}
        </p>
      )}
      {local.length > 0 && (
        <div role="alert" className="text-destructive">
          {local.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <ErrorsSection errors={errors} />
    </div>
  );
}
