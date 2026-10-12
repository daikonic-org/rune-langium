// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useState, useId } from 'react';
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
import type { SourceRefOption } from '../../types.js';

export interface MetadataSectionProps {
  readOnly?: boolean;
  onDefinitionCommit?: (definition: string) => void;
  onCommentsCommit?: (comments: string) => void;
  onSynonymAdd?: (source: string, value?: string) => void;
  onSynonymRemove?: (index: number) => void;
  synonymSourceOptions?: SourceRefOption[];
  includeComments?: boolean;
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
  const { control, setError } = useFormContext();
  const id = useId();
  const save = useAutoSave<string | PendingMetadata>((pending) => {
    if (typeof pending === 'string') {
      if (!readOnly) onCommit?.(pending);
      return;
    }
    const result = binding?.commitPending(pending);
    if (result?.status !== 'committed')
      setError(name, { type: 'commit', message: 'This item changed before the edit could be saved.' });
  });
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
                  binding
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
                  binding ? binding.envelope({ kind: 'definition', value: event.target.value }) : event.target.value
                );
              }}
              className="w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
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
export function MetadataSection(props: MetadataSectionProps): React.ReactNode {
  const { getValues } = useFormContext();
  const ctx = useEditorActionsContext();
  const binding = useMetadataTarget();
  const [expanded, setExpanded] = useState(true);
  const readOnly = Boolean(props.readOnly || ctx?.readOnly || binding?.readOnly);
  const prefix = binding?.formPrefix;
  const path = (field: string) => [prefix, field].filter(Boolean).join('.');
  const caps = binding?.capabilities;
  const inherited = binding && prefix === undefined;
  const node = binding?.node;
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
          {(!caps || caps.definition) &&
            (inherited ? (
              <Field>
                <FieldLabel>Documentation</FieldLabel>
                <p className="whitespace-pre-wrap text-sm">
                  {node && 'definition' in node && typeof node.definition === 'string'
                    ? node.definition
                    : 'No documentation'}
                </p>
              </Field>
            ) : (
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
            ))}
          {caps?.display &&
            (inherited ? (
              <Field>
                <FieldLabel>Display name</FieldLabel>
                <p className="text-sm">
                  {node && 'display' in node && typeof node.display === 'string' ? node.display : 'No display name'}
                </p>
              </Field>
            ) : (
              <MetadataScalar
                name={path('display')}
                kind="display"
                label="Display name"
                slot="metadata-display"
                readOnly={readOnly}
                binding={binding}
              />
            ))}
          {(props.includeComments ?? !binding) && (
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
              readonlyNode={inherited ? node : undefined}
              onAdd={
                props.onSynonymAdd ??
                (!binding && ctx ? (source, value) => ctx.actions.addSynonym(ctx.nodeId, source, value) : undefined)
              }
              onRemove={
                props.onSynonymRemove ??
                (!binding && ctx ? (index) => ctx.actions.removeSynonym(ctx.nodeId, index) : undefined)
              }
            />
          )}
        </FieldGroup>
      )}
    </div>
  );
}
