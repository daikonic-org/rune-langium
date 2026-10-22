// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from '../services/instrumentation/core.js';
import { TypeChip, useTypeNavigationMenu, type TypeChipKind } from '@rune-langium/visual-editor';
import { useExploreNavigationStore } from '../services/explore-navigation.js';
import { viewPrototypeType } from '../services/prototype-navigation.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';

export const useWorkflowTypeNavigation = withInstrumentation(
  function useWorkflowTypeNavigation(nodeId?: string) {
    const workspace = useWorkspaceOptional();
    const bridge = useExploreNavigationStore((state) => state.navigateToType);
    const navigate =
      workspace?.workspaceId && bridge && nodeId
        ? () => viewPrototypeType(workspace.workspaceId!, workspace.workspaceEpoch, nodeId)
        : undefined;
    const menu = useTypeNavigationMenu({ onNavigate: navigate });
    return { ...menu, navigate };
  },
  { op: 'useWorkflowTypeNavigation', capture: 0 }
);

export const WorkflowTypeLink = withInstrumentation(
  function WorkflowTypeLink({
    nodeId,
    name,
    kind,
    className
  }: {
    nodeId?: string;
    name: string;
    kind: TypeChipKind;
    className?: string;
  }) {
    const navigation = useWorkflowTypeNavigation(nodeId);
    return (
      <>
        <TypeChip
          as={navigation.navigate ? 'button' : 'span'}
          typeName={name}
          typeKind={kind}
          className={className}
          aria-label={navigation.navigate ? `View ${name} in Explore` : undefined}
          onClick={navigation.navigate}
          onContextMenu={(event) => navigation.open(event, nodeId)}
          onKeyDown={(event) => navigation.onKeyDown(event, nodeId)}
        />
        {navigation.menu}
      </>
    );
  },
  { op: 'WorkflowTypeLink', capture: 0 }
);
