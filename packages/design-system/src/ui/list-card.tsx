// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors
import type { ReactNode } from 'react';
import { cn } from '../utils';

/** Shared list presentation. The host owns navigation, selection and actions. */
export function ListCard({
  icon,
  name,
  description,
  descriptionId,
  detail,
  variant = 'compact',
  className
}: {
  icon: ReactNode;
  name: ReactNode;
  description?: ReactNode;
  /** Associate secondary text via the host control's aria-describedby. */
  descriptionId?: string;
  detail?: ReactNode;
  variant?: 'compact' | 'detailed';
  className?: string;
}) {
  return (
    <span
      data-slot="list-card"
      data-variant={variant}
      className={cn('flex min-w-0 items-center gap-2 text-left', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center [&>svg]:size-full',
          variant === 'compact' ? 'size-4' : 'size-5'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          data-slot="list-card-name"
          className={cn(
            'block font-medium',
            variant === 'compact' ? 'truncate text-xs' : 'line-clamp-2 break-words text-sm'
          )}
        >
          {name}
        </span>
        {description && (
          <span
            data-slot="list-card-description"
            id={descriptionId}
            className={cn(
              'block text-muted-foreground',
              variant === 'compact' ? 'truncate text-3xs' : 'line-clamp-3 text-xs'
            )}
          >
            {description}
          </span>
        )}
        {detail && (
          <span data-slot="list-card-detail" className="block text-2xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}
