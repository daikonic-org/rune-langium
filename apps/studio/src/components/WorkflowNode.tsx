// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { type TypeChipKind } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { ArrowUpRight, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { FormPreviewPanel } from './FormPreviewPanel.js';
import { FormPresentation, useFormPresentationState } from './FormPresentation.js';
import { WorkflowValidation } from './WorkflowValidation.js';
import type { WorkflowValidation as Validation } from '../services/workflow-validation.js';
import { WorkflowTypeLink, useWorkflowTypeNavigation } from './WorkflowTypeLink.js';
import { WorkflowImport } from './WorkflowImport.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const WorkflowNode = withInstrumentation(
  function WorkflowNode({
    name,
    type,
    typeKind,
    typeNodeId,
    schema,
    values,
    onChange,
    validation,
    actions,
    source,
    sourceId,
    sourcePath,
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
    typeNodeId?: string;
    schema?: FormPreviewSchema;
    values: Record<string, unknown>;
    onChange?(value: Record<string, unknown>): void;
    validation?: Validation;
    actions?: ReactNode;
    sourceId?: string;
    sourcePath?: string;
    source?: string;
    kind?: 'input' | 'function' | 'output';
    children?: ReactNode;
    parentPath?: string;
    readOnly?: boolean;
    onBind?(): void;
    onImport?(value: unknown): void;
    validationRoot?: RefObject<HTMLElement | null>;
  }) {
    const navigation = useWorkflowTypeNavigation(typeNodeId);
    const root = useRef<HTMLElement>(null);
    const [requestedEditing, setEditing] = useState(false);
    const { ready } = useFormPresentationState();
    const editing = ready && requestedEditing;
    return (
      <section
        ref={root}
        aria-label={`${name} ${kind}`}
        className={`workflow-node studio-card workflow-node--${kind}`}
        data-workflow-node={name}
        data-workflow-source={sourceId}
        data-workflow-source-path={sourcePath}
        data-type-kind={typeKind ?? (schema?.kind === 'choice' ? 'Choice' : 'Data')}
      >
        <header
          onContextMenu={(event) => navigation.open(event, typeNodeId)}
          onKeyDown={(event) => navigation.onKeyDown(event, typeNodeId)}
        >
          <h2>{name}</h2>
          {type ? (
            <WorkflowTypeLink
              nodeId={typeNodeId}
              name={type}
              kind={typeKind ?? (schema?.kind === 'choice' ? 'Choice' : 'Data')}
              className="workflow-node__type"
            />
          ) : null}
          {!type && navigation.navigate ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={navigation.navigate}
              aria-label={`View ${name} in Explore`}
              title="View in Explore"
            >
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
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
          {schema ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              aria-label={`${name}: ${editing ? 'Finish editing layout' : 'Edit layout'}`}
              title={editing ? 'Finish editing layout' : 'Edit layout'}
              aria-pressed={editing}
              disabled={!ready}
              onClick={() => setEditing(!editing)}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          {onChange || onBind ? (
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${name} node actions`} />}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent className="w-52 space-y-1 p-1" align="end">
                {onChange ? (
                  <WorkflowImport
                    typeFqn={schema?.targetId}
                    onImport={(items) => {
                      const value = items[0];
                      if (onImport) {
                        onImport(value);
                        return;
                      }
                      if (!value || typeof value !== 'object' || Array.isArray(value))
                        throw new Error('Import an object for this input.');
                      onChange(value as Record<string, unknown>);
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
          ) : null}
        </header>
        {navigation.menu}
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
        ) : schema ? (
          <FormPresentation showToolbar={false}>{null}</FormPresentation>
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
