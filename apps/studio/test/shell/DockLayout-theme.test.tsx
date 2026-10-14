// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DockLayout } from '@rune-langium/design-system/ui/dock-layout';
import { themeAbyss } from 'dockview-react';

it.each([undefined, { ...themeAbyss, className: 'custom-dock-theme', gap: 8 }])(
  'carries the shared Rune theme across the grid and native edge shell',
  (theme) => {
    const { unmount } = render(
      <DockLayout
        theme={theme}
        components={{ panel: () => <span>Panel</span> }}
        onReady={({ api }) => {
          api.layout(1280, 720);
          const panel = api.addPanel({ id: 'auxiliary', component: 'panel' });
          const edge = api.addEdgeGroup('right', { id: 'tools', initialSize: 280 });
          const group = api.groups.find((candidate) => candidate.id === edge.id)!;
          panel.api.moveTo({ group, position: 'center' });
          const shell = group.element.closest('.dv-shell');
          expect(shell).toHaveClass('rune-dock-theme');
          expect(shell).toHaveClass(theme?.className ?? themeAbyss.className);
          expect(group.element.closest('.rune-dock-theme')).toBe(shell);
        }}
      />
    );
    unmount();
  }
);
