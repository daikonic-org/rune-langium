// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * AppSwitcher — shared cross-app navigation between Home / Docs / Studio.
 * Consumed from the landing site, the docs theme, and Studio's activity
 * bar so all three surfaces show the same entry points to the user.
 */

import type React from 'react';
import { cn } from '../utils.js';

export type AppSurface = 'home' | 'docs' | 'studio';

export interface AppSwitcherProps {
  current: AppSurface;
  /** Override the URLs (e.g. for staging deploys). */
  urls?: Partial<Record<AppSurface, string>>;
  className?: string;
}

const DEFAULT_URLS: Record<AppSurface, string> = {
  home: 'https://www.daikonic.dev/',
  docs: 'https://www.daikonic.dev/docs/',
  studio: 'https://www.daikonic.dev/rune-studio/'
};

const LABELS: Record<AppSurface, string> = {
  home: 'Home',
  docs: 'Docs',
  studio: 'Studio'
};

export function AppSwitcher({ current, urls, className }: AppSwitcherProps): React.ReactElement {
  const resolved = { ...DEFAULT_URLS, ...urls };
  return (
    <nav
      aria-label="rune-langium surfaces"
      className={cn('flex items-center gap-2', className)}
      data-testid="app-switcher"
    >
      {(Object.keys(LABELS) as AppSurface[]).map((surface) => {
        const isCurrent = surface === current;
        return (
          <a
            key={surface}
            href={resolved[surface]}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-normal transition-colors',
              isCurrent ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {LABELS[surface]}
          </a>
        );
      })}
    </nav>
  );
}
