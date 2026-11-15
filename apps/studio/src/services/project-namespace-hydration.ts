// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from './instrumentation/core.js';
/** Route the existing namespace queue to the active verified project, never the moving server mirror. */
export interface NamespaceHydrationProgress {
  completed: number;
  total: number;
}
export type NamespaceHydrator = (
  namespaces: readonly string[],
  onProgress?: (progress: NamespaceHydrationProgress) => void
) => Promise<void>;
const owners = new Map<string, NamespaceHydrator>();
export const registerProjectNamespaceHydrator = withInstrumentation(
  function registerProjectNamespaceHydrator(workspace: string, hydrate: NamespaceHydrator) {
    owners.set(workspace, hydrate);
    return () => {
      if (owners.get(workspace) === hydrate) owners.delete(workspace);
    };
  },
  { op: 'registerProjectNamespaceHydrator', capture: 0 }
);
export const hydrateProjectNamespaces = withInstrumentation(
  function hydrateProjectNamespaces(
    workspace: string | undefined,
    namespaces: readonly string[],
    onProgress?: (progress: NamespaceHydrationProgress) => void
  ) {
    return workspace ? owners.get(workspace)?.(namespaces, onProgress) : undefined;
  },
  { op: 'hydrateProjectNamespaces', capture: 0 }
);
