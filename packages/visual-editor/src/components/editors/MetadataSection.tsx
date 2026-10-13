// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useState, useId, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { EditorController } from '../forms/EditorFormProvider.js';
import { Field, FieldLabel, FieldGroup } from '@rune-langium/design-system/ui/field';
import { Input } from '@rune-langium/design-system/ui/input';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import {
  useMetadataTarget,
  type PendingMetadata,
  type MetadataTargetBinding
} from '../forms/metadata/MetadataTargetContext.js';
import { SynonymEditor } from './SynonymEditor.js';
import { getMetadataCapabilities, type MetadataNode } from '../../store/metadata-target.js';
import type { SourceRefOption } from '../../types.js';

export interface MetadataSectionProps {
  readOnly?: boolean;
  onDefinitionCommit?: (definition: string) => void;
  onCommentsCommit?: (comments: string) => void;
  onSynonymAdd?: (source: string, value?: string) => void;
  onSynonymRemove?: (index: number) => void;
  synonymSourceOptions?: SourceRefOption[];
  includeComments?: boolean;
  readonlyNode?: MetadataNode;
  fields?: string[];
}

const EMPTY_SOURCES: SourceRefOption[] = [];

export function MetadataScalar({
  name,
  kind,
  label,
  slot,
  readOnly,
  binding,
  onCommit,
  inline = false
}: {
  name: string;
  kind: 'definition' | 'display' | 'comments';
  label: string;
  slot: string;
  readOnly: boolean;
  binding?: MetadataTargetBinding | null;
  onCommit?: (value: string) => void;
  inline?: boolean;
}) {
  const { control, setError, getFieldState } = useFormContext();
  const id = useId();
  const save = useAutoSave<string | PendingMetadata>((pending) => {
    if (typeof pending === 'string') {
      if (readOnly && !getFieldState(name).invalid) return false;
      if (!readOnly) onCommit?.(pending);
      return;
    }
    const result = binding?.commitPending(pending);
    if (result?.status === 'readOnly' && !getFieldState(name).invalid) return false;
    if (result?.status !== 'committed')
      setError(name, { type: 'commit', message: 'This item changed before the edit could be saved.' });
  });
  useEffect(() => {
    if (!readOnly) save.flush();
  }, [readOnly, save]);
  return (
    <EditorController
      control={control}
      name={name}
      shouldUnregister={false}
      render={({ field, fieldState }) => (
        <Field>
          {!inline && (
            <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
              {label}
            </FieldLabel>
          )}
          {kind === 'display' ? (
            <Input
              id={id}
              aria-label={label}
              placeholder={inline ? 'Display name (optional)' : undefined}
              variant={inline ? 'inline' : undefined}
              value={field.value ?? ''}
              disabled={readOnly}
              aria-invalid={fieldState.invalid}
              onBlur={field.onBlur}
              onChange={(event) => {
                field.onChange(event);
                save(
                  binding?.guarded
                    ? binding.envelope({ kind: 'display', value: event.target.value || undefined })
                    : event.target.value
                );
              }}
            />
          ) : (
            <textarea
              id={id}
              value={field.value ?? ''}
              disabled={readOnly}
              rows={2}
              aria-label={kind === 'definition' ? 'Definition' : label}
              aria-invalid={fieldState.invalid}
              data-slot={slot}
              onBlur={field.onBlur}
              onChange={(event) => {
                field.onChange(event);
                save(
                  binding?.guarded
                    ? binding.envelope({ kind: 'definition', value: event.target.value })
                    : event.target.value
                );
              }}
              className="w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          )}
          {fieldState.error && (
            <p role="alert" className="text-xs text-destructive">
              {fieldState.error.message}
            </p>
          )}
        </Field>
      )}
    />
  );
}

/** Shared schema-bound documentation/display controls and typed synonym binding. */
function FormMetadataSection(props: MetadataSectionProps): React.ReactNode {
  const { getValues } = useFormContext();
  const ctx = useEditorActionsContext();
  const binding = useMetadataTarget();
  const [expanded, setExpanded] = useState(true);
  const readOnly = Boolean(props.readOnly || ctx?.readOnly || binding?.readOnly);
  const prefix = binding?.formPrefix;
  const path = (field: string) => [prefix, field].filter(Boolean).join('.');
  const caps = binding?.capabilities;
  const kind = caps?.synonymKind ?? (getValues('$type') === 'RosettaEnumeration' ? 'body' : 'class');
  const sources = props.synonymSourceOptions ?? ctx?.synonymSourceOptions ?? EMPTY_SOURCES;
  return (
    <div data-slot="metadata-section" className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        <span>Metadata</span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <FieldGroup className="mt-2 gap-3">
          {(!caps || caps.definition) && (
            <MetadataScalar
              name={path('definition')}
              kind="definition"
              label="Documentation"
              slot="metadata-description"
              readOnly={readOnly}
              binding={binding}
              onCommit={
                props.onDefinitionCommit ??
                (ctx ? (value) => ctx.actions.updateDefinition(ctx.nodeId, value) : undefined)
              }
            />
          )}
          {caps?.display && (
            <MetadataScalar
              name={path('display')}
              kind="display"
              label="Display name"
              slot="metadata-display"
              readOnly={readOnly}
              binding={binding}
            />
          )}
          {(props.includeComments ?? !(binding || ctx?.sourceCommentsOnly)) && (
            <MetadataScalar
              name="comments"
              kind="comments"
              label="Comments"
              slot="metadata-comments"
              readOnly={readOnly}
              onCommit={
                props.onCommentsCommit ?? (ctx ? (value) => ctx.actions.updateComments(ctx.nodeId, value) : undefined)
              }
            />
          )}
          {(!caps || caps.synonymField) && (
            <SynonymEditor
              formPrefix={prefix}
              field={caps?.synonymField ?? 'synonyms'}
              kind={kind}
              nodeId={ctx?.nodeId}
              sourceOptions={sources}
              readOnly={readOnly}

              onAdd={
                props.onSynonymAdd ??
                (!binding?.guarded && ctx
                  ? (source, value) => ctx.actions.addSynonym(ctx.nodeId, source, value)
                  : undefined)
              }
              onRemove={
                props.onSynonymRemove ??
                (!binding?.guarded && ctx ? (index) => ctx.actions.removeSynonym(ctx.nodeId, index) : undefined)
              }
            />
          )}
        </FieldGroup>
      )}
    </div>
  );
}

