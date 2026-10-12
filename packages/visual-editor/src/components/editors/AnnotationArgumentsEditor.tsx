// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useRef } from 'react';
import { useFormContext, useFieldArray, useWatch } from 'react-hook-form';
import { EditorController } from '../forms/EditorFormProvider.js';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import { useMetadataTarget } from '../forms/metadata/MetadataTargetContext.js';
import { useInheritedMembers } from '../../hooks/useInheritedMembers.js';
import { Input } from '@rune-langium/design-system/ui/input';
import { Button } from '@rune-langium/design-system/ui/button';
import { SourceRefField } from './SourceRefField.js';
import { TypeReferenceField } from './TypeReferenceField.js';
import { getRefText } from '../../adapters/model-helpers.js';
import { qualifiedNameFromNodeId } from '../../store/node-projection.js';
import type { MetadataItem } from '../../store/metadata-target.js';
import { getMetadataItems } from '../../store/metadata-ops.js';
import type { TypeGraphNode, SourceRefOption } from '../../types.js';

const EMPTY_NODES: TypeGraphNode[] = [];

function QualifierPathField({
  prefix,
  nodes,
  onCommit
}: {
  prefix: string;
  nodes: TypeGraphNode[];
  onCommit: () => void;
}) {
  const { control, getValues, setValue, setError, clearErrors } = useFormContext();
  const path = `${prefix}.qualPath`;
  const reference = useWatch({ control, name: `${path}.receiver.data.$refText` });
  const matching = nodes.filter(
    (node) =>
      node.data.$type === 'Data' && (qualifiedNameFromNodeId(node.id) === reference || node.data.name === reference)
  );
  const target = matching.length === 1 ? matching[0] : undefined;
  const inherited = useInheritedMembers(target?.data ?? null, nodes);
  const own = target?.data.$type === 'Data' ? target.data.attributes : [];
  const inheritedNames = inherited
    .flatMap((group) => group.members)
    .map((member) =>
      member && typeof member === 'object' && 'name' in member && typeof member.name === 'string'
        ? member.name
        : undefined
    )
    .filter((name): name is string => name !== undefined);
  const options: SourceRefOption[] = [...new Set([...own.map((member) => member.name), ...inheritedNames])].map(
    (name) => ({ value: name, label: name })
  );
  return (
    <div className="space-y-1">
      <TypeReferenceField
        value={target?.id ?? null}
        displayName={typeof reference === 'string' ? reference : undefined}
        options={nodes
          .filter((node) => node.data.$type === 'Data')
          .map((node) => ({ value: node.id, label: node.data.name, kind: 'data', namespace: node.meta.namespace }))}
        filterKinds={['data']}
        placeholder="Choose receiver type…"
        onSelect={(id) => {
          setValue(
            path,
            id
              ? {
                  $type: 'RosettaAttributeReference',
                  receiver: { $type: 'RosettaDataReference', data: { $refText: qualifiedNameFromNodeId(id) } }
                }
              : undefined,
            { shouldDirty: true }
          );
          setError(path, { type: 'incomplete', message: 'Choose an attribute for this path.' });
        }}
      />
      <EditorController
        control={control}
        name={`${path}.attribute`}
        shouldUnregister={false}
        render={({ field }) => (
          <SourceRefField
            value={getRefText(field.value) ?? null}
            options={options}
            disabled={!target}
            placeholder="Choose path attribute…"
            onSelect={(name) => {
              field.onChange(name ? { $refText: name } : undefined);
              if (name) {
                clearErrors(path);
                onCommit();
              }
            }}
          />
        )}
      />
      {target?.meta.deferred && (
        <p className="text-xs text-muted-foreground">Load this type in Explorer to choose its attribute.</p>
      )}
      {!getValues(path) && <p className="text-xs text-muted-foreground">Choose a receiver and its attribute.</p>}
    </div>
  );
}

