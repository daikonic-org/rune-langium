// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for FunctionForm component (T052).
 *
 * Covers:
 * - Form renders inputs/output/expression for a loaded Function
 * - Add/remove input parameter
 * - Output type selection
 * - Expression textarea validation on blur
 * - Expression error clears on typing
 * - Name editing triggers renameType
 * - Function badge renders
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FunctionForm } from '../../src/components/editors/FunctionForm.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';
import { modelsToAst } from '../../src/adapters/model-to-ast.js';
import { createEditorStore } from '../../src/store/editor-store.js';
import { ExpressionBuilder } from '../../src/components/editors/expression-builder/ExpressionBuilder.js';
import type { AnyGraphNode, TypeOption, EditorFormActions } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';
import { TYPE_REF_PAYLOAD_MIME, typeRefMimeForKind } from '../../src/types/structure-view.js';
import type { TypeRefPayload } from '../../src/types/structure-view.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(overrides: Partial<EditorFormActions<'func'>> = {}): EditorFormActions<'func'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addInputParam: vi.fn(),
    removeInputParam: vi.fn(),
    updateInputParam: vi.fn(),
    reorderInputParam: vi.fn(),
    updateOutputType: vi.fn(),
    setFunctionParent: vi.fn(),
    updateExpression: vi.fn(),
    validate: vi.fn().mockReturnValue([]),
    ...overrides
  };
}

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'test.model.Trade', label: 'Trade', kind: 'data', namespace: 'test.model' },
  { value: 'test.model.Price', label: 'Price', kind: 'data', namespace: 'test.model' },
  { value: 'builtin::number', label: 'number', kind: 'builtin' },
  { value: 'builtin::string', label: 'string', kind: 'builtin' }
];

// Extends field's TypeReferenceField drop target — see the
// 'FunctionForm – Extends (superFunction)' describe block below.
function buildDataTransfer(payload: TypeRefPayload): DataTransfer {
  const store = new Map<string, string>();
  store.set(TYPE_REF_PAYLOAD_MIME, JSON.stringify(payload));
  store.set(typeRefMimeForKind(payload.kind), '');
  return {
    types: Array.from(store.keys()),
    getData: (mime: string) => store.get(mime) ?? '',
    setData: () => {},
    dropEffect: '' as DataTransfer['dropEffect'],
    effectAllowed: 'link' as DataTransfer['effectAllowed']
  } as unknown as DataTransfer;
}

const EXTENDS_TYPES: TypeOption[] = [
  ...AVAILABLE_TYPES,
  { value: 'test.model.BaseFunction', label: 'BaseFunction', kind: 'func', namespace: 'test.model' }
];

