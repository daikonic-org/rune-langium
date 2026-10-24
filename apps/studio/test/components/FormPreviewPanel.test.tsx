// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowValidation } from '../../src/components/WorkflowValidation.js';
import { StrictMode, useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { FormPreviewPanel } from '../../src/components/FormPreviewPanel.js';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { installFakeValidatingWorker } from '../helpers/fake-validating-worker.js';

async function chooseArm(name: string, current?: string) {
  const user = userEvent.setup({ writeToClipboard: false });
  const triggers = screen.getAllByRole('combobox', { name: 'Choose one option' });
  const trigger = current ? triggers.find((element) => element.textContent?.includes(current))! : triggers[0]!;
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name, exact: true }));
}
function expectArm(name: string) {
  expect(
    screen
      .getAllByRole('combobox', { name: 'Choose one option' })
      .some((element) => element.textContent?.includes(name))
  ).toBe(true);
}

const tradeSchema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.preview.Trade',
  title: 'Trade',
  status: 'ready',
  fields: [
    { path: 'id', label: 'id', kind: 'string', required: true },
    {
      path: 'side',
      label: 'side',
      kind: 'enum',
      required: true,
      enumValues: [
        { value: 'Buy', label: 'Buy side' },
        { value: 'Sell', label: 'Sell' }
      ]
    },
    {
      path: 'party',
      label: 'party',
      kind: 'object',
      required: true,
      children: [
        {
          path: 'party.name',
          label: 'name',
          kind: 'string',
          required: true,
          description: 'Legal entity name'
        }
      ]
    },
    {
      path: 'tags',
      label: 'tags',
      kind: 'array',
      required: false,
      cardinality: { min: 0, max: 'unbounded' },
      children: [{ path: 'tags[]', label: 'tags item', kind: 'string', required: true }]
    }
  ],
  sourceMap: [
    {
      fieldPath: 'party.name',
      sourceUri: 'file:///workspace/preview.rosetta',
      sourceLine: 12,
      sourceChar: 5
    }
  ]
};

const unsupportedTradeSchema: FormPreviewSchema = {
  ...tradeSchema,
  status: 'unsupported',
  unsupportedFeatures: ['exported-subschema:PartyDefaults'],
  fields: [
    ...tradeSchema.fields,
    {
      path: 'counterparty',
      label: 'counterparty',
      kind: 'object',
      required: true,
      description: 'Mapped via exported subschema defaults',
      children: [
        {
          path: 'counterparty.legalName',
          label: 'Legal name',
          kind: 'string',
          required: true,
          description: 'Uses PartyDefaults.name component mapping'
        }
      ]
    }
  ]
};

const unresolvedReferenceTradeSchema: FormPreviewSchema = {
  ...tradeSchema,
  status: 'unsupported',
  unsupportedFeatures: ['unresolved-reference:Instrument', 'unresolved-reference:Party'],
  fields: [
    ...tradeSchema.fields,
    {
      path: 'instrument',
      label: 'instrument',
      kind: 'unknown',
      required: true,
      description: 'Type reference Instrument could not be resolved for form preview.'
    }
  ]
};

const validationTradeSchema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.preview.ValidatedTrade',
  title: 'Validated Trade',
  status: 'ready',
  fields: [
    { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
    {
      path: 'party',
      label: 'Counterparty',
      kind: 'object',
      required: true,
      children: [{ path: 'party.name', label: 'Name', kind: 'string', required: true }]
    },
    {
      path: 'aliases',
      label: 'Aliases',
      kind: 'array',
      required: true,
      cardinality: { min: 1, max: 2 },
      children: [{ path: 'aliases[]', label: 'Alias', kind: 'string', required: true }]
    }
  ]
};

const optionalSectionSchema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.preview.OptionalTrade',
  title: 'Optional Trade',
  status: 'ready',
  fields: [
    { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
    {
      path: 'counterparty',
      label: 'Counterparty',
      kind: 'object',
      required: false,
      children: [{ path: 'counterparty.name', label: 'Name', kind: 'string', required: true }]
    }
  ]
};

const numericSchema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.preview.NumericTrade',
  title: 'Numeric Trade',
  status: 'ready',
  fields: [{ path: 'quantity', label: 'Quantity', kind: 'number', required: false }]
};

