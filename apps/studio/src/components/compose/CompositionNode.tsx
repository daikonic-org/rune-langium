// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { createContext, useContext, type DragEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { formatCardinality, parseCardinality } from '@rune-langium/visual-editor';
import type { CompositionStep } from '@rune-langium/core';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export interface CompositionVariable {
  id: string;
  name: string;
  reference: string;
  kind: 'input' | 'variable' | 'output' | 'local';
  producer: string;
  type?: string;
  cardinality?: string;
}
export interface NodeArgument {
  name: string;
  value: string;
  mode: 'variable' | 'value';
  variableId?: string;
  type?: string;
  cardinality: string;
}
export interface NodeBindingActions {
  owner: string;
  writable: boolean;
  busy: boolean;
  selectedVariable?: string;
  draftId?: string;
  adding: boolean;
  variableName: string;
  outputName?: string;
  outputTarget?: string;
  variables: CompositionVariable[];
  arguments(step: CompositionStep): NodeArgument[];
  expression(step: CompositionStep): string;
  select(step: CompositionStep): void;
  argument(step: CompositionStep, index: number, value: string, variableId?: string): void;
  argumentMode(step: CompositionStep, index: number, mode: 'variable' | 'value'): void;
  value(step: CompositionStep, value: string, variableId?: string): void;
  output(step: CompositionStep, variableId?: string): void;
  name(value: string): void;
  newOutput(step: CompositionStep, name: string): void;
  apply(): void;
  discard(): void;
}
export const NodeBindingContext = createContext<NodeBindingActions | null>(null);
export type ComposerNode = Node<{ step: CompositionStep; expression: string; vertical: boolean }, 'composition'>;
export const VARIABLE_MIME = 'application/x-rune-composition-variable';

function readVariable(event: DragEvent, actions: NodeBindingActions): string | undefined {
  if (!actions.writable || actions.busy) return;
  try {
    const value: unknown = JSON.parse(event.dataTransfer.getData(VARIABLE_MIME));
    if (
      value &&
      typeof value === 'object' &&
      'owner' in value &&
      value.owner === actions.owner &&
      'variable' in value &&
      typeof value.variable === 'string' &&
      actions.variables.some((variable) => variable.id === value.variable)
    )
      return value.variable;
  } catch {
    /* Other drag formats belong to their own palette. */
  }
  return undefined;
}

