// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { PrototypeWorkflow } from './PrototypeWorkflow.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface InstanceInspectorPanelProps {
  instanceId?: string;
  bindingRequestId?: number;
  onNewInstance?(): void;
  focusedPayloadPointer?: string;
  focusRequestId?: number;
}
export const InstanceInspectorPanel = withInstrumentation(
  function InstanceInspectorPanel(props: InstanceInspectorPanelProps) {
    return <PrototypeWorkflow {...props} />;
  },
  {
    op: 'InstanceInspectorPanel',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