describe('FormPreviewPanel', () => {
  it('keeps a selected temporal Choice arm present when its input is cleared', () => {
    const onValuesChange = vi.fn();
    render(
      <FormPreviewPanel
        schema={{
          schemaVersion: 1,
          targetId: 'test.Choice',
          title: 'Choice',
          kind: 'choice',
          status: 'ready',
          fields: [
            { path: 'text', label: 'Text', kind: 'string', required: false },
            { path: 'date', label: 'Date', kind: 'string', format: 'date', required: false }
          ]
        }}
        status={{ state: 'ready' }}
        values={{ date: '2027-01-31' }}
        onValuesChange={onValuesChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } });
    expect(onValuesChange).toHaveBeenLastCalledWith({ date: '' });
  });

  it('explains an unavailable implementation before Run without removing its inputs', () => {
    const onExecute = vi.fn();
    render(
      <FormPreviewPanel
        schema={{
          schemaVersion: 1,
          targetId: 'test.External#RosettaFunction',
          title: 'External',
          kind: 'function',
          status: 'ready',
          executionUnavailable: 'No Rune implementation is defined.',
          fields: [{ path: 'amount', label: 'Amount', kind: 'number', required: true }]
        }}
        status={{ state: 'ready' }}
        onExecute={onExecute}
      />
    );
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    expect(screen.getByText('No Rune implementation is defined.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }));
    expect(onExecute).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    usePreviewStore.getState().resetPreviewState();
    // Use defineProperty (not Object.assign) so the override works even after
    // user-event installs its own non-writable clipboard implementation.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: async () => undefined
      }
    });
  });

  it('shows pending validation until the worker answers for the latest edit', () => {
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    render(<FormPreviewPanel schema={numericSchema} status={{ state: 'ready', targetId: numericSchema.targetId }} />);
    const field = screen.getByLabelText('Quantity');
    fireEvent.change(field, { target: { value: '1.5' } });
    fireEvent.blur(field);
    const invalidRequestId = postMessage.mock.lastCall![0].requestId;
    act(() =>
      usePreviewStore
        .getState()
        .receiveValidateResult(invalidRequestId, [{ path: 'quantity', message: 'Expected integer' }])
    );
    expect(screen.getByText('Invalid sample (1 issue)')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '2' } });
    const validRequestId = postMessage.mock.lastCall![0].requestId;
    expect(screen.getByText('Validating sample')).toBeInTheDocument();
    fireEvent.blur(field);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Valid sample')).not.toBeInTheDocument();
    act(() => usePreviewStore.getState().receiveValidateResult(invalidRequestId, []));
    expect(screen.queryByText('Valid sample')).not.toBeInTheDocument();
    act(() => usePreviewStore.getState().receiveValidateResult(validRequestId, []));
    expect(screen.getByText('Valid sample')).toBeInTheDocument();
    expect(screen.queryByText('Expected integer')).not.toBeInTheDocument();
  });

  it.each(['object disclosure', 'ISO mode'] as const)(
    'validates an unchecked edit when focus moves to %s',
    async (action) => {
      const postMessage = vi.fn();
      usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
      const model: FormPreviewSchema = {
        ...numericSchema,
        fields: [
          ...numericSchema.fields,
          {
            path: 'party',
            label: 'Counterparty',
            kind: 'object',
            required: true,
            children: [{ path: 'party.name', label: 'Name', kind: 'string', required: false }]
          },
          { path: 'clock', label: 'Clock', kind: 'string', format: 'time', required: false }
        ]
      };
      render(<FormPreviewPanel schema={model} status={{ state: 'ready' }} />);
      const user = userEvent.setup();
      const quantity = screen.getByLabelText('Quantity');
      await user.click(quantity);
      fireEvent.change(quantity, { target: { value: '1.5' } });
      expect(usePreviewStore.getState().samples.get(model.targetId)?.validated).toBe(false);
      expect(postMessage).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole('button', {
          name: action === 'object disclosure' ? 'Counterparty' : 'Edit ISO value',
          exact: true
        })
      );
      if (action === 'object disclosure') {
        expect(screen.getByRole('button', { name: 'Counterparty', exact: true })).toHaveAttribute(
          'aria-expanded',
          'false'
        );
      } else {
        expect(screen.getByRole('button', { name: 'Use picker' })).toBeInTheDocument();
      }
      expect(postMessage).toHaveBeenCalledOnce();
      const request = postMessage.mock.lastCall![0];
      expect(request).toMatchObject({ type: 'instance:validate', data: { quantity: 1.5 } });
      expect(screen.getByText('Validating sample')).toBeInTheDocument();
      act(() =>
        usePreviewStore
          .getState()
          .receiveValidateResult(request.requestId, [{ path: 'quantity', message: 'Expected integer' }])
      );
      expect(screen.getByText('Invalid sample (1 issue)')).toBeInTheDocument();
    }
  );

  it.each(['add', 'remove'] as const)(
    'validates the post-%s list transaction once after an unchecked edit',
    async (action) => {
      const postMessage = vi.fn();
      usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
      const model: FormPreviewSchema = {
        ...numericSchema,
        fields: [
          ...numericSchema.fields,
          {
            path: 'tags',
            label: 'Tags',
            kind: 'array',
            required: false,
            children: [{ path: 'tags[]', label: 'Tag', kind: 'string', required: false }]
          }
        ]
      };
      usePreviewStore
        .getState()
        .ensureSample(model.targetId, { quantity: 0, tags: action === 'remove' ? ['old'] : [] });
      render(<FormPreviewPanel schema={model} status={{ state: 'ready' }} />);
      const user = userEvent.setup();
      const quantity = screen.getByLabelText('Quantity');
      await user.click(quantity);
      fireEvent.change(quantity, { target: { value: '1.5' } });
      await user.click(
        screen.getByRole('button', { name: action === 'add' ? 'Add Tags item' : 'Remove Tag 1', exact: true })
      );
      expect(postMessage).toHaveBeenCalledOnce();
      expect(postMessage.mock.lastCall![0]).toMatchObject({
        type: 'instance:validate',
        data: { quantity: 1.5, tags: action === 'add' ? [''] : [] }
      });
      expect(usePreviewStore.getState().samples.get(model.targetId)?.validated).toBe(true);
    }
  );

  it('shows validation errors that are not attached to a field', () => {
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    render(<FormPreviewPanel schema={numericSchema} status={{ state: 'ready', targetId: numericSchema.targetId }} />);

    fireEvent.blur(screen.getByLabelText('Quantity'));
    const requestId = postMessage.mock.lastCall![0].requestId;
    act(() =>
      usePreviewStore
        .getState()
        .receiveValidateResult(requestId, [{ path: '', message: 'Structural validation unavailable: unknown type' }])
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Structural validation unavailable: unknown type');
  });

  it('shows a no-selection state when no schema is available', () => {
    render(<FormPreviewPanel schema={undefined} status={{ state: 'waiting' }} />);

    expect(screen.getByRole('region', { name: /form preview/i })).toBeInTheDocument();
    expect(screen.getByText(/select a type from the graph, file tree, or source editor/i)).toBeInTheDocument();
  });

  it('shows a waiting state when generation is in progress for a selected type', () => {
    render(<FormPreviewPanel schema={undefined} status={{ state: 'waiting', targetId: tradeSchema.targetId }} />);

    expect(screen.getByText(/generating preview for the selected type/i)).toBeInTheDocument();
    expect(screen.queryByText(/select a type from the graph, file tree, or source editor/i)).not.toBeInTheDocument();
  });

  it('shows an unavailable state when no preview can be generated yet', () => {
    render(
      <FormPreviewPanel
        schema={undefined}
        status={{
          state: 'unavailable',
          targetId: tradeSchema.targetId,
          reason: 'generation-error',
          message: 'Preview generation failed'
        }}
      />
    );

    expect(screen.getByText(/preview generation failed/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/preview generation failed/i);
  });

  it('renders scalar, enum, nested object, and array controls from the preview schema', () => {
    render(<FormPreviewPanel schema={tradeSchema} status={{ state: 'ready', targetId: tradeSchema.targetId }} />);

    expect(screen.getByRole('heading', { name: 'Trade' })).toBeInTheDocument();
    expect(screen.getByLabelText('id')).toHaveAttribute('type', 'text');
    // Radix Select renders the trigger as a button — assert the visible value
    // text rather than `toHaveDisplayValue` (which only works on form controls).
    expect(screen.getByLabelText('side')).toHaveTextContent('Buy side');
    expect(screen.getByLabelText('name')).toHaveAttribute('type', 'text');
    expect(screen.getByText('tags')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add tags item/i })).toBeInTheDocument();
    expect(screen.getByText(/ready to validate sample/i)).toBeInTheDocument();
  });

  it('lets users clear an optional enum back to the unset placeholder', async () => {
    const optionalEnumSchema: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'test.preview.OptionalSide',
      title: 'OptionalSide',
      status: 'ready',
      fields: [
        {
          path: 'side',
          label: 'side',
          kind: 'enum',
          required: false,
          enumValues: [
            { value: 'Buy', label: 'Buy side' },
            { value: 'Sell', label: 'Sell' }
          ]
        }
      ],
      sourceMap: []
    };

    render(
      <FormPreviewPanel
        schema={optionalEnumSchema}
        status={{ state: 'ready', targetId: optionalEnumSchema.targetId }}
      />
    );

    const trigger = screen.getByLabelText('side');
    // Initially unset for an optional enum -> placeholder visible.
    expect(trigger).toHaveTextContent('Select…');
    expect(usePreviewStore.getState().samples.get(optionalEnumSchema.targetId)?.serialized).toBe('{}');

    // `writeToClipboard: false` keeps userEvent from installing a non-writable
    // clipboard mock, which otherwise breaks the per-test `navigator.clipboard`
    // override in this file's beforeEach.
    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Sell' }));
    expect(trigger).toHaveTextContent('Sell');
    expect(usePreviewStore.getState().samples.get(optionalEnumSchema.targetId)?.serialized).toBe(
      '{\n  "side": "Sell"\n}'
    );

    // Clearing back to unset must round-trip through the sentinel "Select…" item.
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Select…' }));
    expect(trigger).toHaveTextContent('Select…');
    expect(usePreviewStore.getState().samples.get(optionalEnumSchema.targetId)?.serialized).toBe('{}');
  });

  it('shows unsupported preview messaging without presenting the sample as valid', () => {
    render(
      <FormPreviewPanel
        schema={unsupportedTradeSchema}
        status={{ state: 'ready', targetId: unsupportedTradeSchema.targetId }}
      />
    );

    expect(screen.getByText(/unsupported preview features/i)).toBeInTheDocument();
    expect(screen.getByText(/exported-subschema:PartyDefaults/i)).toBeInTheDocument();
    expect(screen.getByText('Legal name')).toBeInTheDocument();
    expect(screen.queryByText(/valid sample/i)).not.toBeInTheDocument();
  });

  it('logs an op-log warning when the schema has unsupported preview features', () => {
    useOutputStore.setState({ lines: [] });

    render(
      <FormPreviewPanel
        schema={unsupportedTradeSchema}
        status={{ state: 'ready', targetId: unsupportedTradeSchema.targetId }}
      />
    );

    const entry = useOutputStore.getState().lines.find((l) => l.op === 'preview');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('warn');
    expect(entry?.text).toContain('exported-subschema:PartyDefaults');
    expect(entry?.subject).toBe(unsupportedTradeSchema.targetId);
  });

  it('does not log an op-log warning when the schema has no unsupported preview features', () => {
    useOutputStore.setState({ lines: [] });

    render(<FormPreviewPanel schema={tradeSchema} status={{ state: 'ready', targetId: tradeSchema.targetId }} />);

    expect(useOutputStore.getState().lines.find((l) => l.op === 'preview')).toBeUndefined();
  });

  it('surfaces the root cause when a type reference could not be resolved', () => {
    useOutputStore.setState({ lines: [] });

    render(
      <FormPreviewPanel
        schema={unresolvedReferenceTradeSchema}
        status={{ state: 'ready', targetId: unresolvedReferenceTradeSchema.targetId }}
      />
    );

    const entry = useOutputStore.getState().lines.find((l) => l.op === 'preview');
    expect(entry?.text).toContain('references could not be resolved: Instrument, Party');
    expect(entry?.text).not.toContain('unresolved-reference:');

    expect(screen.getByText(/references could not be resolved: Instrument, Party/i)).toBeInTheDocument();
  });

  it('does not report a fully-expanded cyclic type as "skipped" — only an actually-truncated occurrence gets that wording (Codex PR #459 review, round 2)', () => {
    useOutputStore.setState({ lines: [] });

    const cyclicTradeSchema: FormPreviewSchema = {
      ...tradeSchema,
      status: 'unsupported',
      // 'Party' is a cycle MEMBER but was fully expanded (not truncated)
      // in this schema; 'Instrument' is the occurrence that actually got
      // cut. Only 'Instrument' should read as "skipped" in the summary.
      unsupportedFeatures: ['cyclic-type:Party', 'recursive-reference:Instrument']
    };

    render(
      <FormPreviewPanel schema={cyclicTradeSchema} status={{ state: 'ready', targetId: cyclicTradeSchema.targetId }} />
    );

    const entry = useOutputStore.getState().lines.find((l) => l.op === 'preview');
    expect(entry?.text).toContain('recursive reference skipped: Instrument');
    expect(entry?.text).not.toContain('Party');
    expect(entry?.text).not.toContain('cyclic-type:');
  });

  it('shows neither a warning log nor a blank "Unsupported preview features" banner when every unsupportedFeatures entry is purely informational (Codex PR #459 review, round 3)', () => {
    useOutputStore.setState({ lines: [] });

    // An inheritance-only cycle (A extends B, B extends A) flags A as a
    // cycle member even though nothing was ever truncated — real
    // generatePreviewSchemas output reads `status: 'ready'` here (see
    // packages/codegen/test/preview-schema.test.ts's matching case), so
    // this schema shape must never surface as "unsupported" in the UI.
    const cyclicOnlyTradeSchema: FormPreviewSchema = {
      ...tradeSchema,
      status: 'ready',
      unsupportedFeatures: ['cyclic-type:A']
    };

    render(
      <FormPreviewPanel
        schema={cyclicOnlyTradeSchema}
        status={{ state: 'ready', targetId: cyclicOnlyTradeSchema.targetId }}
      />
    );

    expect(useOutputStore.getState().lines.find((l) => l.op === 'preview')).toBeUndefined();
    expect(screen.queryByText(/unsupported preview features/i)).not.toBeInTheDocument();
  });

  it('shows a resolving indicator instead of "could not be resolved" while a retry is in flight', () => {
    const schemeSchema: FormPreviewSchema = {
      schemaVersion: 1,
      kind: 'typeAlias',
      targetId: 'Scheme',
      title: 'Scheme',
      status: 'unsupported',
      fields: [
        {
          path: 'value',
          label: 'Value',
          kind: 'unknown',
          required: true,
          description: 'Type reference NormalizedString could not be resolved for form preview.'
        }
      ],
      unsupportedFeatures: ['unresolved-reference:NormalizedString']
    };

    usePreviewStore.setState({ hydrationRetriesRemaining: { Scheme: 3 } });
    render(<FormPreviewPanel schema={schemeSchema} status={{ state: 'ready', targetId: schemeSchema.targetId }} />);

    expect(screen.getByText(/resolving/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be resolved/i)).not.toBeInTheDocument();
  });

  it('shows the real unresolved diagnostic once retries are exhausted', () => {
    const schemeSchema: FormPreviewSchema = {
      schemaVersion: 1,
      kind: 'typeAlias',
      targetId: 'Scheme',
      title: 'Scheme',
      status: 'unsupported',
      fields: [
        {
          path: 'value',
          label: 'Value',
          kind: 'unknown',
          required: true,
          description: 'Type reference NormalizedString could not be resolved for form preview.'
        }
      ],
      unsupportedFeatures: ['unresolved-reference:NormalizedString']
    };

    usePreviewStore.setState({ hydrationRetriesRemaining: { Scheme: 0 } });
    render(<FormPreviewPanel schema={schemeSchema} status={{ state: 'ready', targetId: schemeSchema.targetId }} />);

    // Both the per-field diagnostic and the aggregate "Unsupported preview
    // features" summary independently mention "could not be resolved" for
    // this single-reference typeAlias fixture (pre-existing, unrelated to
    // Task 6) — assert at least one is present rather than exactly one.
    expect(screen.getAllByText(/could not be resolved/i).length).toBeGreaterThan(0);
  });

  it('logs only one op-log warning under StrictMode double-invoked effects', () => {
    useOutputStore.setState({ lines: [] });

    render(
      <StrictMode>
        <FormPreviewPanel
          schema={unsupportedTradeSchema}
          status={{ state: 'ready', targetId: unsupportedTradeSchema.targetId }}
        />
      </StrictMode>
    );

    const entries = useOutputStore.getState().lines.filter((l) => l.op === 'preview');
    expect(entries).toHaveLength(1);
  });

  it('renders nested preview metadata without field description annotations', () => {
    render(
      <FormPreviewPanel
        schema={unsupportedTradeSchema}
        status={{
          state: 'stale',
          targetId: unsupportedTradeSchema.targetId,
          reason: 'generation-error',
          message: 'Using last successful preview'
        }}
      />
    );

    // Field descriptions are no longer rendered (removed in restyle)
    expect(screen.queryByText(/mapped via exported subschema defaults/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/uses partydefaults\.name component mapping/i)).not.toBeInTheDocument();
    // But the fields themselves remain
    expect(screen.getByText('counterparty')).toBeInTheDocument();
    expect(screen.getByText('Legal name')).toBeInTheDocument();
  });

  it('does not surface raw source locations in the form UI', () => {
    render(<FormPreviewPanel schema={tradeSchema} status={{ state: 'ready', targetId: tradeSchema.targetId }} />);

    expect(screen.queryByText(/preview\.rosetta:12:5/i)).not.toBeInTheDocument();
    // Field descriptions are no longer rendered (removed in restyle)
    expect(screen.queryByText(/legal entity name/i)).not.toBeInTheDocument();
  });

  it('shows invalid and valid summary states, nested validation errors, and reset behavior', () => {
    installFakeValidatingWorker(validationTradeSchema);
    render(
      <FormPreviewPanel
        schema={validationTradeSchema}
        status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
      />
    );

    expect(screen.getByText(/ready to validate sample/i)).toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Trade id'));
    fireEvent.blur(screen.getByLabelText('Name'));

    expect(screen.getByText(/invalid sample/i)).toBeInTheDocument();
    expect(screen.getByText(/trade id is required/i)).toBeInTheDocument();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/add at least 1 aliases item/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Trade id'), { target: { value: 'TRD-1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Bank' } });
    fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));
    fireEvent.change(screen.getByLabelText('Alias 1'), { target: { value: 'Primary alias' } });

    expect(screen.getByText(/valid sample/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));

    expect(screen.getByText(/ready to validate sample/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Trade id')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.queryByLabelText('Alias 1')).not.toBeInTheDocument();
  });

  it('enforces array max-cardinality validation when a repeatable field exceeds its preview limit', () => {
    installFakeValidatingWorker(validationTradeSchema);
    render(
      <FormPreviewPanel
        schema={validationTradeSchema}
        status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
      />
    );

    fireEvent.change(screen.getByLabelText('Trade id'), { target: { value: 'TRD-1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Bank' } });
    fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));
    fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));
    fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));

    expect(screen.getByText(/use at most 2 aliases items/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid sample/i)).toBeInTheDocument();
  });

  it('lets optional object sections stay absent until explicitly added', () => {
    installFakeValidatingWorker(optionalSectionSchema);
    render(
      <FormPreviewPanel
        schema={optionalSectionSchema}
        status={{ state: 'ready', targetId: optionalSectionSchema.targetId }}
      />
    );

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    // The "Section omitted from the sample." caption was removed — the
    // absent nested children (no Name input rendered) is the affordance.
    // The Add button stays accessible via its aria-label even though the
    // label text is replaced by a + icon.
    expect(screen.getByTestId('sample-data-output')).not.toHaveTextContent('counterparty');

    fireEvent.click(screen.getByRole('button', { name: /add counterparty/i }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"counterparty": {');

    fireEvent.blur(screen.getByLabelText('Name'));
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove counterparty/i }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('sample-data-output')).not.toHaveTextContent('counterparty');
  });

  it('stores numeric sample values as numbers instead of strings', () => {
    render(<FormPreviewPanel schema={numericSchema} status={{ state: 'ready', targetId: numericSchema.targetId }} />);

    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '42', valueAsNumber: 42 }
    });

    expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"quantity": 42');
  });

  it('renders synchronized sample data and copies it through the clipboard action', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <FormPreviewPanel
        schema={validationTradeSchema}
        status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
      />
    );

    fireEvent.change(screen.getByLabelText('Trade id'), { target: { value: 'TRD-1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Bank' } });
    fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));
    fireEvent.change(screen.getByLabelText('Alias 1'), { target: { value: 'Desk alias' } });

    expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"tradeId": "TRD-1"');
    expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"name": "Acme Bank"');
    expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"Desk alias"');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    });

    expect(writeText).toHaveBeenCalledWith(`{
  "tradeId": "TRD-1",
  "party": {
    "name": "Acme Bank"
  },
  "aliases": [
    "Desk alias"
  ]
}`);
    expect(screen.getByText(/sample data copied/i)).toBeInTheDocument();
  });

  describe('controlled mode (values/onValuesChange props)', () => {
    it('resets ISO editing across temporal format changes while retaining it for value edits', () => {
      const schema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.LocalTimestamp',
        title: 'Local timestamp',
        status: 'ready',
        fields: [{ path: 'value', label: 'Value', kind: 'string', format: 'dateTime', required: true }]
      };
      const onValuesChange = vi.fn();
      const view = render(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready' }}
          values={{ value: '2026-10-11T14:30:00' }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit ISO value' }));
      expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'text');
      view.rerender(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready' }}
          values={{ value: '2026-10-12T14:30:00' }}
          onValuesChange={onValuesChange}
        />
      );
      expect(screen.getByRole('button', { name: 'Use picker' })).toBeInTheDocument();

      view.rerender(
        <FormPreviewPanel
          schema={{
            ...schema,
            targetId: 'test.CalendarDate',
            fields: [{ ...schema.fields[0]!, format: 'date' }]
          }}
          status={{ state: 'ready' }}
          values={{ value: '2026-10-12' }}
          onValuesChange={onValuesChange}
        />
      );
      expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'date');
      expect(screen.queryByLabelText('Value picker')).not.toBeInTheDocument();

      view.rerender(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready' }}
          values={{ value: '2026-10-12T14:30:00' }}
          onValuesChange={onValuesChange}
        />
      );
      expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'datetime-local');
      expect(screen.getByRole('button', { name: 'Edit ISO value' })).toBeInTheDocument();
      expect(onValuesChange).not.toHaveBeenCalled();
    });

    it('uses a date picker and preserves ISO strings when choosing or clearing a day', () => {
      const schema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.Schedule',
        title: 'Schedule',
        status: 'ready',
        fields: [
          { path: 'day', label: 'Day', kind: 'string', format: 'date', required: false },
          { path: 'timestamp', label: 'Timestamp', kind: 'string', required: false }
        ]
      };
      const onValuesChange = vi.fn();
      const view = render(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready' }}
          values={{ day: '2026-10-06', timestamp: '' }}
          onValuesChange={onValuesChange}
        />
      );
      const input = screen.getByLabelText('Day');
      expect(input).toHaveAttribute('type', 'date');
      expect(input).toHaveValue('2026-10-06');
      expect(screen.getByLabelText('Timestamp')).toHaveAttribute('type', 'text');
      fireEvent.change(input, { target: { value: '2026-12-31' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({ day: '2026-12-31', timestamp: '' });
      view.rerender(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready' }}
          values={{ day: '2026-12-31', timestamp: '' }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.change(screen.getByLabelText('Day'), { target: { value: '' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({ day: undefined, timestamp: '' });
    });
    describe.each([
      ['time', '09:08:00', '', ''],
      ['dateTime', '2026-10-11T09:08:00', '2026-10-11T', ''],
      ['zonedDateTime', '2026-10-11T09:08:00+05:30[Asia/Kolkata]', '2026-10-11T', '+05:30[Asia/Kolkata]']
    ] as const)('%s fractional-seconds picker', (format, initial, prefix, suffix) => {
      it.each([
        ['1.5', '01.5'],
        ['0.125', '00.125'],
        ['1.123456789', '01.123456789']
      ])('publishes valid ISO seconds for %s', async (seconds, expected) => {
        const onValuesChange = vi.fn();
        render(
          <FormPreviewPanel
            schema={{
              schemaVersion: 1,
              targetId: 'test.Temporal',
              title: 'Temporal',
              status: 'ready',
              fields: [{ path: 'clock', label: 'Clock', kind: 'string', format, required: true }]
            }}
            status={{ state: 'ready' }}
            values={{ clock: initial }}
            onValuesChange={onValuesChange}
          />
        );
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Open Clock picker' }));
        const second = screen.getByRole('textbox', { name: 'Clock second' });
        await user.clear(second);
        await user.type(second, seconds);
        await user.click(screen.getByRole('button', { name: 'Set time' }));
        expect(onValuesChange).toHaveBeenLastCalledWith({ clock: `${prefix}09:08:${expected}${suffix}` });
      });
    });

    it('uses styled time/local pickers, retains seconds and exposes zoned ISO editing', async () => {
      const schema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.Temporal',
        title: 'Temporal',
        status: 'ready',
        fields: [
          { path: 'clock', label: 'Clock', kind: 'string', format: 'time', required: true },
          { path: 'local', label: 'Local', kind: 'string', format: 'dateTime', required: true },
          { path: 'zoned', label: 'Zoned', kind: 'string', format: 'zonedDateTime', required: false }
        ]
      };
      const onValuesChange = vi.fn();
      const values = { clock: '', local: '', zoned: '2026-10-11T14:30:12.123456789+05:30[Asia/Kolkata]' };
      render(
        <FormPreviewPanel schema={schema} status={{ state: 'ready' }} values={values} onValuesChange={onValuesChange} />
      );
      expect(screen.getByLabelText('Clock')).toHaveAttribute('type', 'time');
      expect(screen.getByLabelText('Local')).toHaveAttribute('type', 'datetime-local');
      fireEvent.change(screen.getByLabelText('Clock'), { target: { value: '14:30' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({ ...values, clock: '14:30:00' });
      fireEvent.change(screen.getByLabelText('Local'), { target: { value: '2026-10-12T14:30' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({ ...values, local: '2026-10-12T14:30:00' });
      expect(screen.getByLabelText('Zoned')).toHaveValue(values.zoned);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Open Zoned picker' }));
      fireEvent.click(await screen.findByRole('button', { name: /12, .*October.*2026/ }));
      expect(onValuesChange).toHaveBeenLastCalledWith({
        ...values,
        zoned: '2026-10-12T14:30:12.123456789+05:30[Asia/Kolkata]'
      });
      fireEvent.change(screen.getByLabelText('Zoned'), { target: { value: '' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({ ...values, zoned: undefined });
    });

    const recursiveSchema: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'test.Node',
      title: 'Node',
      status: 'ready',
      fields: [
        { path: 'root', label: 'Root', kind: 'object', required: true, definitionId: 'test.Node', children: [] }
      ],
      definitions: {
        'test.Node': {
          fields: [
            { path: 'name', label: 'Name', kind: 'string', required: true },
            { path: 'child', label: 'Child', kind: 'object', required: false, definitionId: 'test.Node', children: [] },
            {
              path: 'children',
              label: 'Children',
              kind: 'array',
              required: false,
              children: [
                {
                  path: 'children[]',
                  label: 'Node',
                  kind: 'object',
                  required: true,
                  definitionId: 'test.Node',
                  children: []
                }
              ]
            }
          ]
        }
      }
    };

    it('adds and removes a recursive child and edits its ordinary fields', () => {
      const onValuesChange = vi.fn();
      const view = (values: Record<string, unknown>) => (
        <FormPreviewPanel
          schema={recursiveSchema}
          status={{ state: 'ready', targetId: recursiveSchema.targetId }}
          values={values}
          onValuesChange={onValuesChange}
        />
      );
      const { rerender } = render(view({ root: { name: 'Parent' } }));
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Add Child' }));
      const values = onValuesChange.mock.lastCall![0];
      expect(values.root.child).toEqual({ name: '', children: [] });
      rerender(view(values));
      expect(screen.getAllByRole('textbox')).toHaveLength(2);
      fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'Descendant' } });
      expect(onValuesChange.mock.lastCall![0].root.child.name).toBe('Descendant');
      fireEvent.click(screen.getByRole('button', { name: 'Remove Child' }));
      expect(onValuesChange.mock.lastCall![0].root.child).toBeUndefined();
    });

    it('leaves an absent required deferred object collapsed until explicitly added', () => {
      const onValuesChange = vi.fn();
      render(
        <FormPreviewPanel
          schema={recursiveSchema}
          status={{ state: 'ready', targetId: recursiveSchema.targetId }}
          values={{}}
          onValuesChange={onValuesChange}
        />
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add Root' }));
      expect(onValuesChange).toHaveBeenCalledWith({ root: { name: '', children: [] } });
    });

    it('renders deep existing values and recursive array items without expanding absent children', async () => {
      const onValuesChange = vi.fn();
      const root = {
        name: 'Level 1',
        child: { name: 'Level 2', child: { name: 'Level 3' } },
        children: [{ name: 'Sibling' }]
      };
      render(
        <FormPreviewPanel
          schema={recursiveSchema}
          status={{ state: 'ready', targetId: recursiveSchema.targetId }}
          values={{ root }}
          onValuesChange={onValuesChange}
        />
      );
      expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual([
        'Level 1',
        'Level 2',
        'Level 3'
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Open Children 1 details' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Edited sibling' }
      });
      expect(onValuesChange.mock.lastCall![0].root.children[0].name).toBe('Edited sibling');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      fireEvent.click(document.querySelector('[data-field-path="root.children"] button')!);
      expect(onValuesChange.mock.lastCall![0].root.children).toEqual([{ name: 'Sibling' }, {}]);
    });

    it('renders using the given values prop instead of usePreviewStore state', () => {
      render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: 'EXT-1', party: { name: 'External Bank' }, aliases: ['Ext alias'] }}
        />
      );

      expect(screen.getByLabelText('Trade id')).toHaveValue('EXT-1');
      expect(screen.getByLabelText('Name')).toHaveValue('External Bank');
      expect(screen.getByLabelText('Alias 1')).toHaveValue('Ext alias');
      // The uncontrolled store's sample for this targetId must remain untouched.
      expect(usePreviewStore.getState().samples.has(validationTradeSchema.targetId)).toBe(false);
    });

    it('calls onValuesChange with the full merged object on a scalar edit + blur, and does not call updateSampleValues', () => {
      const updateSampleSpy = vi.spyOn(usePreviewStore.getState(), 'updateSampleValues');
      const onValuesChange = vi.fn();
      render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: '', party: { name: '' }, aliases: [] }}
          onValuesChange={onValuesChange}
        />
      );

      fireEvent.change(screen.getByLabelText('Trade id'), { target: { value: 'TRD-9' } });
      fireEvent.blur(screen.getByLabelText('Trade id'));

      expect(onValuesChange).toHaveBeenCalledWith({ tradeId: 'TRD-9', party: { name: '' }, aliases: [] });
      expect(updateSampleSpy).not.toHaveBeenCalled();
      updateSampleSpy.mockRestore();
    });

    it('produces correctly nested onValuesChange payloads for a nested-object field edit and an array add/remove', () => {
      const onValuesChange = vi.fn();
      const { rerender } = render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: 'TRD-1', party: { name: '' }, aliases: [] }}
          onValuesChange={onValuesChange}
        />
      );

      // Nested-object field edit.
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Bank' } });
      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'TRD-1',
        party: { name: 'Acme Bank' },
        aliases: []
      });

      // Array add — simulate the parent feeding the updated values back in
      // (as InstanceFormPanel will via the store), since this component is
      // controlled and does not track its own values across renders.
      rerender(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: 'TRD-1', party: { name: 'Acme Bank' }, aliases: [] }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /add aliases item/i }));
      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'TRD-1',
        party: { name: 'Acme Bank' },
        aliases: ['']
      });

      // Array remove — feed the added-item state back in, then remove it.
      rerender(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: 'TRD-1', party: { name: 'Acme Bank' }, aliases: ['Primary alias'] }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /remove alias 1/i }));
      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'TRD-1',
        party: { name: 'Acme Bank' },
        aliases: []
      });
    });
  });

  describe('Choice-ancestor arm selection (issue #434)', () => {
    it('seeds and retains a concrete value for an enum-backed Choice arm', async () => {
      const schema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.ChoiceWithEnum',
        title: 'ChoiceWithEnum',
        kind: 'choice',
        status: 'ready',
        fields: [
          {
            path: 'unit',
            label: 'Unit',
            kind: 'enum',
            required: false,
            enumValues: [
              { value: 'Share', label: 'Share' },
              { value: 'Weight', label: 'Weight' }
            ]
          },
          { path: 'cash', label: 'Cash', kind: 'string', required: false }
        ]
      };
      const user = userEvent.setup({ writeToClipboard: false });
      render(<FormPreviewPanel schema={schema} status={{ state: 'ready', targetId: schema.targetId }} />);

      expectArm('Unit');
      expect(usePreviewStore.getState().samples.get(schema.targetId)?.serialized).toBe('{\n  "unit": "Share"\n}');

      await user.click(screen.getByRole('combobox', { name: 'Unit' }));
      expect(screen.queryByRole('option', { name: 'Select…' })).not.toBeInTheDocument();
      await user.click(await screen.findByRole('option', { name: 'Weight' }));
      expect(usePreviewStore.getState().samples.get(schema.targetId)?.serialized).toBe('{\n  "unit": "Weight"\n}');

      await chooseArm('Cash');
      await chooseArm('Unit');
      expectArm('Unit');
      expect(usePreviewStore.getState().samples.get(schema.targetId)?.serialized).toBe('{\n  "unit": "Share"\n}');
    });

    // A Data-extends-Choice reference reached via a NESTED attribute
    // (`constituent`) — mirrors what buildDataSchema/objectField in
    // preview-schema.ts actually produce: one field per Choice option
    // (`cash` scalar, `commodity` object) alongside the Data type's own
    // attribute (`weight`), with `choiceArmPaths` naming the two arms.
    const nestedChoiceSchema: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'test.preview.TradeWithConstituent',
      title: 'TradeWithConstituent',
      status: 'ready',
      fields: [
        { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
        {
          path: 'constituent',
          label: 'Constituent',
          kind: 'object',
          required: true,
          choiceArmPaths: ['constituent.cash', 'constituent.commodity'],
          children: [
            { path: 'constituent.weight', label: 'Weight', kind: 'number', required: true },
            { path: 'constituent.cash', label: 'Cash', kind: 'string', required: false },
            {
              path: 'constituent.commodity',
              label: 'Commodity',
              kind: 'object',
              required: false,
              children: [{ path: 'constituent.commodity.symbol', label: 'Symbol', kind: 'string', required: true }]
            }
          ]
        }
      ]
    };

    it("renders a NESTED Data-extends-Choice reference's scalar/object arms through a single-selection dropdown, not as always-present plain fields", () => {
      render(
        <FormPreviewPanel
          schema={nestedChoiceSchema}
          status={{ state: 'ready', targetId: nestedChoiceSchema.targetId }}
        />
      );

      expect(screen.getByText('Choose one option')).toBeInTheDocument();
      expectArm('Cash');
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      // The Data type's own (non-arm) attribute still renders as a plain field.
      expect(screen.getByLabelText('Weight')).toBeInTheDocument();
    });

    it('seeds only the FIRST arm with a real default value, so exactly one arm starts selected instead of every scalar arm starting "present"', () => {
      render(
        <FormPreviewPanel
          schema={nestedChoiceSchema}
          status={{ state: 'ready', targetId: nestedChoiceSchema.targetId }}
        />
      );

      // Cash is the first-listed arm — it should be the initially active
      // radio option, with its scalar control rendered...
      expectArm('Cash');
      expect(screen.getByRole('textbox', { name: 'Cash' })).toBeInTheDocument();
      // ...while Commodity's nested field must NOT be rendered — if every
      // arm's default value were seeded (the pre-fix bug), both would show
      // simultaneously with no way to tell which one is "selected".
      expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
    });

    it("switching the selected arm clears the previously-selected scalar arm's value entirely (not left at its default)", async () => {
      const onValuesChange = vi.fn();
      render(
        <FormPreviewPanel
          schema={nestedChoiceSchema}
          status={{ state: 'ready', targetId: nestedChoiceSchema.targetId }}
          values={{ tradeId: 'T1', constituent: { weight: 5, cash: '' } }}
          onValuesChange={onValuesChange}
        />
      );

      await chooseArm('Commodity');

      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'T1',
        constituent: { weight: 5, commodity: { symbol: '' } }
      });
    });

    it('renders a TOP-LEVEL Data-extends-Choice schema\'s (kind !== "choice") arms through the same dropdown as the nested case', () => {
      const rootChoiceSchema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.BasketConstituent',
        title: 'BasketConstituent',
        kind: 'data',
        status: 'ready',
        choiceArmPaths: ['cash', 'commodity'],
        fields: [
          { path: 'weight', label: 'Weight', kind: 'number', required: true },
          { path: 'cash', label: 'Cash', kind: 'string', required: false },
          {
            path: 'commodity',
            label: 'Commodity',
            kind: 'object',
            required: false,
            children: [{ path: 'commodity.symbol', label: 'Symbol', kind: 'string', required: true }]
          }
        ]
      };

      render(
        <FormPreviewPanel schema={rootChoiceSchema} status={{ state: 'ready', targetId: rootChoiceSchema.targetId }} />
      );

      expect(screen.getByText('Choose one option')).toBeInTheDocument();
      expectArm('Cash');
      expect(screen.getByLabelText('Weight')).toBeInTheDocument();
    });

    it("materializes an OBJECT-kind first arm's default fields into the sample, not just its dropdown selection (Codex round 2)", () => {
      // Commodity (an OBJECT arm) is listed FIRST here — the earlier tests
      // only ever exercised a scalar (Cash) first arm, which never hit
      // `buildDefaultValue`'s `required: false` → `undefined` short-circuit
      // for the 'object' case. Without materializing the object arm's own
      // default via buildDefaultObjectValue, the radio still LOOKS selected
      // (ChoiceFieldGroup's `?? fields[0]` fallback), but the sample itself
      // never gains a `commodity` key at all.
      const objectFirstSchema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.TradeWithCommodityFirst',
        title: 'TradeWithCommodityFirst',
        status: 'ready',
        fields: [
          { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
          {
            path: 'constituent',
            label: 'Constituent',
            kind: 'object',
            required: true,
            choiceArmPaths: ['constituent.commodity', 'constituent.cash'],
            children: [
              { path: 'constituent.weight', label: 'Weight', kind: 'number', required: true },
              {
                path: 'constituent.commodity',
                label: 'Commodity',
                kind: 'object',
                required: false,
                children: [{ path: 'constituent.commodity.symbol', label: 'Symbol', kind: 'string', required: true }]
              },
              { path: 'constituent.cash', label: 'Cash', kind: 'string', required: false }
            ]
          }
        ]
      };

      render(
        <FormPreviewPanel
          schema={objectFirstSchema}
          status={{ state: 'ready', targetId: objectFirstSchema.targetId }}
        />
      );

      expectArm('Commodity');
      expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"commodity": {');
      expect(screen.getByTestId('sample-data-output')).toHaveTextContent('"symbol": ""');
    });

    it('selecting a BOOLEAN arm seeds it with `false`, not an empty string the boolean validator rejects (Codex round 2)', async () => {
      const booleanArmSchema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.TradeWithFlag',
        title: 'TradeWithFlag',
        status: 'ready',
        fields: [
          { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
          {
            path: 'constituent',
            label: 'Constituent',
            kind: 'object',
            required: true,
            choiceArmPaths: ['constituent.cash', 'constituent.cleared'],
            children: [
              { path: 'constituent.cash', label: 'Cash', kind: 'string', required: false },
              { path: 'constituent.cleared', label: 'Cleared', kind: 'boolean', required: false }
            ]
          }
        ]
      };
      const onValuesChange = vi.fn();

      render(
        <FormPreviewPanel
          schema={booleanArmSchema}
          status={{ state: 'ready', targetId: booleanArmSchema.targetId }}
          values={{ tradeId: 'T1', constituent: { cash: '' } }}
          onValuesChange={onValuesChange}
        />
      );

      await chooseArm('Cleared');

      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'T1',
        constituent: { cleared: false }
      });
    });

    it('keeps a NUMERIC arm selected (dropdown selected, input rendered) when its value is cleared mid-edit (issue #434 round 3)', async () => {
      // getInputValue previously returned `undefined` for a cleared number
      // input; ChoiceFieldGroup's presence check (`value !== undefined`)
      // then read the arm as unselected the instant the user cleared it,
      // unchecking its radio and unmounting the input they were editing.
      const numericArmSchema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.TradeWithQuantity',
        title: 'TradeWithQuantity',
        status: 'ready',
        fields: [
          { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
          {
            path: 'constituent',
            label: 'Constituent',
            kind: 'object',
            required: true,
            choiceArmPaths: ['constituent.quantity', 'constituent.symbol'],
            children: [
              { path: 'constituent.quantity', label: 'Quantity', kind: 'number', required: false },
              { path: 'constituent.symbol', label: 'Symbol', kind: 'string', required: false }
            ]
          }
        ]
      };
      const user = userEvent.setup();
      const onValuesChange = vi.fn();

      render(
        <FormPreviewPanel
          schema={numericArmSchema}
          status={{ state: 'ready', targetId: numericArmSchema.targetId }}
          values={{ tradeId: 'T1', constituent: { quantity: 5 } }}
          onValuesChange={onValuesChange}
        />
      );

      const quantityInput = screen.getByRole('spinbutton', { name: 'Quantity' });
      await user.clear(quantityInput);

      // This is a controlled component — the test double doesn't feed
      // emitted values back into `values`, so the DOM never re-renders with
      // the cleared value. Assert on what was actually EMITTED: the
      // "quantity" key must still be present (as '', not absent/undefined)
      // — that's the signal ChoiceFieldGroup's presence check relies on to
      // keep the arm selected.
      expect(onValuesChange).toHaveBeenLastCalledWith({
        tradeId: 'T1',
        constituent: { quantity: '' }
      });
    });

    it('does not fabricate a selected arm for a genuinely empty controlled value (issue #434 round 2)', () => {
      // A freshly created InstanceFormPanel record starts as controlled
      // `values={}` before anything seeds real defaults into it (the
      // controlled path deliberately skips this component's own
      // defaultValues — `values ?? defaultValues` only falls back on
      // null/undefined, not on a real, empty `{}`). Falling back to
      // `fields[0]` here would show a dropdown selected while the persisted
      // sample has no key for it at all — a visual/data mismatch. No arm
      // checked is the honest rendering of that state.
      render(
        <FormPreviewPanel
          schema={nestedChoiceSchema}
          status={{ state: 'ready', targetId: nestedChoiceSchema.targetId }}
          values={{}}
          onValuesChange={vi.fn()}
        />
      );

      expect(screen.getByRole('combobox', { name: 'Choose one option' })).toHaveTextContent('Choose an option');
      expect(screen.queryByRole('textbox', { name: 'Cash' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
    });

    it("routes a DOUBLY-nested Choice arm's own children through a nested dropdown instead of flat always-present controls (issue #434 round 3)", async () => {
      // The selected "bond" arm is itself a Data type extending ANOTHER
      // Choice — mirrors what buildChoiceOptionField's doubly-nested branch
      // in preview-schema.ts actually produces: an 'object' field whose OWN
      // choiceArmPaths names its own two mutually-exclusive arms
      // (fixedRate/floatingRate), alongside its own ordinary attribute
      // (couponFrequency).
      const doublyNestedSchema: FormPreviewSchema = {
        schemaVersion: 1,
        targetId: 'test.preview.Instrument',
        title: 'Instrument',
        kind: 'choice',
        status: 'ready',
        fields: [
          {
            path: 'bond',
            label: 'Bond',
            kind: 'object',
            required: false,
            choiceArmPaths: ['bond.fixedRate', 'bond.floatingRate'],
            children: [
              { path: 'bond.couponFrequency', label: 'Coupon Frequency', kind: 'string', required: true },
              { path: 'bond.fixedRate', label: 'Fixed Rate', kind: 'number', required: false },
              { path: 'bond.floatingRate', label: 'Floating Rate', kind: 'number', required: false }
            ]
          },
          { path: 'equity', label: 'Equity', kind: 'string', required: false }
        ]
      };
      const onValuesChange = vi.fn();

      render(
        <FormPreviewPanel
          schema={doublyNestedSchema}
          status={{ state: 'ready', targetId: doublyNestedSchema.targetId }}
          values={{ bond: { couponFrequency: '', fixedRate: 5 } }}
          onValuesChange={onValuesChange}
        />
      );

      // Two nested "Choose one option" groups: the outer Bond/Equity
      // choice, and the Bond arm's own Fixed/Floating rate choice.
      expect(screen.getAllByText('Choose one option')).toHaveLength(2);
      expectArm('Fixed Rate');
      expect(screen.queryByRole('spinbutton', { name: 'Floating Rate' })).not.toBeInTheDocument();
      // The Bond arm's own ordinary attribute still renders as a plain field.
      expect(screen.getByLabelText('Coupon Frequency')).toBeInTheDocument();

      await chooseArm('Floating Rate', 'Fixed Rate');

      expect(onValuesChange).toHaveBeenLastCalledWith({
        bond: { couponFrequency: '', floatingRate: '' }
      });
    });
  });

  describe('controlled mode error display (errors/valid/validated props)', () => {
    it('forwards edits once without rewriting the instance when focus leaves a field', () => {
      const onValuesChange = vi.fn();
      const { rerender } = render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: '' }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.change(screen.getByRole('textbox', { name: 'Trade id' }), { target: { value: 'T1' } });
      expect(onValuesChange).toHaveBeenCalledExactlyOnceWith({ tradeId: 'T1' });
      rerender(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: 'T1' }}
          onValuesChange={onValuesChange}
        />
      );
      fireEvent.blur(screen.getByRole('textbox', { name: 'Trade id' }));
      expect(onValuesChange).toHaveBeenCalledTimes(1);
    });

    it('shows an inline field error sourced from the errors prop, gated by validated', () => {
      const { rerender } = render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: '', party: { name: '' }, aliases: [] }}
          errors={{ tradeId: 'Trade id is required' }}
          valid={false}
          validated={false}
        />
      );
      expect(screen.queryByText('Trade id is required')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Trade id' })).not.toHaveAttribute('aria-invalid');

      rerender(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: '', party: { name: '' }, aliases: [] }}
          errors={{ tradeId: 'Trade id is required' }}
          valid={false}
          validated={true}
        />
      );
      expect(screen.getByText('Trade id is required')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Trade id' })).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('textbox', { name: 'Trade id' })).toHaveAccessibleDescription('Trade id is required');
    });

    it('associates errors with each control kind and clears invalid state after a valid result', () => {
      const schema: FormPreviewSchema = {
        ...tradeSchema,
        fields: [
          { path: 'amount', label: 'Amount', kind: 'number', required: true },
          {
            path: 'status',
            label: 'Status',
            kind: 'enum',
            required: true,
            enumValues: [{ value: 'Draft', label: 'Draft' }]
          },
          { path: 'active', label: 'Active', kind: 'boolean', required: true },
          { path: 'date', label: 'Event date', kind: 'string', required: true, format: 'date' }
        ]
      };
      const values = { amount: 0, status: 'Draft', active: false, date: '2026-10-21' };
      const props = { schema, status: { state: 'ready' as const, targetId: schema.targetId }, values, validated: true };
      const { rerender } = render(
        <FormPreviewPanel
          {...props}
          valid={false}
          errors={{
            amount: 'Enter an amount',
            status: 'Choose a status',
            active: 'Check this value',
            date: 'Choose a date'
          }}
        />
      );
      const controls = [
        screen.getByRole('spinbutton', { name: 'Amount' }),
        screen.getByRole('combobox', { name: 'Status' }),
        screen.getByRole('checkbox', { name: 'Active' }),
        screen.getByLabelText('Event date', { exact: true })
      ];
      for (const [index, control] of controls.entries()) {
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(control).toHaveAccessibleDescription(
          ['Enter an amount', 'Choose a status', 'Check this value', 'Choose a date'][index]
        );
      }
      rerender(<FormPreviewPanel {...props} valid errors={{}} />);
      for (const control of controls) {
        expect(control).not.toHaveAttribute('aria-invalid');
        expect(control).not.toHaveAttribute('aria-describedby');
      }
    });

    it('shows no errors when errors/valid/validated props are omitted (defaults)', () => {
      render(
        <FormPreviewPanel
          schema={validationTradeSchema}
          status={{ state: 'ready', targetId: validationTradeSchema.targetId }}
          values={{ tradeId: '', party: { name: '' }, aliases: [] }}
        />
      );
      expect(screen.queryByText(/is required/i)).not.toBeInTheDocument();
    });
  });

  describe('function execution', () => {
    // `schema.title` is deliberately just the BARE function name (see
    // `buildFunctionSchema` in packages/codegen/src/preview-schema.ts) —
    // two different namespaces can declare a func with the same bare name.
    // `schema.targetId` is the namespace-qualified `${namespace}.${name}`
    // and is globally unique; `onExecute` must be called with THAT, not
    // `schema.title`, or the worker's executeFunction has no way to tell
    // which namespace's function the user actually selected.
    const calcTradeSchema: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'beta.CalcTrade',
      title: 'CalcTrade',
      kind: 'function',
      status: 'ready',
      fields: []
    };

    it('presents temporal format guidance while retaining the original execution diagnostic', async () => {
      const schema: FormPreviewSchema = {
        ...calcTradeSchema,
        fields: [{ path: 'when', label: 'When', kind: 'string', format: 'dateTime', required: true }]
      };
      const raw = 'when: Invalid string: must match pattern /local-date-time/; other: Missing input';
      render(
        <FormPreviewPanel schema={schema} status={{ state: 'ready', targetId: schema.targetId }} onExecute={vi.fn()} />
      );
      await act(async () => {
        const postMessage = vi.fn();
        usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
        usePreviewStore.getState().dispatchExecute(schema.targetId, { when: 'invalid' });
        usePreviewStore.getState().receiveExecutionError(schema.targetId, raw, postMessage.mock.lastCall![0].requestId);
      });
      expect(screen.getByText(/when: Enter a local date and time/)).toHaveTextContent('without a UTC offset');
      expect(screen.getByText(/when: Enter a local date and time/)).toHaveTextContent('other: Missing input');
      expect(usePreviewStore.getState().executionResults.get(schema.targetId)?.error).toBe(raw);
      expect(useOutputStore.getState().lines.some((line) => line.text.includes(raw))).toBe(true);
    });

    it('runs the function using the qualified targetId, not the bare title', async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();

      await act(async () => {
        render(
          <FormPreviewPanel
            schema={calcTradeSchema}
            status={{ state: 'ready', targetId: calcTradeSchema.targetId }}
            onExecute={onExecute}
          />
        );
      });

      await user.click(screen.getByRole('button', { name: 'Run' }));

      expect(onExecute).toHaveBeenCalledWith('beta.CalcTrade', {});
      expect(onExecute).not.toHaveBeenCalledWith('CalcTrade', expect.anything());
    });

    it('runs on the first click after editing inputs without asking the data-type validator to validate a function', async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();
      const postMessage = vi.fn();
      usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
      const schema: FormPreviewSchema = {
        ...calcTradeSchema,
        fields: [
          { path: 's1', label: 'S1', kind: 'string', required: false },
          { path: 's2', label: 'S2', kind: 'string', required: false }
        ]
      };
      render(
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready', targetId: schema.targetId }}
          onExecute={onExecute}
        />
      );

      await user.type(screen.getByRole('textbox', { name: 'S1' }), 'hello');
      await user.type(screen.getByRole('textbox', { name: 'S2' }), 'hello');
      await user.click(screen.getByRole('button', { name: 'Run' }));

      expect(onExecute).toHaveBeenCalledExactlyOnceWith('beta.CalcTrade', { s1: 'hello', s2: 'hello' });
      expect(postMessage).not.toHaveBeenCalled();
      expect(screen.getByText('Ready to run function')).toBeInTheDocument();
    });
  });
});

