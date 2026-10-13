// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * OtherForm — Read-only fallback form for type kinds that do not yet have a
 * dedicated editor form (record, basicType, annotation) as well as the
 * default renderer used when a node is read-only (e.g. curated reference-only
 * entries).
 *
 * Shows detailed information about the currently selected type node
 * using shadcn/ui primitives and lucide-react icons.
 */

import { useInspectorSelection } from '../forms/metadata/useInspectorSelection.js';
import { readAtMetadataPath } from '../../store/metadata-target.js';
import { MetadataSection } from '../editors/MetadataSection.js';
import { AnnotationSection } from '../editors/AnnotationSection.js';
import { getMetadataItems } from '../../store/metadata-ops.js';
import { InspectorFrame } from '../editors/inspector/InspectorFrame.js';
import { InspectorFooter } from '../editors/inspector/InspectorFooter.js';
import { InspectorDetailsPane } from '../editors/inspector/InspectorDetailsPane.js';
import { InspectorInheritanceField } from '../editors/inspector/InspectorInheritanceField.js';
import { InspectorMemberSummary } from '../editors/inspector/InspectorMemberSummary.js';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { resolveNodeKind, formatCardinality, getTypeRefText, getRefText } from '../../adapters/model-helpers.js';
import { TypeHeader, INSPECTOR_FORM_CLASS } from '../TypeHeader.js';
import type { AnyGraphNode, GraphNodeMeta, NavigateToNodeCallback, TypeKind } from '../../types.js';

export interface OtherFormProps {
  nodeData: AnyGraphNode | null;
  /**
   * UI/editor metadata for the node (namespace, errors, ...). Required —
   * `nodeData` is the pure domain payload and no longer carries any UI
   * metadata (Phase 3 step 3).
   */
  meta: GraphNodeMeta;
  /** Graph node id of the displayed type — enables the header "Reveal in graph" action. */
  nodeId?: string | null;
  /** Callback to navigate to a type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph node IDs for resolving type name to node ID. */
  allNodeIds?: string[];
  /**
   * True when the node's source file is a curated reference-only entry
   * (no client-side source text). Renders a "Reference Only" pill next
   * to the kind badge so users understand why the panel is non-editable.
   */
  refOnly?: boolean;
}

/** Extract a flat list of {name, typeName, cardinality} from any node type. */
function extractMembers(d: any): Array<{ name: string; typeName?: string; cardinality?: string }> {
  const kind = resolveNodeKind(d);
  switch (kind) {
    case 'data':
    case 'annotation':
      return (d.attributes ?? []).map((a: any) => ({
        name: a.name ?? '',
        typeName: getTypeRefText(a.typeCall),
        cardinality: formatCardinality(a.card)
      }));
    case 'enum':
      return (d.enumValues ?? []).map((v: any) => ({
        name: v.name ?? '',
        typeName: undefined,
        cardinality: undefined
      }));
    case 'choice':
      return (d.attributes ?? []).map((o: any) => ({
        name: getTypeRefText(o.typeCall) ?? '',
        typeName: getTypeRefText(o.typeCall),
        cardinality: undefined
      }));
    case 'func':
      return (d.inputs ?? []).map((p: any) => ({
        name: p.name ?? '',
        typeName: getTypeRefText(p.typeCall),
        cardinality: formatCardinality(p.card)
      }));
    case 'record':
      return (d.features ?? []).map((f: any) => ({
        name: f.name ?? '',
        typeName: getTypeRefText(f.typeCall),
        cardinality: formatCardinality(f.card)
      }));
    default:
      return [];
  }
}

function ReadonlyInspector({
  nodeData,
  meta: nodeMeta,
  nodeId,
  onNavigateToNode,
  allNodeIds,
  refOnly
}: OtherFormProps & { nodeData: AnyGraphNode }) {
  const d = nodeData as any;
  const kind = resolveNodeKind(d);
  // Parent-name: read the inheritance ref directly off the AST node. The
  // generated `toDomain(d).extends` normalization is intentionally NOT used
  // here. OtherForm renders curated `refOnly` entries whose `$type` values
  // fall outside the editable union; `toDomain` throws `Unknown node type: …`
  // on an unrecognized `$type`, which the FormErrorBoundary would surface as
  // "Failed to render editor form" — exactly on the nodes this form exists
  // to render. The direct chain returns `undefined` gracefully and is O(1)
  // (no deep projection of the whole node for a single optional scalar). The
  // `extends`-normalization dogfooding belongs on bulk surfaces, not this
  // per-render single-field read.
  const parentName = getRefText(d.superType) ?? getRefText(d.parent) ?? getRefText(d.superFunction);
  const members = extractMembers(d);

  const collection =
    nodeData.$type === 'RosettaEnumeration'
      ? 'enumValues'
      : nodeData.$type === 'RosettaFunction'
        ? 'inputs'
        : 'attributes';
  const rows = members.map((member, index) => ({
    key: `member:${index}`,
    name: member.name,
    inherited: true,
    readonlyNode: readAtMetadataPath(nodeData, [collection, index])
  }));
  const selection = useInspectorSelection(nodeId ?? nodeData.name, rows);
  const selected = selection.selectedRow;
  return (
    <div className={INSPECTOR_FORM_CLASS} data-slot="other-form">
      <InspectorFrame
        header={
          <TypeHeader
            kind={kind as TypeKind}
            namespace={nodeMeta.namespace}
            name={d.name}
            className="-mx-4 -mt-4"
            onReveal={onNavigateToNode && nodeId ? () => onNavigateToNode(nodeId) : undefined}
            trailing={
              refOnly ? (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Reference Only
                </Badge>
              ) : undefined
            }
          />
        }
        inheritance={
          parentName ? (
            <InspectorInheritanceField
              value={null}
              displayName={parentName}
              options={[]}
              onSelect={() => {}}
              disabled
              onNavigateToNode={onNavigateToNode}
              allNodeIds={allNodeIds}
            />
          ) : undefined
        }
        sections={[
          {
            id: 'members',
            label: 'Members',
            members: true,
            content: (
              <>
                <div role="list" className="space-y-1">
                  {members.map((member, index) => (
                    <InspectorMemberSummary
                      key={rows[index]!.key}
                      name={member.name}
                      typeName={member.typeName}
                      cardinality={member.cardinality}
                      selected={selected?.key === rows[index]!.key}
                      onSelect={() => selection.select(rows[index]!.key)}
                      onNavigateToNode={onNavigateToNode}
                      allNodeIds={allNodeIds}
                    />
                  ))}
                </div>
                <MetadataSection readonlyNode={nodeData} />
                <AnnotationSection annotations={[...getMetadataItems(nodeData, 'annotations')]} readOnly />
              </>
            )
          }
        ]}
        details={
          <InspectorDetailsPane targetName={selected?.name} onClear={selection.clear}>
            {selected?.readonlyNode ? (
              <>
                <MetadataSection readonlyNode={selected.readonlyNode} />
                <AnnotationSection annotations={[...getMetadataItems(selected.readonlyNode, 'annotations')]} readOnly />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Structured metadata is unavailable for this member.</p>
            )}
          </InspectorDetailsPane>
        }
        footer={<InspectorFooter errors={nodeMeta.errors} readOnly />}
      />
    </div>
  );
}

export function OtherForm(props: OtherFormProps) {
  return props.nodeData ? <ReadonlyInspector {...props} nodeData={props.nodeData} /> : null;
}
