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
    ref: 'unpublished',
    examples: Object.freeze(['Source model', 'Saved input and expected result', 'Named build target']),
    requiredCapabilities: Object.freeze(['Rune execution']),
    status: 'unavailable' as const
  }),
  Object.freeze({
    id: 'cdm-examples',
    name: 'CDM examples',
    description: 'Explore a pinned reference release with editable example data.',
    repository: 'daikonic-org/cdm-examples',
    ref: 'unpublished',
    examples: Object.freeze(['Pinned reference configuration', 'Example input']),
    requiredCapabilities: Object.freeze(['Verified CDM release', 'Function providers required by each workflow']),
    status: 'unavailable' as const
  })
]);
/** Proposed repositories remain unavailable until publication and source verification. */
export const listStarterProjects = withInstrumentation(
  function listStarterProjects(): readonly StarterProject[] {
    return catalog;
  },
  { op: 'listStarterProjects', capture: 0 }
);
