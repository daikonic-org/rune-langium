// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { InspectorDetailsPane } from './InspectorDetailsPane.js';
import { MetadataTargetProvider } from '../../forms/metadata/MetadataTargetContext.js';
import { EditorSections } from '../../forms/sections/EditorSections.js';
import type { useInspectorTargets } from '../../forms/metadata/useInspectorTargets.js';

export function InspectorMetadataDetails({ targets }: { targets: ReturnType<typeof useInspectorTargets> }) {
  const row = targets.selection.selectedRow;
  const type = targets.rootBinding.node.$type;
  const elementLabel =
    type === 'RosettaEnumeration'
      ? 'Member'
      : type === 'Choice'
        ? 'Option'
        : type === 'RosettaFunction'
          ? 'Input'
          : 'Attribute';
  return (
    <InspectorDetailsPane
      elementLabel={elementLabel}
      targetName={row?.name || (row ? 'Unnamed member' : undefined)}
      onClear={targets.selection.clear}
    >
      {row && (
        <MetadataTargetProvider value={targets.childBinding}>
          <div key={targets.selection.selectedKey}>
            {row.inherited && <p className="text-xs text-muted-foreground">Inherited member · read only</p>}
            <EditorSections names={['MetadataSection', 'AnnotationSection']} />
          </div>
        </MetadataTargetProvider>
      )}
    </InspectorDetailsPane>
  );
}
