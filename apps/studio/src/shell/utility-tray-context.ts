// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext, useContext } from 'react';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Minimal slice of a dockview group API needed by the tray toggle. */
export interface UtilityGroupApi {
  setSize(opts: { height: number }): void;
  location?: { type: string };
  collapse?(): void;
  expand?(): void;
}

export const UtilityTrayContext = createContext<{
  utilitiesCollapsed: boolean;
  /** Collapse or expand the utility tray. Supply `groupApi` when the caller
   *  knows which specific dockview group to resize (e.g. the chevron inside a
   *  group header); omit it to fall back to a global utility-panel search. */
  setUtilitiesCollapsed(collapsed: boolean, groupApi?: UtilityGroupApi): void;
  toggleUtilities(groupApi?: UtilityGroupApi): void;
}>({
  utilitiesCollapsed: false,
  setUtilitiesCollapsed: () => undefined,
  toggleUtilities: () => undefined
});

export const useUtilityTrayControls = withInstrumentation(
  function useUtilityTrayControls() {
    return useContext(UtilityTrayContext);
  },
  { op: 'useUtilityTrayControls' }
);
