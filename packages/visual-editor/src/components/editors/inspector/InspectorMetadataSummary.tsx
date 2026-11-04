// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { Badge } from '@rune-langium/design-system/ui/badge';
import { annotationsToDisplay } from '../../../adapters/model-helpers.js';
import { useMetadataTarget } from '../../forms/metadata/MetadataTargetContext.js';
import { getMetadataItems } from '../../../store/metadata-ops.js';

const descriptions: Record<string, string> = {
  key: 'This type carries an identity key.',
  reference: 'This field can reference a keyed object.',
  scheme: 'This field carries a value and its identifying scheme.',
  address: 'This field identifies an addressable location.'
};

/** Surface semantics-bearing annotations without creating another metadata owner. */
export function InspectorMetadataSummary() {
  const target = useMetadataTarget();
  if (!target) return null;
  const metadata = annotationsToDisplay(
    getMetadataItems(target.node, 'annotations').filter((item) => item.$type === 'AnnotationRef')
  ).filter((annotation) => annotation.name.split('.').at(-1) === 'metadata');
  if (!metadata.length) return null;
  return (
    <div
      data-slot="inspector-metadata-summary"
      className="flex flex-wrap gap-1 py-1"
      role="group"
      aria-label="Metadata semantics"
    >
      {metadata.map((annotation, index) => (
        <Badge
          key={index}
          variant="annotation"
          title={descriptions[annotation.attribute ?? ''] ?? 'Rune metadata annotation'}
        >
          metadata{annotation.attribute ? ` ${annotation.attribute}` : ''}
        </Badge>
      ))}
    </div>
  );
}
