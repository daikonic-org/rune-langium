// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { MetadataItemPreview } from '../forms/metadata/MetadataItemPreview.js';
import { useEffect, useState } from 'react';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useFormContext, useWatch } from 'react-hook-form';
import { useMetadataItemCommit } from '../forms/metadata/useMetadataItemLease.js';
import { EditorController } from '../forms/EditorFormProvider.js';
import { Input } from '@rune-langium/design-system/ui/input';
import { SourceRefField } from './SourceRefField.js';
import { resolveSynonymRefText } from './synonym-ref.js';
import { createSynonymDraft, getMetadataItems, updateSynonymDraft } from '../../store/metadata-ops.js';
import { useMetadataTarget, type PendingMetadata } from '../forms/metadata/MetadataTargetContext.js';
import type { MetadataItem, MetadataNode } from '../../store/metadata-target.js';
import type { SourceRefOption } from '../../types.js';

interface SynonymEditorProps {
  formPrefix?: string;
  field: 'synonyms' | 'enumSynonyms';
  kind: 'class' | 'body' | 'enumValue';
  nodeId?: string;
  sourceOptions: SourceRefOption[];
  readOnly?: boolean;
  readonlyNode?: MetadataNode;
  onAdd?: (source: string, value?: string) => void;
  onRemove?: (index: number) => void;
}

type SynonymDisplay = {
  sources?: { $refText?: string }[];
  value?: { name?: string };
  body?: { values?: { name?: string }[] };
  synonymValue?: string;
};

function SynonymList({
  items,
  field,
  onRemove,
  onEdit
}: {
  items: readonly MetadataItem[];
  field: SynonymEditorProps['field'];
  onRemove?: (index: number) => void;
  onEdit?: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => {
        const readable = item as SynonymDisplay;
        const source =
          readable.sources
            ?.map((ref) => ref.$refText)
            .filter(Boolean)
            .join(', ') ?? '';
        const value =
          readable.value?.name ?? readable.body?.values?.map((value) => value.name).join(', ') ?? readable.synonymValue;
        return (
          <div
            key={`${source}:${index}`}
            className="flex flex-wrap items-center gap-1 rounded bg-card px-2 py-0.5 text-xs"
          >
            {value ? `${source} — ${value}` : source}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(index)}
                aria-label={`Edit synonym ${index + 1}`}
                className="text-muted-foreground"
              >
                Edit
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={field === 'enumSynonyms' ? `remove enum synonym ${source}` : 'remove synonym'}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            )}
            {!onEdit && !onRemove && <MetadataItemPreview item={item} label={`Synonym ${index + 1} details`} />}
          </div>
        );
      })}
    </div>
  );
}

