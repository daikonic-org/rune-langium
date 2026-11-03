// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext } from 'react';
import { withInstrumentation } from '../services/instrumentation/core.js';

export type CenterPane = 'graph' | 'source' | 'inspector' | 'structure';

export interface CenterPanesContextValue {
  activePanes: Set<CenterPane>;
  focusedPane: CenterPane | null;
  focus: (pane: CenterPane | null) => void;
  reveal: (pane: Extract<CenterPane, 'source' | 'inspector'>) => void;
  toggle: (pane: CenterPane) => void;
}

export const CenterPanesContext = createContext<CenterPanesContextValue>({
  activePanes: new Set<CenterPane>(['graph', 'source', 'inspector']),
  focusedPane: null,
  focus: () => {},
  reveal: () => {},
  toggle: () => {}
});

export const useCenterPanes = withInstrumentation(
  function useCenterPanes(): CenterPanesContextValue {
    return useContext(CenterPanesContext);
  },
  { op: 'useCenterPanes' }
);