function ReadonlyMetadataSection({
  node,
  sources = EMPTY_SOURCES
}: {
  node: MetadataNode;
  sources?: SourceRefOption[];
}) {
  const caps = getMetadataCapabilities(node);
  return (
    <div data-slot="metadata-section" className="space-y-3 border-t border-border pt-3">
      {caps.definition && (
        <Field>
          <FieldLabel>Documentation</FieldLabel>
          <p className="whitespace-pre-wrap text-sm">
            {'definition' in node && typeof node.definition === 'string' ? node.definition : 'No documentation'}
          </p>
        </Field>
      )}
      {caps.display && (
        <Field>
          <FieldLabel>Display name</FieldLabel>
          <p className="text-sm">
            {'display' in node && typeof node.display === 'string' ? node.display : 'No display name'}
          </p>
        </Field>
      )}
      {caps.synonymField && caps.synonymKind && (
        <SynonymEditor
          field={caps.synonymField}
          kind={caps.synonymKind}
          sourceOptions={sources}
          readonlyNode={node}
          readOnly
        />
      )}
    </div>
  );
}

/** Editable and inspection-only targets share the canonical construct capabilities. */
export function MetadataSection(props: MetadataSectionProps): React.ReactNode {
  const binding = useMetadataTarget();
  const readonlyNode = props.readonlyNode ?? (binding?.formPrefix === undefined ? binding?.node : undefined);
  return readonlyNode ? (
    <ReadonlyMetadataSection node={readonlyNode} sources={props.synonymSourceOptions} />
  ) : (
    <FormMetadataSection {...props} />
  );
}
