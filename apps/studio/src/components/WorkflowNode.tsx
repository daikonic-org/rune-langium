// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { type TypeChipKind } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { DisclosureButton } from '@rune-langium/design-system/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { ArrowUpRight, Maximize2, Minimize2, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { FormPreviewPanel } from './FormPreviewPanel.js';
import { useFormPresentationState } from './FormPresentation.js';
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
    onClear,
    undoScope,
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
    onClear?(): () => void;
    /** Stable owner identity; ordinary input edits keep the same scope. */
    undoScope?: unknown;
    validationRoot?: RefObject<HTMLElement | null>;
  }) {
    const navigation = useWorkflowTypeNavigation(typeNodeId);
    const root = useRef<HTMLElement>(null);
    const [requestedEditing, setEditing] = useState(false);
    const [dataOpen, setDataOpen] = useState(true);
    const fieldsId = useId();
    const fieldsRef = useRef<HTMLDivElement>(null);
    const [fieldsExpanded, setFieldsExpanded] = useState(false);
    const [fieldsOverflow, setFieldsOverflow] = useState(false);
    const [beforeClear, setBeforeClear] = useState<{ restore(): void }>();
    const conditionIssue = validation?.diagnostics.find((diagnostic) => diagnostic.conditionName);
    useEffect(() => setBeforeClear(undefined), [schema?.targetId, sourceId, sourcePath, undoScope]);
    const { ready, entry, saveLabel } = useFormPresentationState();
    const editing = ready && requestedEditing;
    const showFields = kind !== 'output' || dataOpen;
    const fieldsMounted = Boolean(schema);
    useEffect(() => {
      const element = fieldsRef.current;
      if (!fieldsMounted || !showFields || !element || typeof ResizeObserver === 'undefined') return;
      const measure = () => setFieldsOverflow(element.scrollHeight > element.clientHeight + 1);
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      if (element.firstElementChild) observer.observe(element.firstElementChild);
      measure();
      return () => observer.disconnect();
    }, [fieldsMounted, showFields]);
    const fieldsLabel = kind === 'output' ? `${name} result fields` : `${name} fields`;
    const resizeLabel = fieldsExpanded ? `Restore ${name} fields height` : `Expand ${name} fields`;
    const ResizeIcon = fieldsExpanded ? Minimize2 : Maximize2;
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
          {schema && showFields && (fieldsOverflow || fieldsExpanded) && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={resizeLabel}
              aria-controls={fieldsId}
              aria-pressed={fieldsExpanded}
              title={resizeLabel}
              onClick={() => setFieldsExpanded((expanded) => !expanded)}
            >
              <ResizeIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          {schema ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              aria-label={`${name}: ${editing ? 'Finish editing layout' : 'Edit layout'}`}
              title={editing ? 'Finish editing layout' : 'Edit layout'}
              aria-pressed={editing}
              disabled={!ready || (editing && entry?.saving)}
              onClick={() => {
                if (!editing) setDataOpen(true);
                setEditing(!editing);
              }}
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
                    typeFqn={
                      typeNodeId ??
                      (schema ? `${schema.targetId}${schema.kind === 'function' ? '#RosettaFunction' : ''}` : undefined)
                    }
                    onImport={(items) => {
                      const value = items[0];
                      if (onImport) {
                        onImport(value);
                        setBeforeClear(undefined);
                        return;
                      }
                      if (!value || typeof value !== 'object' || Array.isArray(value))
                        throw new Error('Import an object for this input.');
                      onChange(value as Record<string, unknown>);
                      setBeforeClear(undefined);
                    }}
                  />
                ) : null}
                {onClear ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setBeforeClear({ restore: onClear() });
                    }}
                  >
                    Clear input
                  </Button>
                ) : null}
                {onBind ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setBeforeClear(undefined);
                      onBind();
                    }}
                  >
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
            <span role="status">{saveLabel}</span>
            <Button size="xs" variant="outline" disabled={entry?.saving} onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
        ) : null}
        {beforeClear && onChange ? (
          <p className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
            Input cleared.
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                beforeClear.restore();
                setBeforeClear(undefined);
              }}
            >
              Undo clear
            </Button>
          </p>
        ) : null}
        {conditionIssue && validation ? (
          <div className="flex items-start gap-1 px-2 py-1 text-xs text-destructive">
            <p className="min-w-0 flex-1">
              {conditionIssue.conditionDescription ?? `${conditionIssue.conditionName} is not satisfied.`}
            </p>
            <WorkflowValidation
              name={name}
              validation={validation}
              root={validationRoot ?? root}
              functionChecks={kind === 'function'}
              appearance="details"
            />
          </div>
        ) : null}
        {schema && kind === 'output' && (
          <h3 className="px-2 pt-1">
            <DisclosureButton
              aria-expanded={showFields}
              aria-controls={fieldsId}
              className="font-medium"
              onClick={() => setDataOpen((open) => !open)}
            >
              Result data
            </DisclosureButton>
          </h3>
        )}
        {schema ? (
          <div
            id={fieldsId}
            ref={fieldsRef}
            data-expanded={fieldsExpanded || undefined}
            hidden={!showFields}
            className="workflow-node__fields studio-scroll"
            role="group"
            aria-label={`Scroll ${fieldsLabel}`}
            tabIndex={0}
          >
            <FormPreviewPanel
              ariaLabel={fieldsLabel}
              schema={schema}
              status={{ state: 'ready', targetId: schema.targetId }}
              values={values}
              onValuesChange={
                onChange
                  ? (value) => {
                      setBeforeClear(undefined);
                      onChange(value);
                    }
                  : undefined
              }
              errors={Object.fromEntries(
                validation?.diagnostics.filter((d) => !d.conditionName).map((d) => [d.path, d.message]) ?? []
              )}
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
          </div>
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
