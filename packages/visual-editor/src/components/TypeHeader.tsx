// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeHeader — the single shared header for a model type: a namespace eyebrow,
 * the type name, and the canonical KindBadge. Used by the type-specific form
 * editors (name EDITABLE via react-hook-form) and the read-only OtherForm
 * (static name). Pass `control` (+ onNameChange/placeholder/nameAriaLabel) for
 * the editable variant, or `name` for the read-only variant.
 */
import * as React from 'react';
import { type Control } from 'react-hook-form';
import { EditorController as Controller } from './forms/EditorFormProvider.js';
import { Crosshair } from 'lucide-react';
import { Field, FieldError } from '@rune-langium/design-system/ui/field';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import { cn } from '@rune-langium/design-system/utils';
import { KindBadge } from './KindBadge.js';
import { useEditorActionsContext } from './forms/sections/EditorActionsContext.js';
import type { TypeKind } from '../types.js';

/** Align the shared header with each form's padded body without overflowing its frame. */
export const INSPECTOR_FORM_HEADER_CLASS = 'px-0 mb-3';

export interface TypeHeaderProps {
  kind: TypeKind;
  namespace?: string;
  className?: string;
  /** Rendered after the KindBadge (e.g. a "Reference Only" badge in OtherForm). */
  trailing?: React.ReactNode;
  /** Editable variant: react-hook-form control bound to the "name" field. */
  control?: Control<any>;
  onNameChange?: (value: string) => void;
  placeholder?: string;
  nameAriaLabel?: string;
  /** Read-only variant: static name (used when `control` is absent). */
  name?: string;
  /**
   * Reveal-in-graph action. When provided, a header icon button navigates to
   * this type's graph node (parents bind it to `onNavigateToNode(nodeId)`).
   * When absent (callback or node id unavailable at the mount), the button is
   * not rendered — no dead control.
   */
  onReveal?: () => void;
}

export function TypeHeader({
  kind,
  namespace,
  className,
  trailing,
  control,
  onNameChange,
  placeholder,
  nameAriaLabel,
  name,
  onReveal
}: TypeHeaderProps): React.ReactElement {
  const editorCtx = useEditorActionsContext();
  const nameReadOnly = editorCtx?.readOnly ?? false;
  return (
    <div
      data-slot="type-header"
      className={cn('sticky top-0 z-10 flex items-center gap-2 border-b bg-muted px-4 py-2', className)}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {namespace && (
          <span data-slot="type-header-namespace" className="truncate text-xs text-muted-foreground">
            {namespace}
          </span>
        )}
        {control ? (
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) =>
              nameReadOnly ? (
                <h3 data-slot="type-name" className="truncate px-1 text-lg font-semibold">
                  {field.value}
                </h3>
              ) : (
                <Field>
                  <Input
                    {...field}
                    id={field.name}
                    data-slot="type-name-input"
                    aria-invalid={fieldState.invalid}
                    onChange={(e) => {
                      field.onChange(e);
                      onNameChange?.(e.target.value);
                    }}
                    className="h-auto px-1 py-0.5 text-lg font-semibold"
                    placeholder={placeholder}
                    aria-label={nameAriaLabel}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )
            }
          />
        ) : (
          <h3 data-slot="type-name" className="truncate px-1 text-lg font-semibold">
            {name}
          </h3>
        )}
      </div>
      {onReveal && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-slot="type-header-reveal"
          onClick={onReveal}
          aria-label="Reveal in graph"
          title="Reveal in graph"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Crosshair className="size-3.5" />
        </Button>
      )}
      <KindBadge kind={kind} />
      {trailing}
    </div>
  );
}
