// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { withInstrumentation } from './instrumentation/core.js';
/** Route the existing namespace queue to the active verified project, never the moving server mirror. */
type Hydrator = (namespaces: readonly string[]) => Promise<void>;
const owners = new Map<string, Hydrator>();
export const registerProjectNamespaceHydrator = withInstrumentation(
  function registerProjectNamespaceHydrator(workspace: string, hydrate: Hydrator) {
    owners.set(workspace, hydrate);
    return () => {
      if (owners.get(workspace) === hydrate) owners.delete(workspace);
    };
  },
  { op: 'registerProjectNamespaceHydrator', capture: 0 }
);
export const hydrateProjectNamespaces = withInstrumentation(
  function hydrateProjectNamespaces(workspace: string | undefined, namespaces: readonly string[]) {
    return workspace ? owners.get(workspace)?.(namespaces) : undefined;
  },
  { op: 'hydrateProjectNamespaces', capture: 0 }
);