it('focuses the indexed enum item selected from validation details', async () => {
  const schema: FormPreviewSchema = {
    ...tradeSchema,
    fields: [
      {
        path: 'sides',
        label: 'Sides',
        kind: 'array',
        required: false,
        children: [
          {
            path: 'sides[]',
            label: 'Side',
            kind: 'enum',
            required: true,
            enumValues: [
              { value: 'Buy', label: 'Buy' },
              { value: 'Sell', label: 'Sell' }
            ]
          }
        ]
      }
    ]
  };
  function Fixture() {
    const root = useRef<HTMLElement>(null);
    return (
      <section ref={root}>
        <WorkflowValidation
          name="Input"
          root={root}
          validation={{ state: 'invalid', diagnostics: [{ path: 'sides[1]', message: 'Review this side' }] }}
        />
        <FormPreviewPanel
          schema={schema}
          status={{ state: 'ready', targetId: schema.targetId }}
          values={{ sides: ['Buy', 'Sell'] }}
          onValuesChange={() => {}}
        />
      </section>
    );
  }
  render(<Fixture />);
  const user = userEvent.setup({ writeToClipboard: false });
  await user.click(screen.getByRole('button', { name: /Input: 1 issue/ }));
  await user.click(screen.getByRole('button', { name: /sides\[1\]: Review this side/ }));
  await vi.waitFor(() => expect(screen.getAllByRole('combobox')[1]).toHaveFocus());
  expect(screen.getAllByRole('combobox')[0].closest('[data-field-path]')).toHaveAttribute(
    'data-field-path',
    'sides[0]'
  );
});

