// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { NamespaceExplorerPanel, type NamespaceExplorerPanelProps } from '@rune-langium/visual-editor';
import { useNamespaceArrivals } from '../hooks/useChangeFeedback.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const StudioNamespaceExplorer = withInstrumentation(
  function StudioNamespaceExplorer(props: Omit<NamespaceExplorerPanelProps, 'arrivingNamespaces'>) {
    const arrivingNamespaces = useNamespaceArrivals(props.nodeRepository);
    return <NamespaceExplorerPanel {...props} arrivingNamespaces={arrivingNamespaces} />;
  },
  { op: 'StudioNamespaceExplorer', capture: 0 }
);
