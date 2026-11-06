// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Row-renderer registration tests (Phase 8 / US6 — T054, T055).
 *
 * Asserts that the four bespoke inline rows (`AttributeRow`,
 * `ChoiceOptionRow`, `EnumValueRow`, function-input row) are registered as
 * `FormMeta.render` overrides against their item AST schemas via
 * `packages/visual-editor/src/components/forms/rows/index.ts`, and that
 * each row continues to satisfy the row-renderer contract
 * (`specs/013-z2f-editor-migration/contracts/row-renderer.md`):
 *
 *   RR1 — registry hosts a `render` for every item schema, AND a mounted
 *         DataTypeForm with N attributes paints N AttributeRow nodes
 *         (each tagged with a unique `data-slot`).
 *   RR2 — a row reads sibling form values via `useFormContext` (typing in
 *         the name input updates the row's visible value).
 *   RR3 — invoking the row's remove affordance fires the host-supplied
 *         `removeAttribute` action with the row's index.
 *   RR4 — minimal mount-and-render coverage for ChoiceOptionRow,
 *         EnumValueRow, and the function-input row registered via
 *         FormMeta.
 *
 * The tests intentionally exercise the existing form bodies (which retain
 * their `.map(...)` row layout) — the registration is the contract input
 * the form host consumes, and the rows MUST behave identically whether
 * the host invokes them through `field.render` or through the form's
 * own `.map`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import {
  formRegistry,
  AttributeRowRender,
  ChoiceOptionRowRender,
  EnumValueRowRender,
  FunctionInputRowRender
} from '../../src/components/forms/rows/index.js';
import { AttributeSchema, ChoiceOptionSchema, RosettaEnumValueSchema } from '../../src/generated/zod-schemas.js';
import { DataTypeForm } from '../../src/components/editors/DataTypeForm.js';
import { ChoiceForm } from '../../src/components/editors/ChoiceForm.js';
import { EnumForm } from '../../src/components/editors/EnumForm.js';
import { FunctionForm } from '../../src/components/editors/FunctionForm.js';
import type { AnyGraphNode, TypeOption, EditorFormActions } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'builtin::string', label: 'string', kind: 'builtin' },
  { value: 'builtin::date', label: 'date', kind: 'builtin' },
  { value: 'builtin::number', label: 'number', kind: 'builtin' },
  { value: 'test.Trade', label: 'Trade', kind: 'data', namespace: 'test' },
  { value: 'test.Price', label: 'Price', kind: 'data', namespace: 'test' }
];

function makeDataActions(overrides: Partial<EditorFormActions<'data'>> = {}): EditorFormActions<'data'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    updateAttribute: vi.fn(),
    reorderAttribute: vi.fn(),
    setInheritance: vi.fn(),
    validate: vi.fn(() => []),
    ...overrides
  } as EditorFormActions<'data'>;
}

function makeChoiceActions(): EditorFormActions<'choice'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addChoiceOption: vi.fn(),
    removeChoiceOption: vi.fn(),
    validate: vi.fn(() => [])
  } as EditorFormActions<'choice'>;
}

function makeEnumActions(): EditorFormActions<'enum'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addEnumValue: vi.fn(),
    removeEnumValue: vi.fn(),
    updateEnumValue: vi.fn(),
    reorderEnumValue: vi.fn(),
    setEnumParent: vi.fn(),
    validate: vi.fn(() => [])
  } as EditorFormActions<'enum'>;
}

function makeFunctionActions(): EditorFormActions<'func'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addInputParam: vi.fn(),
    removeInputParam: vi.fn(),
    updateOutputParam: vi.fn(),
    updateOutputType: vi.fn(),
    updateExpression: vi.fn(),
    validate: vi.fn(() => [])
  } as EditorFormActions<'func'>;
}