export const CompositionNode = withInstrumentation(
  function CompositionNode({ data, selected }: NodeProps<ComposerNode>) {
    const actions = useContext(NodeBindingContext);
    if (!actions) return null;
    const step = data.step;
    const editing = actions.draftId === step.id;
    const active = selected || editing;
    const disabled = !actions.writable || actions.busy;
    const inputs = actions.arguments(step);
    const variables = actions.variables.filter(
      (variable) => variable.kind !== 'output' && (variable.kind !== 'local' || variable.producer === step.id)
    );
    const produced = actions.variables.filter(
      (variable) => variable.producer === step.id && variable.kind !== 'local' && variable.kind !== 'output'
    );
    const chosen = variables.find((variable) => variable.id === actions.selectedVariable);
    const output = editing ? actions.variables.find((variable) => variable.id === actions.outputTarget) : undefined;
    const accept = (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(VARIABLE_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'link';
    };
    const bindInput = (event: DragEvent, index?: number) => {
      event.preventDefault();
      event.stopPropagation();
      const id = readVariable(event, actions);
      const variable = actions.variables.find((variable) => variable.id === id);
      if (!variable) return;
      if (index === undefined) actions.value(step, variable.reference, variable.id);
      else actions.argument(step, index, variable.reference, variable.id);
    };
    return (
      <div className="composition-node" data-composition-step={step.id} data-selected={active} data-kind={step.kind}>
        {step.kind !== 'input' && (
          <Handle id="input" type="target" position={data.vertical ? Position.Top : Position.Left} />
        )}
        <div className="composition-node__heading">
          <strong>
            {step.kind === 'return'
              ? 'Output'
              : step.kind === 'each'
                ? 'For each'
                : step.call
                  ? step.call.identity.split('.').pop()
                  : step.kind === 'input'
                    ? step.name
                    : 'Expression'}
          </strong>
          {step.kind !== 'return' && (
            <span className="composition-node__kind">
              {step.kind === 'input' ? 'Input' : step.call ? 'Function' : 'Value'}
            </span>
          )}
        </div>
        {step.kind === 'return' && step.call && (
          <span className="composition-node__summary" title={step.call.identity}>
            {step.call.identity.split('.').pop()}
          </span>
        )}
        {!!inputs.length && (
          <div className="composition-node__arguments nowheel">
            {inputs
              .map((argument, index) => ({ argument, index, card: parseCardinality(argument.cardinality) }))
              .sort((a, b) => Number(b.card.inf > 0) - Number(a.card.inf > 0))
              .map(({ argument, index, card }) => (
                <div
                  key={argument.name}
                  className="composition-node__argument nodrag nopan"
                  data-argument-index={index}
                  onDragOver={accept}
                  onDrop={(event) => bindInput(event, index)}
                >
                  <div className="composition-node__argument-label">
                    <span>
                      {argument.name}
                      {card.inf > 0 ? ' *' : ''}
                    </span>
                    <span className="composition-node__argument-type" title={argument.type}>
                      {argument.type}
                    </span>
                    <span>{formatCardinality(card)}</span>
                  </div>
                  {active ? (
                    <div className="composition-node__binding">
                      <select
                        aria-label={`${step.name} ${argument.name} binding mode`}
                        value={argument.mode}
                        disabled={disabled}
                        onChange={(event) =>
                          actions.argumentMode(step, index, event.target.value === 'variable' ? 'variable' : 'value')
                        }
                      >
                        <option value="variable">Variable</option>
                        <option value="value">Value</option>
                      </select>
                      {argument.mode === 'variable' ? (
                        <select
                          aria-label={`${step.name} argument ${argument.name}`}
                          aria-required={card.inf > 0}
                          disabled={disabled}
                          value={argument.variableId ?? ''}
                          onChange={(event) => {
                            const variable = variables.find((variable) => variable.id === event.target.value);
                            if (variable) actions.argument(step, index, variable.reference, variable.id);
                          }}
                        >
                          <option value="" disabled>
                            Choose variable
                          </option>
                          {variables.map((variable) => (
                            <option key={variable.id} value={variable.id}>
                              {variable.name}
                              {variable.kind === 'local' ? ' (scoped)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          aria-label={`${step.name} argument ${argument.name}`}
                          aria-required={card.inf > 0}
                          placeholder="Rune value or expression"
                          value={argument.value}
                          disabled={disabled}
                          onChange={(event) => actions.argument(step, index, event.target.value)}
                        />
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="composition-node__bound-value"
                      aria-label={`Edit ${step.name} argument ${argument.name}: ${argument.value || 'Bind variable or value'}`}
                      onClick={() => actions.select(step)}
                    >
                      {argument.value || 'Bind variable or value'}
                    </button>
                  )}
                  {active && chosen && (
                    <button
                      type="button"
                      className="composition-node__port-action"
                      aria-label={`Bind selected variable to ${step.name} ${argument.name}`}
                      disabled={disabled}
                      onClick={() => actions.argument(step, index, chosen.reference, chosen.id)}
                    >
                      Bind {chosen.name}
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
        {!inputs.length && step.kind !== 'input' && (
          <div
            className="composition-node__argument nodrag nopan"
            data-port-direction="input"
            onDragOver={accept}
            onDrop={(event) => bindInput(event)}
          >
            <div className="composition-node__argument-label">{step.kind === 'return' ? 'Value' : 'Expression'}</div>
            {active ? (
              <Input
                aria-label={`${step.name} expression`}
                placeholder="Variable, value or expression"
                value={actions.expression(step)}
                disabled={disabled}
                onChange={(event) => actions.value(step, event.target.value)}
              />
            ) : (
              <button type="button" className="composition-node__bound-value" onClick={() => actions.select(step)}>
                {actions.expression(step)}
              </button>
            )}
            {active && chosen && (
              <button
                type="button"
                className="composition-node__port-action"
                aria-label={`Bind selected variable to ${step.name} value`}
                disabled={disabled}
                onClick={() => actions.value(step, chosen.reference, chosen.id)}
              >
                Bind {chosen.name}
              </button>
            )}
          </div>
        )}
        {step.parameter && (
          <span className="composition-node__summary">
            {step.parameter.type} {step.parameter.cardinality}
          </span>
        )}
        {step.kind !== 'return' && (
          <div
            className="composition-node__output nodrag nopan"
            data-port-direction="output"
            onDragOver={accept}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const id = readVariable(event, actions);
              if (id) actions.output(step, id);
            }}
          >
            <div className="composition-node__argument-label">Output variables</div>
            {actions.adding && editing ? (
              <Input
                aria-label="Output variable name"
                value={actions.variableName}
                disabled={disabled}
                onChange={(event) => actions.name(event.target.value)}
              />
            ) : (
              <div className="composition-node__output-tags">
                {produced.map((variable) => (
                  <span key={variable.id}>{variable.name}</span>
                ))}
                {output && !produced.some((variable) => variable.id === output.id) && <span>{output.name}</span>}
                {editing && actions.outputName && <span>{actions.outputName}</span>}
              </div>
            )}
            {active && (
              <>
                <select
                  aria-label={`Bind output of ${step.name}`}
                  value={output?.id ?? ''}
                  disabled={disabled}
                  onChange={(event) => actions.output(step, event.target.value || undefined)}
                >
                  <option value="">
                    {step.kind === 'input' ? 'Bind to another variable…' : 'Keep current variable'}
                  </option>
                  {actions.variables
                    .filter(
                      (variable) =>
                        (variable.kind === 'variable' || variable.kind === 'output') && variable.id !== step.id
                    )
                    .map((variable) => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name}
                        {variable.kind === 'output' ? ' (function output)' : ''}
                      </option>
                    ))}
                </select>
                {actions.selectedVariable && (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Bind selected variable to output of ${step.name}`}
                    disabled={disabled}
                    onClick={() => actions.output(step, actions.selectedVariable)}
                  >
                    Bind selected
                  </Button>
                )}
                {!actions.adding && (
                  <Input
                    aria-label={`New output variable for ${step.name}`}
                    placeholder="Or define a new variable"
                    value={editing ? (actions.outputName ?? '') : ''}
                    disabled={disabled}
                    onChange={(event) => actions.newOutput(step, event.target.value)}
                  />
                )}
              </>
            )}
            {output && (
              <p className="composition-node__replacement" role="status">
                Replaces {output.name}’s definition; its references stay bound.
              </p>
            )}
            <Handle id="output" type="source" position={data.vertical ? Position.Bottom : Position.Right} />
          </div>
        )}
        {editing && (
          <div className="composition-node__actions nodrag nopan">
            <Button size="xs" disabled={disabled} onClick={actions.apply}>
              {actions.busy ? 'Applying…' : 'Apply'}
            </Button>
            <Button size="xs" variant="ghost" disabled={actions.busy} onClick={actions.discard}>
              Discard
            </Button>
          </div>
        )}
      </div>
    );
  },
  { op: 'CompositionNode', capture: 0 }
);
