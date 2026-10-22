// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { TypeChip, type TypeChipKind } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { FormPreviewPanel } from './FormPreviewPanel.js';
import { WorkflowValidation } from './WorkflowValidation.js';
import type { WorkflowValidation as Validation } from '../services/workflow-validation.js';
import { WorkflowImport } from './WorkflowImport.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkflowNode = withInstrumentation(
  function WorkflowNode({
    name,
    type,
    typeKind,
    schema,
    values,
    onChange,
    validation,
    actions,
    source,
    sourceId,
    kind = 'input',
    children,
    parentPath,
    readOnly = false,
    onBind,
    onImport,
    validationRoot
  }: {
    name: string;
    type?: string;
    typeKind?: TypeChipKind;
    schema?: FormPreviewSchema;
    values: Record<string, unknown>;
    onChange?(value: Record<string, unknown>): void;
    validation?: Validation;
    actions?: ReactNode;
    sourceId?: string;
    source?: string;
    kind?: 'input' | 'function' | 'output';
    children?: ReactNode;
    parentPath?: string;
    readOnly?: boolean;
    onBind?(): void;
    onImport?(value: Record<string, unknown>): void;
    validationRoot?: RefObject<HTMLElement | null>;
  }) {
    const root = useRef<HTMLElement>(null);
    const [editing, setEditing] = useState(false);
    return (
      <section
        ref={root}
        aria-label={`${name} ${kind}`}
        className={`workflow-node workflow-node--${kind}`}
        data-workflow-node={name}
        data-workflow-source={sourceId}
        data-type-kind={typeKind ?? (schema?.kind === 'choice' ? 'Choice' : 'Data')}
      >
        <header>
          <h2>{name}</h2>
          {type ? (
            <TypeChip
              as="span"
              typeName={type}
              typeKind={typeKind ?? (schema?.kind === 'choice' ? 'Choice' : 'Data')}
              className="workflow-node__type"
            />
          ) : null}
          {validation ? (
            <WorkflowValidation
              name={name}
              validation={validation}
              root={validationRoot ?? root}
              functionChecks={kind === 'function'}
            />
          ) : null}
          {actions}
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${name} node actions`} />}>
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent className="w-52 space-y-1 p-1" align="end">
              <Button
                variant="ghost"
                size="xs"
                className="w-full justify-start"
                aria-pressed={editing}
                onClick={() => setEditing(!editing)}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                {editing ? 'Finish editing layout' : 'Edit layout'}
              </Button>
              {onChange ? (
                <WorkflowImport
                  typeFqn={schema?.targetId}
                  onImport={(items) => {
                    const value = items[0];
                    if (!value || typeof value !== 'object' || Array.isArray(value))
                      throw new Error('Import an object for this input.');
                    (onImport ?? onChange)(value as Record<string, unknown>);
                  }}
                />
              ) : null}
              {onBind ? (
                <Button variant="ghost" size="xs" onClick={onBind}>
                  Use stored object…
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
        </header>
        {source ? <p className="workflow-node__source">{source}</p> : null}
        {editing ? (
          <div className="workflow-node__layout">
            <span>Editing this node’s layout</span>
            <Button size="xs" variant="outline" onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
        ) : null}
        {schema && (!readOnly || editing) ? (
          <FormPreviewPanel
            ariaLabel={`${name} fields`}
            schema={schema}
            status={{ state: 'ready', targetId: schema.targetId }}
            values={values}
            onValuesChange={onChange}
            errors={Object.fromEntries(validation?.diagnostics.map((d) => [d.path, d.message]) ?? [])}
            valid={validation?.state === 'valid'}
            validated={validation?.state === 'valid' || validation?.state === 'invalid'}
            layoutEditing={editing}
            layoutParentPath={parentPath}
            presentation={{
              mode: 'instance',
              showHeader: false,
              showPayload: false,
              showLayoutToolbar: false,
              showStatusSummary: false,
              showExecutionControls: false,
              readOnly
            }}
          />
        ) : null}
        {children}
      </section>
    );
  },
  {
    op: 'WorkflowNode',
    sanitize: () => '[workflow]',
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
