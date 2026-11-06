// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Smoke-test regression guard for hand-authored (non-migrated) editor forms (T030).
 *
 * Verifies that ChoiceForm, DataTypeForm, and FunctionForm still render without
 * throwing after the EnumForm migration. Guards against accidental breakage
 * from shared imports, schema changes, or type regressions (FR-017).
 *
 * Each test renders the form with minimal valid props and asserts no error is thrown.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChoiceForm } from '../src/components/editors/ChoiceForm.js';
import { DataTypeForm } from '../src/components/editors/DataTypeForm.js';
import { FunctionForm } from '../src/components/editors/FunctionForm.js';
import type { AnyGraphNode, TypeOption, EditorFormActions } from '../src/types.js';
import { testMeta } from './helpers/node-meta.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'test.Money', label: 'Money', kind: 'data', namespace: 'test' },
  { value: 'builtin::string', label: 'string', kind: 'builtin' }
];

/** Build a minimal AnyGraphNode fixture for any AST type. */
function makeChoiceNode(name: string): AnyGraphNode {
  return {
    $type: 'Choice',
    name,
    namespace: 'test',
    attributes: [],
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

function makeDataNode(name: string): AnyGraphNode {
  return {
    $type: 'Data',
    name,
    namespace: 'test',
    attributes: [],
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

function makeFuncNode(name: string): AnyGraphNode {
  return {
    $type: 'RosettaFunction',
    name,
    namespace: 'test',
    inputs: [],
    conditions: [],
    postConditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

/** Create a minimal all-vi.fn() action map compatible with any form kind. */
function makeChoiceActions(): EditorFormActions<'choice'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addAnnotation: vi.fn(),
    removeAnnotation: vi.fn(),
    addChoiceOption: vi.fn(),
    removeChoiceOption: vi.fn(),
    validate: vi.fn().mockReturnValue([])
  };
}

function makeDataActions(): EditorFormActions<'data'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addAnnotation: vi.fn(),
    removeAnnotation: vi.fn(),
    addAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    updateAttribute: vi.fn(),
    reorderAttribute: vi.fn(),
    setInheritance: vi.fn(),
    validate: vi.fn().mockReturnValue([])
  };
}

function makeFuncActions(): EditorFormActions<'func'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addAnnotation: vi.fn(),
    removeAnnotation: vi.fn(),
    addInputParam: vi.fn(),
    removeInputParam: vi.fn(),
    updateOutputParam: vi.fn(),
    updateOutputType: vi.fn(),
    updateExpression: vi.fn(),
    validate: vi.fn().mockReturnValue([])
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Non-migrated forms regression guard (T030, FR-017)', () => {
  it('ChoiceForm renders without throwing with minimal props', () => {
    expect(() =>
      render(
        <ChoiceForm
          meta={testMeta('test')}
          nodeId="node-choice"
          data={makeChoiceNode('PaymentMethod')}
          availableTypes={AVAILABLE_TYPES}
          actions={makeChoiceActions()}
        />
      )
    ).not.toThrow();
  });

  it('DataTypeForm renders without throwing with minimal props', () => {
    expect(() =>
      render(
        <DataTypeForm
          meta={testMeta('test')}
          nodeId="node-data"
          data={makeDataNode('Party')}
          availableTypes={AVAILABLE_TYPES}
          actions={makeDataActions()}
        />
      )
    ).not.toThrow();
  });

  it('FunctionForm renders without throwing with minimal props', () => {
    expect(() =>
      render(
        <FunctionForm
          meta={testMeta('test')}
          nodeId="node-func"
          data={makeFuncNode('Calculate')}
          availableTypes={AVAILABLE_TYPES}
          actions={makeFuncActions()}
        />
      )
    ).not.toThrow();
  });

  it('ChoiceForm accepts its original prop shape (nodeId, data, availableTypes, actions)', () => {
    // Verifies the prop interface has not regressed
    const data = makeChoiceNode('Settlement');
    const actions = makeChoiceActions();
    // render -> no TS error here means the prop types are intact
    expect(() =>
      render(<ChoiceForm meta={testMeta('test')} nodeId="n1" data={data} availableTypes={[]} actions={actions} />)
    ).not.toThrow();
  });

  it('DataTypeForm accepts its original prop shape (nodeId, data, availableTypes, actions)', () => {
    const data = makeDataNode('Counterparty');
    const actions = makeDataActions();
    expect(() =>
      render(<DataTypeForm meta={testMeta('test')} nodeId="n2" data={data} availableTypes={[]} actions={actions} />)
    ).not.toThrow();
  });

  it('FunctionForm accepts its original prop shape (nodeId, data, availableTypes, actions)', () => {
    const data = makeFuncNode('Evaluate');
    const actions = makeFuncActions();
    expect(() =>
      render(<FunctionForm meta={testMeta('test')} nodeId="n3" data={data} availableTypes={[]} actions={actions} />)
    ).not.toThrow();
  });
});