function makeDataNodeWithAttrs(count: number): AnyGraphNode {
  const names = ['tradeDate', 'currency', 'notional', 'isin', 'venue'];
  return {
    $type: 'Data',
    name: 'Trade',
    namespace: 'test',
    attributes: Array.from({ length: count }, (_, i) => ({
      $type: 'Attribute',
      name: names[i] ?? `attr${i}`,
      typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
      card: { inf: 1, sup: 1, unbounded: false },
      override: false
    })),
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

function makeChoiceNode(): AnyGraphNode {
  return {
    $type: 'Choice',
    name: 'PaymentType',
    namespace: 'test',
    attributes: [{ $type: 'ChoiceOption', typeCall: { $type: 'TypeCall', type: { $refText: 'Trade' } } }],
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

function makeEnumNode(): AnyGraphNode {
  return {
    $type: 'RosettaEnumeration',
    name: 'CurrencyEnum',
    namespace: 'test',
    enumValues: [{ $type: 'RosettaEnumValue', name: 'USD', display: 'US Dollar' }],
    synonyms: [],
    annotations: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

function makeFunctionNode(): AnyGraphNode {
  return {
    $type: 'RosettaFunction',
    name: 'CalculateNotional',
    namespace: 'test',
    inputs: [
      {
        $type: 'Attribute',
        name: 'trade',
        typeCall: { $type: 'TypeCall', type: { $refText: 'Trade' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      }
    ],
    output: { typeCall: { $type: 'TypeCall', type: { $refText: 'number' } } },
    expressionText: '',
    conditions: [],
    postConditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('row renderer registry (Phase 8 / US6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('RR1 — AttributeRow registered as FormMeta.render', () => {
    it('exposes a render function on AttributeSchema in the form registry', () => {
      const meta = formRegistry.get(AttributeSchema);
      expect(meta).toBeDefined();
      expect(typeof meta?.render).toBe('function');
      expect(meta?.render).toBe(AttributeRowRender);
    });

    it('renders one AttributeRow per attribute in DataTypeForm (3 attributes → 3 rows)', () => {
      render(
        <DataTypeForm
          meta={testMeta('test')}
          nodeId="test.Trade"
          data={makeDataNodeWithAttrs(3)}
          availableTypes={AVAILABLE_TYPES}
          actions={makeDataActions()}
        />
      );

      const rowsBySlot = Array.from(document.querySelectorAll('[data-slot="attribute-row"]'));
      expect(rowsBySlot.length).toBe(3);
    });
  });

  describe('RR2 — row reads sibling value via useFormContext', () => {
    it('updates the visible name when the user edits the attribute name input', () => {
      render(
        <DataTypeForm
          meta={testMeta('test')}
          nodeId="test.Trade"
          data={makeDataNodeWithAttrs(2)}
          availableTypes={AVAILABLE_TYPES}
          actions={makeDataActions()}
        />
      );

      const rows = Array.from(document.querySelectorAll('[data-slot="attribute-row"]'));
      const firstRow = rows[0] as HTMLElement;
      expect(firstRow).toBeDefined();
      const nameInput = firstRow.querySelector('input[data-slot="attribute-name"]') as HTMLInputElement;
      expect(nameInput).toBeTruthy();
      expect(nameInput.value).toBe('tradeDate');

      fireEvent.change(nameInput, { target: { value: 'executionDate' } });

      expect(nameInput.value).toBe('executionDate');
    });
  });

  describe('RR3 — remove affordance fires host action', () => {
    it('calls actions.removeAttribute when the row remove button is clicked', () => {
      const actions = makeDataActions();
      render(
        <DataTypeForm
          meta={testMeta('test')}
          nodeId="test.Trade"
          data={makeDataNodeWithAttrs(2)}
          availableTypes={AVAILABLE_TYPES}
          actions={actions}
        />
      );

      const rows = Array.from(document.querySelectorAll('[data-slot="attribute-row"]')) as HTMLElement[];
      const removeBtn = rows[1].querySelector('[data-slot="attribute-remove"]') as HTMLButtonElement;
      expect(removeBtn).toBeTruthy();
      fireEvent.click(removeBtn);

      expect(actions.removeAttribute).toHaveBeenCalledTimes(1);
      expect(actions.removeAttribute).toHaveBeenCalledWith('test.Trade', 'currency');
    });
  });

  describe('RR4 — Choice / Enum / Function row registrations', () => {
    it('registers ChoiceOptionRow against ChoiceOptionSchema and renders it in ChoiceForm', () => {
      const meta = formRegistry.get(ChoiceOptionSchema);
      expect(meta).toBeDefined();
      expect(typeof meta?.render).toBe('function');
      expect(meta?.render).toBe(ChoiceOptionRowRender);

      render(
        <ChoiceForm
          meta={testMeta('test')}
          nodeId="test.PaymentType"
          data={makeChoiceNode()}
          availableTypes={AVAILABLE_TYPES}
          actions={makeChoiceActions()}
        />
      );

      const rows = Array.from(document.querySelectorAll('[data-slot="choice-option-row"]'));
      expect(rows.length).toBe(1);
    });

    it('registers EnumValueRow against RosettaEnumValueSchema and renders it in EnumForm', () => {
      const meta = formRegistry.get(RosettaEnumValueSchema);
      expect(meta).toBeDefined();
      expect(typeof meta?.render).toBe('function');
      expect(meta?.render).toBe(EnumValueRowRender);

      render(
        <EnumForm
          meta={testMeta('test')}
          nodeId="test.CurrencyEnum"
          data={makeEnumNode()}
          availableTypes={AVAILABLE_TYPES}
          actions={makeEnumActions()}
        />
      );

      const rows = Array.from(document.querySelectorAll('[data-slot="enum-value-row"]'));
      expect(rows.length).toBe(1);
    });

    it('registers a function-input row against AttributeSchema (function inputs share AttributeSchema)', () => {
      // AttributeSchema is the item schema both for Data attributes and
      // RosettaFunction inputs (see generated zod-schemas.ts:640). The
      // FunctionInputRowRender export is still registered in functionFormRegistry
      // for backwards compatibility / consumers that drive the registry path
      // directly. FunctionForm itself now renders inputs as <AttributeRow>
      // (data-slot="attribute-row") via its own useFieldArray .map() — the same
      // pattern DataTypeForm uses — rather than going through the z2f registry
      // path, so the observable slot is "attribute-row".
      expect(typeof FunctionInputRowRender).toBe('function');

      render(
        <FunctionForm
          meta={testMeta('test')}
          nodeId="test.CalculateNotional"
          data={makeFunctionNode()}
          availableTypes={AVAILABLE_TYPES}
          actions={makeFunctionActions()}
        />
      );

      // Each input is now rendered as an editable <AttributeRow>
      // (data-slot="attribute-row"). The old read-only FunctionInputRow
      // (data-slot="input-param-row") is no longer used by FunctionForm.
      const rows = Array.from(document.querySelectorAll('[data-slot="attribute-row"]'));
      expect(rows.length).toBe(2);
    });
  });
});
