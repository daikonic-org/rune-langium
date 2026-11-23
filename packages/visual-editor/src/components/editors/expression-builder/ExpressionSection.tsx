// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { cn } from '@rune-langium/design-system/utils';

type ExpressionSectionProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'span';
  label?: string;
  onRemove?(): void;
};

/** Selectable expression section with one staged removal action for pointer and keyboard. */
export function ExpressionSection({
  as: Element = 'div',
  label,
  onRemove,
  className,
  children,
  ...props
}: ExpressionSectionProps) {
  const removeLabel = 'Remove ' + label;
  return (
    <Element
      {...props}
      data-expression-section={label ? '' : undefined}
      role={label ? 'group' : undefined}
      aria-label={label}
      aria-keyshortcuts={onRemove ? 'Delete Backspace' : undefined}
      tabIndex={onRemove ? 0 : undefined}
      className={cn(
        className,
        onRemove &&
          'relative pe-8 focus:outline-2 focus:outline-ring focus:-outline-offset-2 has-[>[data-expression-remove]:is(:hover,:focus-visible)]:border-destructive'
      )}
      onClick={
        onRemove &&
        ((event) => {
          const target = event.target;
          if (
            target instanceof HTMLElement &&
            target.closest('[data-expression-section]') === event.currentTarget &&
            !target.closest('button, input, textarea, select, a, [contenteditable="true"]')
          )
            event.currentTarget.focus();
        })
      }
      onKeyDown={
        onRemove &&
        ((event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            event.target.closest('[data-expression-section]') !== event.currentTarget ||
            (event.target !== event.currentTarget && !event.target.matches('button[data-expression-section-handle]')) ||
            event.target.getAttribute('aria-expanded') === 'true' ||
            event.defaultPrevented ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (event.key !== 'Delete' && event.key !== 'Backspace')
          )
            return;
          event.preventDefault();
          onRemove();
        })
      }
    >
      {children}
      {onRemove && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute end-1 top-0.5 text-destructive hover:text-destructive"
          data-expression-remove
          data-expression-section-handle
          aria-label={removeLabel}
          aria-keyshortcuts="Delete Backspace"
          title={removeLabel + ' (Delete)'}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </Element>
  );
}
