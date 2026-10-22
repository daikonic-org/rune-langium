// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type RefObject } from 'react';
import { CircleCheck, CircleX, CircleMinus, LoaderCircle } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import type { WorkflowValidation as Validation } from '../services/workflow-validation.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkflowValidation = withInstrumentation(
  function WorkflowValidation({
    name,
    validation,
    root,
    functionChecks = false
  }: {
    name: string;
    validation: Validation;
    root: RefObject<HTMLElement | null>;
    functionChecks?: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const Icon =
      validation.state === 'valid'
        ? CircleCheck
        : validation.state === 'invalid'
          ? CircleX
          : validation.state === 'pending'
            ? LoaderCircle
            : CircleMinus;
    const summary =
      validation.state === 'valid'
        ? 'Checks passed'
        : validation.state === 'invalid'
          ? `${validation.diagnostics.length} ${validation.diagnostics.length === 1 ? 'issue' : 'issues'}`
          : validation.state === 'pending'
            ? 'Checking…'
            : validation.state === 'unavailable'
              ? 'Validation unavailable'
              : 'Not checked';
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`${name}: ${summary} · View validation`}
              className={`workflow-validation workflow-validation--${validation.state}`}
              title={`${name}: ${summary}`}
            />
          }
        >
          <Icon className={`size-4 ${validation.state === 'pending' ? 'animate-spin' : ''}`} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="workflow-validation-popover" align="end">
          <h3 className="font-semibold">
            {name} · {functionChecks ? 'input checks' : 'validation'}
          </h3>
          <p role="status" className="mt-2 text-xs">
            {validation.message ?? summary}
          </p>
          {validation.diagnostics.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {validation.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.path}-${index}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal text-left text-xs"
                    onClick={() => {
                      const fields = [...(root.current?.querySelectorAll<HTMLElement>('[data-field-path]') ?? [])];
                      const path = diagnostic.path;
                      const field =
                        fields.find((el) => el.dataset.fieldPath === path) ??
                        fields
                          .filter(
                            (el) =>
                              path.startsWith(`${el.dataset.fieldPath}.`) || path.startsWith(`${el.dataset.fieldPath}[`)
                          )
                          .sort((a, b) => b.dataset.fieldPath!.length - a.dataset.fieldPath!.length)[0];
                      if (field) {
                        setOpen(false);
                        requestAnimationFrame(() => {
                          field.scrollIntoView({ block: 'center' });
                          (field.querySelector<HTMLElement>('input,button,[role="combobox"]') ?? field).focus();
                        });
                      }
                    }}
                  >
                    <CircleX className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                    <span>
                      {diagnostic.path || diagnostic.conditionName || 'Condition'}: {diagnostic.message}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
            {functionChecks
              ? 'Checks the current inputs and applicable preconditions. Execute runs the function separately.'
              : 'Checks this input using its generated Rune validator.'}
          </p>
        </PopoverContent>
      </Popover>
    );
  },
  {
    op: 'WorkflowValidation',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
