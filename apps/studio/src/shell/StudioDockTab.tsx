// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { NumberChiclet } from '@rune-langium/design-system/ui/number-chiclet';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { getExploreSidePanel } from './auxiliary-panel-layout.js';

export interface StudioDockTabParams {
  count?: number;
}

/** Shared Dockview tab chrome for every Studio workbench. */
export const StudioDockTab = withInstrumentation(
  function StudioDockTab({ api, params }: IDockviewPanelHeaderProps<StudioDockTabParams>): React.ReactElement {
    const element = useRef<HTMLDivElement>(null);
    const labelId = useId();
    useEffect(() => {
      const tab = element.current?.closest('.dv-tab');
      if (!tab) return;
      // Dockview owns the tab element; its name must include the visible count.
      tab.setAttribute('aria-labelledby', labelId);
      const select = (event: Event) => {
        if (event.defaultPrevented) return;
        if (!getExploreSidePanel(api.group.panels.map((panel) => panel.api.component))) return;
        if (event instanceof MouseEvent && (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey))
          return;
        // Side tabs select a view; the explicit chevron alone hides the panel.
        event.preventDefault();
        api.setActive();
        if (api.location.type === 'edge') api.group.api.expand();
      };
      tab.addEventListener('click', select, true);
      return () => {
        tab.removeEventListener('click', select, true);
        if (tab.getAttribute('aria-labelledby') === labelId) tab.removeAttribute('aria-labelledby');
      };
    }, [api, labelId]);
    const [count, setCount] = useState<number | undefined>(
      params?.count ?? api.getParameters<StudioDockTabParams>()?.count
    );
    const [title, setTitle] = useState(api.title ?? '');

    useEffect(() => {
      setCount(params?.count);
    }, [params?.count]);

    useEffect(() => {
      setCount(api.getParameters<StudioDockTabParams>()?.count);
      setTitle(api.title ?? '');
      const titleSubscription = api.onDidTitleChange(({ title }) => setTitle(title));
      const disposable = api.onDidParametersChange((next) => {
        setCount((next as StudioDockTabParams | undefined)?.count);
      });
      return () => {
        disposable.dispose();
        titleSubscription.dispose();
      };
    }, [api]);

    return (
      <div
        id={labelId}
        ref={element}
        className="studio-dock-tab"
        data-component={api.component}
        data-count={count === undefined ? undefined : String(count)}
      >
        <span className="studio-dock-tab__label">{title}</span>
        {count !== undefined ? (
          <NumberChiclet className="studio-dock-tab__count" title={`${count} item${count === 1 ? '' : 's'}`}>
            {count}
          </NumberChiclet>
        ) : null}
      </div>
    );
  },
  { op: 'StudioDockTab' }
);