function makeFuncData(overrides: Partial<AnyGraphNode> = {}): AnyGraphNode {
  return {
    $type: 'RosettaFunction',
    name: 'CalculateNotional',
    namespace: 'test.model',
    inputs: [
      {
        $type: 'Attribute',
        name: 'trade',
        typeCall: { $type: 'TypeCall', type: { $refText: 'Trade' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      },
      {
        $type: 'Attribute',
        name: 'price',
        typeCall: { $type: 'TypeCall', type: { $refText: 'Price' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      }
    ],
    output: { typeCall: { $type: 'TypeCall', type: { $refText: 'number' } } },
    expressionText: 'trade -> price -> amount',
    conditions: [],
    postConditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: [],
    ...overrides
  } as AnyGraphNode;
}

describe('continuous implementation host', () => {
  it('does not flush a queued signature edit over a newer invalid body draft', async () => {
    vi.useFakeTimers();
    const data = makeFuncData();
    const actions = makeActions();
    const props = {
      nodeId: 'test.model.CalculateNotional',
      data,
      meta: testMeta(),
      actions,
      availableTypes: AVAILABLE_TYPES
    };
    const { rerender, unmount } = render(<FunctionForm {...props} />);
    fireEvent.change(screen.getByLabelText('Function type name'), { target: { value: 'Renamed' } });
    rerender(<FunctionForm {...props} structuralEditsDisabled />);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(actions.renameType).not.toHaveBeenCalled();
    unmount();
    vi.useRealTimers();
  });
  it('mounts one host instead of operation cards and duplicate conditions', () => {
    const data = makeFuncData({
      operations: [{ $type: 'Operation', expression: { $type: 'RosettaIntLiteral', value: 1 } }],
      conditions: [{ $type: 'Condition', name: 'Good', expression: { $type: 'RosettaBooleanLiteral', value: true } }]
    });
    const host = vi.fn(({ nodeId, readOnly }) => (
      <div data-testid="body-host">
        {nodeId}:{String(readOnly)}
      </div>
    ));
    render(
      <FunctionForm
        nodeId="test.model.CalculateNotional"
        data={data}
        meta={testMeta()}
        actions={makeActions()}
        availableTypes={AVAILABLE_TYPES}
        renderFunctionBodyEditor={host}
        structuralEditsDisabled
      />
    );
    expect(screen.getAllByTestId('body-host')).toHaveLength(1);
    expect(screen.queryByLabelText('Function operation 1')).toBeNull();
    expect(screen.queryByText('Good')).toBeNull();
    expect(host).toHaveBeenLastCalledWith({ nodeId: 'test.model.CalculateNotional', readOnly: false });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FunctionForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls addInputParam when add-input button is clicked with name filled', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({ inputs: [] } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText('New input parameter name');
    fireEvent.change(nameInput, { target: { value: 'quantity' } });

    // Post-icon-button migration: "+ Add Input" is now an icon-only
    // <Button> with aria-label="Add input".
    const addBtn = screen.getByLabelText('Add input');
    fireEvent.click(addBtn);

    expect(actions.addInputParam).toHaveBeenCalledWith('fn1', 'quantity', 'string');
  });

  it('calls removeInputParam when remove button is clicked', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // AttributeRow uses aria-label "Remove attribute {name}" (the generic
    // remove affordance shared with DataTypeForm rows).
    const removeButtons = screen.getAllByLabelText(/Remove attribute/i);
    fireEvent.click(removeButtons[0]!);

    expect(actions.removeInputParam).toHaveBeenCalledWith('fn1', 'trade');
  });

  it('shows expression error on blur when parentheses are unbalanced', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({ expressionText: '' } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const textarea = screen.getByLabelText('Function expression');
    fireEvent.change(textarea, { target: { value: '(trade -> price' } });
    fireEvent.blur(textarea);

    expect(screen.getByText(/expecting|unexpected/i)).toBeInTheDocument();
    expect(actions.updateExpression).not.toHaveBeenCalled();
  });

  it('clears expression error on typing after a validation error', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({ expressionText: '' } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const textarea = screen.getByLabelText('Function expression');

    // Produce error
    fireEvent.change(textarea, { target: { value: '(' } });
    fireEvent.blur(textarea);
    expect(screen.getByText(/expecting|unexpected/i)).toBeInTheDocument();

    // Resume typing — error should clear
    fireEvent.change(textarea, { target: { value: '(trade)' } });
    expect(screen.queryByText(/expecting|unexpected/i)).not.toBeInTheDocument();
  });

  it('commits valid expression on blur', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({ expressionText: '' } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const textarea = screen.getByLabelText('Function expression');
    fireEvent.change(textarea, { target: { value: 'trade -> price -> amount' } });
    fireEvent.blur(textarea);

    expect(actions.updateExpression).toHaveBeenCalledWith('fn1', 'trade -> price -> amount');
  });

  it('renames function after debounced name change', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText('Function type name');
    fireEvent.change(nameInput, { target: { value: 'ComputePrice' } });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(actions.renameType).toHaveBeenCalledWith('fn1', 'ComputePrice');
  });

  it('shows empty state when no input parameters exist', () => {
    const actions = makeActions();
    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({ inputs: [] } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    expect(screen.getByText('No input parameters defined.')).toBeInTheDocument();
  });

  it('input rows render an editable name input and type-picker trigger', () => {
    const actions = makeActions();
    const { container } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Each input renders as an AttributeRow (data-slot="attribute-row").
    const rows = container.querySelectorAll('[data-slot="attribute-row"]');
    expect(rows.length).toBe(2);

    // The first row has an enabled name input (not disabled).
    const firstRow = rows[0]!;
    const nameInput = firstRow.querySelector('[data-slot="attribute-name"]') as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.disabled).toBe(false);

    // The first row has a type-picker trigger (TypeReferenceField chip).
    const typePicker = firstRow.querySelector('[data-slot="type-picker-trigger"], [data-slot="type-selector"]');
    expect(typePicker).not.toBeNull();
  });

  it('calls updateInputParam when an input row name changes (after debounce)', () => {
    const actions = makeActions();
    const { container } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const rows = container.querySelectorAll('[data-slot="attribute-row"]');
    const nameInput = rows[0]!.querySelector('[data-slot="attribute-name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'instrument' } });

    // Not fired yet (debounce window)
    expect(actions.updateInputParam).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // targetTypeId is undefined when the update originates from a name change (no type re-selection).
    expect(actions.updateInputParam).toHaveBeenCalledWith('fn1', 'trade', 'instrument', 'Trade', '(1..1)', undefined);
  });

  it('calls reorderInputParam when handleReorderInput is invoked via drag', () => {
    const actions = makeActions();
    const { container } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Simulate drag-drop: drag first row onto the second.
    const rows = container.querySelectorAll('[data-slot="attribute-row"]');
    const sourceRow = rows[0]!;
    const targetRow = rows[1]!;

    fireEvent.dragStart(sourceRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    // Set the transfer data so the drop handler can read it.
    const dt = { data: {} as Record<string, string> };
    fireEvent.dragStart(sourceRow, {
      dataTransfer: {
        setData: (k: string, v: string) => {
          dt.data[k] = v;
        },
        effectAllowed: 'move'
      }
    });
    fireEvent.dragOver(targetRow, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(targetRow, {
      dataTransfer: {
        getData: (k: string) => (k === 'text/plain' ? '0' : '')
      }
    });

    expect(actions.reorderInputParam).toHaveBeenCalledWith('fn1', 0, 1);
  });
});

describe('FunctionForm operation locality', () => {
  it.each([
    { draft: 'foo +', valid: false },
    { draft: '"("', valid: true }
  ])('validates operation 1 draft $draft before serializing it', async ({ draft, valid }) => {
    const parsed = await parse(`namespace test.operation_draft
func Format:
 output: result string (1..1)
 set result: "first"
 set result: "second"
`);
    expect(parsed.hasErrors).toBe(false);
    const store = createEditorStore();
    store.getState().loadModels(parsed.value);
    const node = store.getState().nodes.find((entry) => entry.data.name === 'Format')!;
    const before = (node.data as any).operations;
    render(
      <FunctionForm nodeId={node.id} meta={node.meta} data={node.data} availableTypes={[]} actions={store.getState()} />
    );
    const editor = screen.getByLabelText('Function operation 2');
    fireEvent.change(editor, { target: { value: draft } });
    fireEvent.blur(editor);
    expect(editor).toHaveValue(draft);
    const state = store.getState();
    const after = (state.nodes.find((entry) => entry.id === node.id)!.data as any).operations;
    expect(after[0]).toEqual(before[0]);
    if (valid) expect(after[1].expression.text).toBe(draft);
    else expect(after).toEqual(before);
    const text = renderModel(modelsToAst(state.nodes, state.edges)[0]!);
    expect((await parse(text)).hasErrors).toBe(false);
    if (valid) expect(text).toContain(draft);
    else expect(text).not.toContain(draft);
  });

  it('editing operation 1 leaves operation 0 and sibling operations unchanged', async () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/function-multi-operation.rosetta'),
      'utf8'
    );
    const parsed = await parse(source);
    expect(parsed.parserErrors).toEqual([]);
    const store = createEditorStore();
    store.getState().loadModels(parsed.value);
    const node = store.getState().nodes.find((n) => n.data.name === 'Summarize')!;
    const before = (node.data as any).operations;
    expect(before).toHaveLength(10);
    render(
      <FunctionForm
        nodeId={node.id}
        meta={node.meta}
        data={node.data}
        availableTypes={[]}
        actions={store.getState()}
        renderExpressionEditor={(props) => (
          <ExpressionBuilder {...props} scope={{ inputs: [], output: null, aliases: [] }} />
        )}
      />
    );
    fireEvent.click(screen.getAllByTestId('tab-text')[1]!);
    fireEvent.change(screen.getByTestId('text-editor'), { target: { value: '42' } });
    fireEvent.blur(screen.getByTestId('text-editor'));
    const after = (store.getState().nodes.find((n) => n.id === node.id)!.data as any).operations;
    expect(after[0]).toEqual(before[0]);
    expect(after[1].expression.text).toBe('42');
    expect(after[1].path).toEqual(before[1].path);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(screen.getByText('set result -> average')).toBeVisible();
  });

  it('keeps independent operation drafts and validation errors', () => {
    const operations = ['1', '2'].map((text) => ({
      $type: 'Operation',
      add: false,
      assignRoot: { $refText: 'result' },
      expression: { $type: 'RawDsl', text }
    }));
    const actions = makeActions();
    render(
      <FunctionForm
        nodeId="fn1"
        meta={testMeta('test.model')}
        data={makeFuncData({ operations } as any)}
        availableTypes={[]}
        actions={actions}
      />
    );
    const editors = screen.getAllByRole('textbox').filter((e) => e.tagName === 'TEXTAREA');
    fireEvent.change(editors[0]!, { target: { value: '(1' } });
    fireEvent.blur(editors[0]!);
    fireEvent.change(editors[1]!, { target: { value: '42' } });
    fireEvent.blur(editors[1]!);
    expect(editors[0]).toHaveValue('(1');
    expect(actions.updateExpression).toHaveBeenCalledExactlyOnceWith('fn1', '42', 1);
    expect(actions.updateExpression).not.toHaveBeenCalledWith('fn1', '(1', 0);
    expect(screen.getByText(/expecting|unexpected/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// US3 (Phase 5c) TDD tests (FT1–FT4) — z2f migration contract
// ---------------------------------------------------------------------------

// Spy on the upstream useExternalSync hook so FT3 can assert the migration
// adopted it (vs. a local sync component or hand-rolled effect).
const useExternalSyncSpy = vi.fn();
vi.mock('@zod-to-form/react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@zod-to-form/react');
  return {
    ...actual,
    useExternalSync: (...args: unknown[]) => {
      useExternalSyncSpy(...args);
      return (actual as any).useExternalSync(...(args as Parameters<typeof actual.useExternalSync>));
    }
  };
});

describe('FunctionForm – US3 (Phase 5c) z2f migration contract (FT1–FT4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useExternalSyncSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // FT1 — leaf field labels + tab order (name, output, expressionText, …)
  it('renders the documented leaf-field set and preserves tab order', () => {
    const data = makeFuncData();
    (data as any).definition = 'Computes the notional';
    // `comments` is UI metadata (node.meta sibling) — seeded into form state
    // from `meta`, not from the domain payload.
    const { container } = render(
      <FunctionForm
        meta={testMeta('test.model', { comments: 'Initial comments' })}
        nodeId="fn1"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // Name must be the first text input in the form-header slot.
    const header = container.querySelector('[data-slot="type-header"]')!;
    const nameInput = header.querySelector('input[type="text"], input:not([type])');
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).value).toBe('CalculateNotional');

    // The expression editor textarea is rendered (renders the expressionText
    // form value when no shortcuts/operations exist on the AST).
    const expressionTextarea = container.querySelector('[data-slot="expression-editor"]');
    expect(expressionTextarea).not.toBeNull();
    expect((expressionTextarea as HTMLTextAreaElement).value).toBe('trade -> price -> amount');

    expect(container.querySelector('[data-slot="metadata-description"]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Doc', exact: true }));
    // Documentation activates the shared section; authored comments remain Source-only.
    const descriptionTextarea = container.querySelector('[data-slot="metadata-description"]');
    const commentsTextarea = container.querySelector('[data-slot="metadata-comments"]');
    expect(descriptionTextarea).not.toBeNull();
    expect(commentsTextarea).toBeNull();
    expect((descriptionTextarea as HTMLTextAreaElement).value).toBe('Computes the notional');

    // Visited implementation and documentation fields preserve their document order.
    const slotOrder = Array.from(
      container.querySelectorAll(
        'input[data-slot="type-name-input"], textarea[data-slot="expression-editor"], textarea[data-slot="metadata-description"], textarea[data-slot="metadata-comments"]'
      )
    ).map((el) => el.getAttribute('data-slot'));
    expect(slotOrder).toEqual(['type-name-input', 'expression-editor', 'metadata-description']);
  });

  // FT2 — debounced rename fires exactly once with the new name
  it('fires actions.renameType exactly once after a single debounce window on name edit', () => {
    const renameType = vi.fn();
    const actions = { ...makeActions(), renameType };

    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/function type name/i);

    // Type rapidly — three changes coalesced inside the debounce window
    fireEvent.change(nameInput, { target: { value: 'Calc' } });
    fireEvent.change(nameInput, { target: { value: 'Calculate' } });
    fireEvent.change(nameInput, { target: { value: 'ComputePrice' } });

    expect(renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(renameType).toHaveBeenCalledTimes(1);
    expect(renameType).toHaveBeenCalledWith('fn1', 'ComputePrice');
  });

  // FT3 — useExternalSync contract: form repopulates pristine fields when
  // `data` reference changes
  it('repopulates pristine values when `data` reference changes (external sync)', () => {
    const actions = makeActions();
    const nodeA = makeFuncData(); // name: 'CalculateNotional'
    const nodeB = makeFuncData({
      name: 'PriceTrade',
      definition: 'Prices a trade'
    } as any);

    const { container, rerender } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={nodeA}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const initialName = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(initialName.value).toBe('CalculateNotional');

    // Swap to nodeB (new reference identity)
    rerender(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={nodeB}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Pristine name field reflects nodeB after the swap.
    const swappedName = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(swappedName.value).toBe('PriceTrade');

    // Migration contract: the upstream useExternalSync hook is the
    // integration surface. The spy is invoked at least once on initial
    // mount + once after the data swap.
    expect(useExternalSyncSpy).toHaveBeenCalled();
    const lastCall = useExternalSyncSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(nodeB);
  });

  // FT4 — Function-specific: edits to an input row and edits to the output
  // row dispatch independently. The add/remove input affordances never
  // fire output-side actions, and conversely an output-side data swap
  // never replays as an input-side action. This proves the two sections
  // of the form are wired to disjoint action callbacks with no crosstalk
  // — the central invariant of the Function form's split-section model.
  it('input-row and output-row edits dispatch independently with no crosstalk', () => {
    const actions = makeActions();

    const { rerender } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // ---- Edit an input row: add a parameter ------------------------------
    const newParamName = screen.getByLabelText(/new input parameter name/i);
    fireEvent.change(newParamName, { target: { value: 'quantity' } });
    fireEvent.click(screen.getByLabelText('Add input'));

    expect(actions.addInputParam).toHaveBeenCalledTimes(1);
    expect(actions.addInputParam).toHaveBeenCalledWith('fn1', 'quantity', 'string');
    // The output-side actions did NOT fire as a side effect of the input edit.
    expect(actions.updateOutputType).not.toHaveBeenCalled();
    expect(actions.updateExpression).not.toHaveBeenCalled();

    // ---- Edit an input row: remove a parameter --------------------------
    // AttributeRow uses aria-label "Remove attribute {name}" (shared with
    // DataTypeForm — DRY / R-func-input).
    const removeButtons = screen.getAllByLabelText(/remove attribute/i);
    fireEvent.click(removeButtons[0]!);

    expect(actions.removeInputParam).toHaveBeenCalledTimes(1);
    // Removing an input also did not crosstalk into the output handlers.
    expect(actions.updateOutputType).not.toHaveBeenCalled();
    expect(actions.updateExpression).not.toHaveBeenCalled();

    // ---- Swap the output side via an external-sync data change ----------
    // The output's bespoke <TypeSelector> wraps a shadcn <Select> whose
    // dropdown is unreliable to drive in JSDOM. We instead exercise the
    // declarative output path: a new graph node arrives whose only delta
    // from the prior node is `output.typeCall`. The external-sync hook
    // re-binds the form; the OutputType fieldset re-reads from
    // `data.output.typeCall`. The contract under test is that this
    // sync path does NOT fire any input-side action as a side effect.

    const addInputCallsBeforeOutput = (actions.addInputParam as ReturnType<typeof vi.fn>).mock.calls.length;
    const removeInputCallsBeforeOutput = (actions.removeInputParam as ReturnType<typeof vi.fn>).mock.calls.length;

    rerender(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={makeFuncData({
          output: {
            typeCall: { $type: 'TypeCall', type: { $refText: 'Price' } }
          }
        } as any)}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    expect((actions.addInputParam as ReturnType<typeof vi.fn>).mock.calls.length).toBe(addInputCallsBeforeOutput);
    expect((actions.removeInputParam as ReturnType<typeof vi.fn>).mock.calls.length).toBe(removeInputCallsBeforeOutput);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 (expression-language-lens) — renderExpressionEditor slot contract
// ---------------------------------------------------------------------------
//
// Proves the central premise of the Phase 2 plan: FunctionForm threads each
// operation's/alias's/empty-state's *bare RHS expression text* (not the full
// `set output: <expr>` / `add x: <expr>` statement) through the same
// renderExpressionEditor slot ConditionSection uses, so Phase 1's
// LanguageLensEditor (unmodified) already works for function bodies with
// zero new code. See docs/superpowers/plans/2026-07-12-expression-language-lens-phase2.md.
//
// The alias (shortcut) slot is covered too, but only for reachability/text
// shape — its onChange is a deliberate no-op today (alias editing isn't
// implemented via ANY editor yet, not just the lens; see FunctionForm.tsx's
// own alias-rendering block), so there is no commit flow to assert there.

describe('FunctionForm – renderExpressionEditor slot contract (Phase 2 verification)', () => {
  it('passes the bare RHS expression text (not the full set/add statement) to renderExpressionEditor for an existing operation', () => {
    const data = makeFuncData({
      operations: [
        {
          $type: 'Operation',
          add: false,
          assignRoot: { $refText: 'result' },
          expression: { $type: 'RawDsl', text: 'principal * rate', $cstNode: { text: 'principal * rate' } }
        }
      ]
    } as any);

    const renderExpressionEditor = vi.fn((props: any) => <div data-testid="slot-value">{props.value}</div>);

    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        renderExpressionEditor={renderExpressionEditor}
      />
    );

    expect(renderExpressionEditor).toHaveBeenCalled();
    const call = renderExpressionEditor.mock.calls.find((c: any) => c[0].value === 'principal * rate');
    expect(
      call,
      'renderExpressionEditor must receive the bare RHS text, not "set result: principal * rate"'
    ).toBeDefined();
  });

  it('renders an alias (shortcut) as static text and never calls renderExpressionEditor for it', () => {
    // Aliases are derived, non-editable content regardless of isReadOnly —
    // renderExpressionEditor's rich editor has no readOnly awareness of its
    // own, so calling it (even with a no-op onChange) let users type inside
    // a fully-interactive-looking ExpressionBuilder whose changes silently
    // never persisted (Codex review, PR #494). The bare RHS text must still
    // render, just statically.
    const data = makeFuncData({
      operations: [],
      shortcuts: [
        {
          $type: 'ShortcutDeclaration',
          name: 'discountedRate',
          expression: { $type: 'RawDsl', text: 'rate * 0.9', $cstNode: { text: 'rate * 0.9' } }
        }
      ]
    } as any);

    const renderExpressionEditor = vi.fn((props: any) => <div data-testid="slot-value">{props.value}</div>);
    const actions = makeActions();

    const { container } = render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
        renderExpressionEditor={renderExpressionEditor}
      />
    );

    expect(renderExpressionEditor).not.toHaveBeenCalled();
    const aliasSection = container.querySelector('[data-slot="alias-section"]');
    expect(aliasSection?.textContent).toContain('rate * 0.9');
  });

  it('offers an empty-state expression slot when the function has no operations yet, and its onChange reaches updateExpression via the form field on blur', () => {
    const data = makeFuncData({ operations: [], shortcuts: [], expressionText: '' } as any);
    const renderExpressionEditor = vi.fn((props: any) => (
      <div>
        <button type="button" data-testid="commit" onClick={() => props.onChange('x + 1')}>
          commit
        </button>
        <button type="button" data-testid="commit-blur" onClick={() => props.onBlur()}>
          blur
        </button>
      </div>
    ));
    const actions = makeActions();

    render(
      <FunctionForm
        meta={testMeta('test.model')}
        nodeId="fn1"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
        renderExpressionEditor={renderExpressionEditor}
      />
    );

    expect(renderExpressionEditor).toHaveBeenCalled();

    // The empty-state slot's onChange commits through the form field
    // (field.onChange), not directly through actions.updateExpression —
    // updateExpression only fires on blur, via handleExpressionBlur (see
    // the 'commits valid expression on blur' test above for the same
    // onChange-then-blur mechanism against the plain-Textarea fallback).
    fireEvent.click(screen.getByTestId('commit'));
    expect(actions.updateExpression).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('commit-blur'));
    expect(actions.updateExpression).toHaveBeenCalledWith('fn1', 'x + 1');
  });

  // See Codex review, PR #494: a refOnly node's domain/graph-level errors
  // must stay visible once it routes into FunctionForm instead of OtherForm.
  it('renders domain/graph-level validation errors from node meta', () => {
    render(
      <FunctionForm
        meta={testMeta('test.model', {
          errors: [{ nodeId: 'fn1', severity: 'error', message: 'Circular inheritance detected' }]
        })}
        nodeId="fn1"
        data={makeFuncData()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );
    expect(screen.getByText('Circular inheritance detected')).toBeDefined();
  });

  // See Codex review, PR #494: InheritedMembersSection alone isn't an
  // equivalent fallback for a refOnly Function's superFunction -- it
  // renders nothing when the parent is unresolved or has no inputs. The
  // Extends field must show the ref text regardless of resolution, and
  // (per follow-up: function inheritance was never editable at all,
  // unlike Data/Enum's own Extends fields) must be a real editable
  // selector, not a static display.
  describe('FunctionForm – Extends (superFunction)', () => {
    it('shows the superFunction ref text even when the parent cannot be resolved', () => {
      render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData({ superFunction: { $refText: 'BaseFunction' } } as any)}
          availableTypes={AVAILABLE_TYPES}
          actions={makeActions()}
          // No `allNodes`/nodeRepository supplied -- superFunction is
          // unresolvable, so InheritedMembersSection's own groups are empty.
        />
      );

      expect(screen.getByText('Extends')).toBeDefined();
      expect(screen.getByText('BaseFunction')).toBeDefined();
    });

    it('shows the empty-state placeholder when the function has no superFunction', () => {
      render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData()}
          availableTypes={AVAILABLE_TYPES}
          actions={makeActions()}
        />
      );

      expect(screen.getByText('No parent function')).toBeDefined();
    });

    it('accepts a Func drop on the Extends TypeReferenceField (calls setFunctionParent)', () => {
      const setFunctionParent = vi.fn();
      const { container } = render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData()}
          availableTypes={EXTENDS_TYPES}
          actions={makeActions({ setFunctionParent })}
        />
      );

      // The Extends TypeReferenceField is the first [data-slot="type-reference"]
      // drop target -- it appears before the per-input AttributeRow fields.
      const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
      expect(dropTargets.length).toBeGreaterThan(0);
      const extendsDropTarget = dropTargets[0]!;

      const funcPayload: TypeRefPayload = {
        rune: 'type-ref',
        namespaceUri: 'test.model',
        typeId: 'test.model.BaseFunction',
        typeName: 'BaseFunction',
        kind: 'Func'
      };

      act(() => {
        fireEvent.drop(extendsDropTarget, { dataTransfer: buildDataTransfer(funcPayload) });
      });

      expect(setFunctionParent).toHaveBeenCalledWith('fn1', 'test.model.BaseFunction');
    });

    it('rejects a Data drop on the Extends TypeReferenceField (does not call setFunctionParent)', () => {
      const setFunctionParent = vi.fn();
      const { container } = render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData()}
          availableTypes={EXTENDS_TYPES}
          actions={makeActions({ setFunctionParent })}
        />
      );

      const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
      const extendsDropTarget = dropTargets[0]!;

      const dataPayload: TypeRefPayload = {
        rune: 'type-ref',
        namespaceUri: 'test.model',
        typeId: 'test.model.Trade',
        typeName: 'Trade',
        kind: 'Data'
      };

      act(() => {
        fireEvent.drop(extendsDropTarget, { dataTransfer: buildDataTransfer(dataPayload) });
      });

      expect(setFunctionParent).not.toHaveBeenCalled();
    });

    it('disables the Extends field when the function is read-only', () => {
      const { container } = render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData()}
          availableTypes={EXTENDS_TYPES}
          actions={makeActions()}
          readOnly
        />
      );

      const extendsTrigger = container.querySelector('[data-slot="type-reference"] [data-slot="type-picker-trigger"]');
      expect(extendsTrigger).not.toBeNull();
      expect(extendsTrigger).toBeDisabled();
    });

    // See Codex review, PR #494: resolving a bare superFunction ref against
    // the FULL (unfiltered) availableTypes list risked a same-named option
    // of a different kind winning the bare-label match instead of the real
    // function. TypeChip's `data-kind` attribute (mapped only for
    // Data/Choice/Enum/Record/TypeAlias/BasicType, not Func) makes this
    // observable: if the wrong-kind decoy won, the chip would show
    // data-kind="Data" instead of the unmapped 'Unresolved' fallback.
    it('resolves the func-kind parent, not a same-named option of a different kind', () => {
      const decoyAndRealOptions: TypeOption[] = [
        // Decoy appears FIRST in array order -- with the pre-fix bug
        // (matching against the unfiltered availableTypes list), this
        // wrong-kind option would win the bare-label match.
        { value: 'test.model.BaseFunction', label: 'BaseFunction', kind: 'data', namespace: 'test.model' },
        { value: 'other.BaseFunction', label: 'BaseFunction', kind: 'func', namespace: 'other' }
      ];
      const { container } = render(
        <FunctionForm
          meta={testMeta('test.model')}
          nodeId="fn1"
          data={makeFuncData({ superFunction: { $refText: 'BaseFunction' } } as any)}
          availableTypes={decoyAndRealOptions}
          actions={makeActions()}
        />
      );

      const extendsTrigger = container.querySelector('[data-slot="type-reference"] [data-slot="type-picker-trigger"]');
      expect(extendsTrigger).not.toBeNull();
      expect(extendsTrigger?.getAttribute('data-kind')).not.toBe('Data');
    });
  });
});
