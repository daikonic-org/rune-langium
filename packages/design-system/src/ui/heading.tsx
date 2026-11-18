// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Heading — typography primitive shared across landing / docs / studio.
 * Levels 1–4 map to design-tokens font-size scale; semantic level (`as`)
 * is independent of visual size so we can avoid heading-level skips for
 * a11y while still rendering a smaller visual treatment.
 */

import type React from 'react';
import { cn } from '../utils.js';

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level: HeadingLevel;
  /** Render as a different heading element (defaults to `h${level}`). */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  size?: HeadingLevel;
}

const SIZE_CLASS: Record<HeadingLevel, string> = {
  1: 'text-3xl font-normal tracking-tight',
  2: 'text-2xl font-normal tracking-tight',
  3: 'text-xl font-normal',
  4: 'text-lg font-normal'
};

export function Heading({ level, as, size, className, children, ...rest }: HeadingProps): React.ReactElement {
  const Tag = (as ?? (`h${level}` as const)) as React.ElementType;
  const cls = SIZE_CLASS[size ?? level];
  return (
    <Tag className={cn(cls, className)} {...rest}>
      {children}
    </Tag>
  );
}