it('guides untouched empty numbers neutrally, then shows a friendly required error after blur', () => {
  const schema: FormPreviewSchema = {
    schemaVersion: 1,
    targetId: 'test.Amount',
    title: 'Amount',
    status: 'ready',
    fields: [{ path: 'amount', label: 'Amount', kind: 'number', required: true }]
  };
  const change = vi.fn();
  render(
    <FormPreviewPanel
      schema={schema}
      status={{ state: 'ready', targetId: schema.targetId }}
      values={{ amount: '' }}
      errors={{ amount: 'Invalid input: expected number, received string' }}
      valid={false}
      validated
      onValuesChange={change}
    />
  );
  const input = screen.getByRole('spinbutton', { name: 'Amount' });
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(input).toHaveAttribute('placeholder', 'Required');
  fireEvent.blur(input);
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Amount is required.')).toBeVisible();
  expect(screen.queryByText(/expected number/)).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it('retains confirmed numeric constraint errors and uses plain language for a nonnumeric imported value', () => {
  const schema: FormPreviewSchema = {
    schemaVersion: 1,
    targetId: 'test.Number',
    title: 'Number',
    status: 'ready',
    fields: [{ path: 'amount', label: 'Amount', kind: 'number', required: true }]
  };
  const props = {
    schema,
    status: { state: 'ready' as const, targetId: schema.targetId },
    valid: false,
    validated: true,
    onValuesChange: vi.fn()
  };
  const view = render(
    <FormPreviewPanel
      {...props}
      values={{ amount: 'bad import' }}
      errors={{ amount: 'Invalid input: expected number, received string' }}
    />
  );
  expect(screen.getByRole('spinbutton', { name: 'Amount' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Enter a number for Amount.')).toBeVisible();
  view.rerender(<FormPreviewPanel {...props} values={{ amount: -1 }} errors={{ amount: 'Must be positive' }} />);
  expect(screen.getByText('Must be positive')).toBeVisible();
});