/** Argument fields remain in the declaration's RHF state; expected item identity guards replacement. */
export function AnnotationArgumentsEditor({
  prefix,
  index,
  expected
}: {
  prefix: string;
  index: number;
  expected: MetadataItem;
}) {
  const { control, getValues, setValue, setError } = useFormContext();
  const ctx = useEditorActionsContext();
  const binding = useMetadataTarget();
  const lease = useRef(expected);
  const nodes = ctx?.allNodes ?? EMPTY_NODES;
  const itemPath = `${prefix}.${index}`;
  const { fields, append, remove } = useFieldArray({
    control,
    name: `${itemPath}.qualifiers`,
    shouldUnregister: false
  });
  const attribute = useWatch({ control, name: `${itemPath}.attribute.$refText` });
  const paths = useWatch({ control, name: `${itemPath}.qualifiers` }) ?? [];
  const annotationName = expected.$type === 'AnnotationRef' ? expected.annotation.$refText : undefined;
  const candidates = nodes.filter((node) => node.data.$type === 'Annotation' && node.data.name === annotationName);
  const definition =
    candidates.length === 1 && candidates[0]?.data.$type === 'Annotation' ? candidates[0].data : undefined;
  const attributeOptions =
    definition?.attributes.map((attribute) => ({ value: attribute.name, label: attribute.name })) ?? [];
  const commit = () => {
    if (!binding) return;
    const value = getValues(itemPath) as MetadataItem;
    const result = binding.commit({ kind: 'replace', field: 'annotations', index, expected: lease.current, value });
    if (result.status === 'committed') {
      const node = binding.currentNode();
      const item = node && getMetadataItems(node, 'annotations')[index];
      if (item) lease.current = item;
    }
    if (result.status !== 'committed')
      setError(itemPath, {
        type: 'commit',
        message:
          result.status === 'invalid'
            ? result.issues[0]?.message
            : 'This annotation changed before the edit could be saved.'
      });
  };
  return (
    <div className="space-y-2 rounded border border-border p-2" aria-label="Annotation arguments">
      <div role="group" aria-label="Annotation attribute" className="space-y-1">
        <span className="text-xs text-muted-foreground">Attribute</span>
        <EditorController
          control={control}
          name={`${itemPath}.attribute`}
          shouldUnregister={false}
          render={({ field }) => (
            <SourceRefField
              value={getRefText(field.value) ?? null}
              options={attributeOptions}
              disabled={!definition}
              placeholder="Choose annotation attribute…"
              onSelect={(value) => {
                field.onChange(value ? { $refText: value } : undefined);
                commit();
              }}
            />
          )}
        />
        {!definition && <p className="text-xs text-muted-foreground">Annotation scope unavailable.</p>}
        {attribute && fields.length === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(`${itemPath}.attribute`, undefined, { shouldDirty: true });
              commit();
            }}
          >
            Clear attribute
          </Button>
        )}
      </div>
      {fields.map((row, qualifierIndex) => {
        const name = `${itemPath}.qualifiers.${qualifierIndex}`;
        return (
          <div key={row.id} className="space-y-1 rounded border border-border p-2">
            <EditorController
              control={control}
              name={`${name}.qualName`}
              shouldUnregister={false}
              render={({ field }) => (
                <Input
                  {...field}
                  value={field.value ?? ''}
                  aria-label={`Qualifier ${qualifierIndex + 1} name`}
                  onBlur={() => {
                    field.onBlur();
                    commit();
                  }}
                />
              )}
            />
            <label className="flex items-center gap-2 text-xs">
              Value kind
              <select
                value={paths[qualifierIndex]?.qualPath ? 'path' : 'value'}
                onChange={(event) => {
                  setValue(`${name}.qualValue`, event.target.value === 'value' ? '' : undefined, { shouldDirty: true });
                  setValue(
                    `${name}.qualPath`,
                    event.target.value === 'path'
                      ? {
                          $type: 'RosettaAttributeReference',
                          receiver: { $type: 'RosettaDataReference', data: { $refText: '' } }
                        }
                      : undefined,
                    { shouldDirty: true }
                  );
                  if (event.target.value === 'value') commit();
                }}
              >
                <option value="value">Text</option>
                <option value="path">Attribute path</option>
              </select>
            </label>
            {paths[qualifierIndex]?.qualPath ? (
              <QualifierPathField prefix={name} nodes={nodes} onCommit={commit} />
            ) : (
              <EditorController
                control={control}
                name={`${name}.qualValue`}
                shouldUnregister={false}
                render={({ field }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    aria-label={`Qualifier ${qualifierIndex + 1} value`}
                    onBlur={() => {
                      field.onBlur();
                      commit();
                    }}
                  />
                )}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                remove(qualifierIndex);
                commit();
              }}
            >
              Remove qualifier
            </Button>
          </div>
        );
      })}
      {attribute && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            append({ $type: 'AnnotationQualifier', qualName: '', qualValue: '' });
            commit();
          }}
        >
          Add qualifier
        </Button>
      )}
    </div>
  );
}
