// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from './instrumentation/core.js';

export interface StarterProject {
  id: string;
  name: string;
  description: string;
  repository: string;
  ref: string;
  examples: readonly string[];
  requiredCapabilities: readonly string[];
  status: 'available' | 'unavailable';
}
const catalog: readonly StarterProject[] = Object.freeze([
  Object.freeze({
    id: 'model-authoring',
    name: 'Model authoring',
    description: 'Define types, validate data and save a small Rune workflow.',
    repository: 'daikonic-org/rune-starter',
    ref: 'f0501c070efc95384f2f7ac5f0fe93381b4422f9',
    examples: Object.freeze(['Source model', 'Saved input and expected result', 'Named build target']),
    requiredCapabilities: Object.freeze(['Rune execution']),
    status: 'available' as const
  }),
  Object.freeze({
    id: 'cdm-examples',
    name: 'CDM example',
    description: 'Explore CDM swap cashflows, SOFR note valuation and compounded SONIA loan interest.',
    repository: 'daikonic-org/rune-cdm-example',
    ref: 'bbe3ba6665ddca9fda31dc5d0480135264a79fa7',
    examples: Object.freeze([
      'CDM vanilla swap and product cashflows',
      'SOFR floating-rate note valuation',
      'Compounded SONIA facility accrual'
    ]),
    requiredCapabilities: Object.freeze(['Verified CDM release', 'Rune execution']),
    status: 'available' as const
  })
]);
/** Published examples use verified commit identities; opening still checks every public source object. */
export const listStarterProjects = withInstrumentation(
  function listStarterProjects(): readonly StarterProject[] {
    return catalog;
  },
  { op: 'listStarterProjects', capture: 0 }
);
