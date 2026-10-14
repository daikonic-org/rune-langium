/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Pradeep Mouli */

/**
 * DockLayout — thin typed wrapper around DockviewReact.
 *
 * Applies the two-class combination that the Rune dock chrome requires:
 *   • `dockview-theme-abyss` — upstream base palette (--dv-* defaults)
 *   • `rune-dock-theme`      — structural overrides from dock-theme.css
 *
 * Extends the shell theme with Rune chrome and passes layout/panel props through.
 * Consumers can extend className with sizing utilities (e.g. "h-full min-w-0 w-full").
 */

import React, { useMemo } from 'react';
import { DockviewReact, themeAbyss } from 'dockview-react';
import type { IDockviewReactProps } from 'dockview-react';

export interface DockLayoutProps extends IDockviewReactProps {
  /**
   * Additional classes appended after the theme classes.
   * The upstream `dockview-theme-abyss` and `rune-dock-theme` classes are
   * always present and cannot be removed via this prop.
   */
  className?: string;
}

/**
 * Drop-in host for a Rune-themed dockview layout.
 *
 * All panel composition (components, defaultTabComponent, onReady, etc.) stays
 * in the consuming application — this component is purely a rendering primitive.
 */
export function DockLayout({ className, theme, ...props }: DockLayoutProps): React.ReactElement {
  const mergedClassName = ['dockview-theme-abyss', 'rune-dock-theme', ...(className ? [className] : [])].join(' ');
  // Edge groups live in Dockview's outer shell, outside the className grid.
  // Its theme must carry Rune's same tokens and structural chrome.
  const shellTheme = useMemo(() => {
    const base = theme ?? themeAbyss;
    return { ...base, className: `${base.className} rune-dock-theme` };
  }, [theme]);

  return <DockviewReact {...props} theme={shellTheme} className={mergedClassName} />;
}