function SynonymItemEditor({
  name,
  index,
  expected,
  props,
  onClose
}: {
  name: string;
  index: number;
  expected: MetadataItem;
  props: SynonymEditorProps;
  onClose: () => void;
}) {
  const { control } = useFormContext();
  const path = `${name}.${index}`;
  const commit = useMetadataItemCommit(props.field, index, expected, path);
  return (
    <EditorController
      control={control}
      name={path}
      shouldUnregister={false}
      render={({ field, fieldState }) => {
        const item = field.value as MetadataItem;
        const readable = item as SynonymDisplay;
        return (
          <fieldset
            disabled={props.readOnly}
            className="space-y-1 rounded border border-border p-2"
            aria-label="Synonym details"
          >
            <SourceRefField
              value={readable.sources?.[0]?.$refText ?? null}
              options={props.sourceOptions}
              onSelect={(source) => {
                if (source) {
                  field.onChange(
                    updateSynonymDraft(item, {
                      source: resolveSynonymRefText(
                        props.sourceOptions.find((option) => option.value === source),
                        props.nodeId,
                        source
                      )
                    })
                  );
                  commit();
                }
              }}
              placeholder="Choose synonym source…"
            />
            <Input
              aria-label="Synonym value"
              value={readable.value?.name ?? readable.body?.values?.[0]?.name ?? readable.synonymValue ?? ''}
              onChange={(event) => field.onChange(updateSynonymDraft(item, { value: event.target.value }))}
              onBlur={() => {
                field.onBlur();
                commit();
              }}
            />
            {fieldState.error && (
              <p role="alert" className="text-xs text-destructive">
                {fieldState.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (commit() === false) return;
                onClose();
              }}
              className="text-xs"
            >
              Done
            </button>
          </fieldset>
        );
      }}
    />
  );
}

function EditableSynonyms(props: SynonymEditorProps) {
  const { control, getValues, setValue: setFormValue } = useFormContext();
  const binding = useMetadataTarget();
  const name = [props.formPrefix, props.field].filter(Boolean).join('.');
  const items = useWatch({ control, name, defaultValue: getValues(name) ?? [] }) as MetadataItem[];
  const [editing, setEditing] = useState<{ index: number; expected: MetadataItem }>();
  const [source, setSource] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [showControls, setShowControls] = useState(!props.readOnly);
  if (!props.readOnly && !showControls) setShowControls(true);
  const completeAdd = (entry: MetadataItem) => {
    setFormValue(name, [...(getValues(name) ?? []), entry], { shouldDirty: true });
    setSource(null);
    setValue('');
    setError(undefined);
    setAdding(false);
  };
  const saveAdd = useAutoSave<{ pending: PendingMetadata; entry: MetadataItem }>(({ pending, entry }) => {
    const result = binding?.commitPending(pending);
    if (result?.status === 'readOnly') return false;
    if (result?.status === 'committed') completeAdd(entry);
    else {
      setError('This synonym could not be saved.');
      setAdding(false);
    }
  });
  useEffect(() => {
    if (!props.readOnly) saveAdd.flush();
  }, [props.readOnly, saveAdd, binding?.node, binding?.commitBlocked]);
  const add = () => {
    if (props.readOnly || adding || !source) return;
    const option = props.sourceOptions.find((option) => option.value === source);
    const ref = resolveSynonymRefText(option, props.nodeId, source);
    const entry = createSynonymDraft(props.kind, ref, props.kind === 'class' ? undefined : value);
    if (!entry) return;
    if (props.onAdd) props.onAdd(ref, props.kind === 'class' ? undefined : value);
    else if (binding?.guarded) {
      setAdding(true);
      saveAdd({ pending: binding.envelope({ kind: 'append', field: props.field, value: entry }), entry });
      saveAdd.flush();
      return;
    }
    completeAdd(entry);
  };
  const deleteItem = (index: number) => {
    if (props.onRemove) props.onRemove(index);
    else if (binding?.guarded) {
      const expected = getMetadataItems(binding.node, props.field)[index];
      if (!expected) return;
      const result = binding.commit({ kind: 'remove', field: props.field, index, expected });
      if (result.status !== 'committed') {
        setError('This item changed before the synonym could be removed.');
        return;
      }
    }
    setFormValue(
      name,
      (getValues(name) ?? []).filter((_item: unknown, itemIndex: number) => itemIndex !== index),
      { shouldDirty: true }
    );
  };
  return (
    <div className="space-y-1.5">
      <SynonymList
        items={items ?? []}
        field={props.field}
        onRemove={props.readOnly ? undefined : deleteItem}
        onEdit={
          !props.readOnly && binding?.guarded
            ? (index) => {
                const expected = getMetadataItems(binding.node, props.field)[index];
                if (expected) setEditing({ index, expected });
              }
            : undefined
        }
      />
      {editing && (
        <SynonymItemEditor
          key={editing.index}
          name={name}
          index={editing.index}
          expected={editing.expected}
          props={props}
          onClose={() => setEditing(undefined)}
        />
      )}
      {showControls && (
        <fieldset disabled={props.readOnly || adding} className="min-w-0 flex flex-wrap items-center gap-1">
          <SourceRefField
            value={source}
            options={props.sourceOptions}
            onSelect={setSource}
            placeholder="Select source…"
          />
          {props.kind !== 'class' && (
            <Input
              variant="inline"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={props.kind === 'enumValue' ? 'Synonym value…' : 'Value name…'}
              aria-label="Synonym value"
              data-slot={props.kind === 'enumValue' ? 'enum-synonym-value-input' : 'synonym-value-input'}
              className="min-w-0 flex-1 px-2 py-1 text-xs"
            />
          )}
          <button
            type="button"
            onClick={add}
            disabled={!source || (props.kind !== 'class' && !value.trim())}
            className="rounded bg-card px-2 py-1 text-xs disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** One interaction for class, body and enum-value synonym representations. */
export function SynonymEditor(props: SynonymEditorProps) {
  return (
    <div data-slot={props.field === 'enumSynonyms' ? 'enum-value-synonyms' : 'synonym-editor'} className="space-y-1.5">
      <span className="text-xs text-muted-foreground">Synonyms</span>
      {props.readonlyNode ? (
        <SynonymList items={getMetadataItems(props.readonlyNode, props.field)} field={props.field} />
      ) : (
        <EditableSynonyms {...props} />
      )}
    </div>
  );
}
