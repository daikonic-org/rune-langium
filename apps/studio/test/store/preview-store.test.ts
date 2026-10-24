// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { buildArmValue, buildDefaultValue } from '../../src/services/preview-validator.js';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';

function schema(targetId: string, title = targetId.split('.').at(-1) ?? targetId): FormPreviewSchema {
  return {
    schemaVersion: 1,
    targetId,
    title,
    status: 'ready',
    fields: [{ path: 'value', label: 'value', kind: 'string', required: true }]
  };
}

describe('usePreviewStore', () => {
  beforeEach(() => {
    usePreviewStore.getState().setWorkerRef(null);
    usePreviewStore.getState().resetPreviewState();
  });

  it('tracks successive explicit rekeys after an intermediate target has rendered', () => {
    const target = (id: string) => ({ id, name: id, namespace: 'test', kind: 'data' });
    const store = usePreviewStore.getState();
    store.setAvailableTargets([target('A')]);
    store.selectTarget('A');
    store.setAvailableTargets([target('B')], { from: 'A', to: 'B' });
    store.setAvailableTargets([target('C')], { from: 'A', to: 'C', intermediateIds: ['B'] });
    expect(usePreviewStore.getState().selectedTargetId).toBe('C');
    expect(usePreviewStore.getState().navigationRequest).toBeUndefined();
  });

  it('tracks an explicit edit rekey without inventing navigation or losing the sample', () => {
    const store = usePreviewStore.getState();
    store.setAvailableTargets([{ id: 'test.Order', name: 'Order', namespace: 'test', kind: 'data' }]);
    store.selectTarget('test.Order');
    store.ensureSample('test.Order', { value: 'kept' });
    store.setAvailableTargets([{ id: 'test.Renamed', name: 'Renamed', namespace: 'test', kind: 'data' }], {
      from: 'test.Order',
      to: 'test.Renamed'
    });
    expect(usePreviewStore.getState().selectedTargetId).toBe('test.Renamed');
    expect(usePreviewStore.getState().navigationRequest).toBeUndefined();
    expect(usePreviewStore.getState().samples.get('test.Renamed')?.values).toEqual({ value: 'kept' });
    store.selectTarget('test.Renamed');
    expect(usePreviewStore.getState().navigationRequest?.targetId).toBe('test.Renamed');
  });

  it('reconciles populated recursive records and arrays through their definitions after regeneration', () => {
    const recursive: FormPreviewSchema = {
      ...schema('test.Node'),
      fields: [
        { path: 'node', label: 'Node', kind: 'object', required: true, definitionId: 'test.Node', children: [] }
      ],
      definitions: {
        'test.Node': {
          fields: [
            { path: 'value', label: 'Value', kind: 'string', required: true },
            { path: 'child', label: 'Child', kind: 'object', required: true, definitionId: 'test.Node', children: [] },
            {
              path: 'siblings',
              label: 'Siblings',
              kind: 'array',
              required: false,
              children: [
                {
                  path: 'siblings[]',
                  label: 'Sibling',
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
    usePreviewStore.getState().receivePreviewResult(recursive);
    usePreviewStore.getState().setSampleValues(recursive.targetId, {
      node: {
        value: 'root',
        removed: 'obsolete',
        child: { value: 'child', child: { value: 'grandchild' } },
        siblings: [{ value: 'sibling' }]
      }
    });
    usePreviewStore.getState().receivePreviewResult(recursive);
    const values = usePreviewStore.getState().samples.get(recursive.targetId)!.values;
    expect(values).toEqual({
      node: {
        value: 'root',
        child: { value: 'child', child: { value: 'grandchild', siblings: [] }, siblings: [] },
        siblings: [{ value: 'sibling', siblings: [] }]
      }
    });
    expect(usePreviewStore.getState().samples.get(recursive.targetId)!.serialized).toContain('grandchild');
  });

  it('preserves existing deferred values when their definition is temporarily missing', () => {
    const deferred: FormPreviewSchema = {
      ...schema('test.Node'),
      fields: [
        { path: 'child', label: 'Child', kind: 'object', required: false, definitionId: 'test.Node', children: [] }
      ]
    };
    usePreviewStore.getState().receivePreviewResult(deferred);
    usePreviewStore.getState().setSampleValues(deferred.targetId, { child: { value: 'authored' } });
    usePreviewStore.getState().receivePreviewResult(deferred);
    expect(usePreviewStore.getState().samples.get(deferred.targetId)!.values).toEqual({ child: { value: 'authored' } });
  });

  it('selects duplicate display names by fully-qualified target id', () => {
    usePreviewStore.getState().setAvailableTargets([
      { id: 'alpha.Trade', namespace: 'alpha', name: 'Trade', kind: 'data' },
      { id: 'beta.Trade', namespace: 'beta', name: 'Trade', kind: 'data' }
    ]);

    usePreviewStore.getState().selectTarget('beta.Trade');

    expect(usePreviewStore.getState().selectedTargetId).toBe('beta.Trade');
    expect(usePreviewStore.getState().selectedTarget?.namespace).toBe('beta');
  });

  it('stores preview snapshots per target id and keeps last good snapshot when stale', () => {
    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'alpha.Trade', namespace: 'alpha', name: 'Trade', kind: 'data' }]);
    usePreviewStore.getState().selectTarget('alpha.Trade');
    usePreviewStore.getState().receivePreviewResult(schema('alpha.Trade', 'Trade'));
    usePreviewStore.getState().receivePreviewStale({
      targetId: 'alpha.Trade',
      reason: 'parse-error',
      message: 'Expected attribute'
    });

    expect(usePreviewStore.getState().schemas.get('alpha.Trade')?.title).toBe('Trade');
    expect(usePreviewStore.getState().status).toEqual({
      state: 'stale',
      targetId: 'alpha.Trade',
      reason: 'parse-error',
      message: 'Expected attribute'
    });
  });

  it('re-resolves rename and clears deleted selected targets by id', () => {
    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'alpha.Trade', namespace: 'alpha', name: 'Trade', kind: 'data' }]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'alpha.RenamedTrade', namespace: 'alpha', name: 'RenamedTrade', kind: 'data' }]);

    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();
    expect(usePreviewStore.getState().selectedTarget).toBeUndefined();
  });

  it('re-resolves renamed targets by source identity when the selected id changes', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.RenamedTrade',
        namespace: 'alpha',
        name: 'RenamedTrade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);

    expect(usePreviewStore.getState().selectedTargetId).toBe('alpha.RenamedTrade');
    expect(usePreviewStore.getState().selectedTarget?.name).toBe('RenamedTrade');
  });

  it('preserves source identity through transitional target updates before a rename resolves', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data'
      }
    ]);

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.RenamedTrade',
        namespace: 'alpha',
        name: 'RenamedTrade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 18, character: 0 }
        }
      }
    ]);

    expect(usePreviewStore.getState().selectedTargetId).toBe('alpha.RenamedTrade');
    expect(usePreviewStore.getState().selectedTarget?.name).toBe('RenamedTrade');
  });

  it('re-resolves a renamed target after the selected target is transiently cleared during reload', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    usePreviewStore.getState().setAvailableTargets([]);
    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.RenamedTrade',
        namespace: 'alpha',
        name: 'RenamedTrade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 18, character: 0 }
        }
      }
    ]);

    expect(usePreviewStore.getState().selectedTargetId).toBe('alpha.RenamedTrade');
    expect(usePreviewStore.getState().selectedTarget?.name).toBe('RenamedTrade');
  });

  it('ignores stale selection requests for missing target ids after a rename has been resolved', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.RenamedTrade',
        namespace: 'alpha',
        name: 'RenamedTrade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 18, character: 0 }
        }
      }
    ]);

    usePreviewStore.getState().selectTarget('alpha.Trade');

    expect(usePreviewStore.getState().selectedTargetId).toBe('alpha.RenamedTrade');
    expect(usePreviewStore.getState().selectedTarget?.name).toBe('RenamedTrade');
  });

  it('preserves source identity when re-selecting a target from metadata-less target snapshots', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data'
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');

    expect(usePreviewStore.getState().selectedTarget).toMatchObject({
      id: 'alpha.Trade',
      sourceUri: 'file:///workspace/trade.rosetta',
      sourceIndex: 2
    });
  });

  it('drops selected target samples and cached schema when the target disappears from the available set', () => {
    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'alpha.Trade', namespace: 'alpha', name: 'Trade', kind: 'data' }]);
    usePreviewStore.getState().selectTarget('alpha.Trade');
    usePreviewStore.getState().receivePreviewResult(schema('alpha.Trade', 'Trade'));
    usePreviewStore.getState().setSampleValues('alpha.Trade', { tradeId: 'T-1' });

    usePreviewStore.getState().setAvailableTargets([]);

    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();
    expect(usePreviewStore.getState().selectedTarget).toBeUndefined();
    expect(usePreviewStore.getState().status).toEqual({ state: 'waiting' });
    expect(usePreviewStore.getState().samples.has('alpha.Trade')).toBe(false);
    expect(usePreviewStore.getState().schemas.has('alpha.Trade')).toBe(false);
  });

  it('ignores stale worker messages for targets that are no longer selected after deletion', () => {
    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'alpha.Trade', namespace: 'alpha', name: 'Trade', kind: 'data' }]);
    usePreviewStore.getState().selectTarget('alpha.Trade');
    usePreviewStore.getState().receivePreviewResult(schema('alpha.Trade', 'Trade'));

    usePreviewStore.getState().setAvailableTargets([]);
    usePreviewStore.getState().receivePreviewStale({
      targetId: 'alpha.Trade',
      reason: 'unsupported-target',
      message: 'No form preview schema is available for alpha.Trade.'
    });

    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();
    expect(usePreviewStore.getState().status).toEqual({ state: 'waiting' });
  });

  it('looks up source metadata for cached preview fields by fully-qualified target id', () => {
    usePreviewStore.getState().receivePreviewResult({
      ...schema('alpha.Trade', 'Trade'),
      sourceMap: [
        {
          fieldPath: 'value',
          sourceUri: 'file:///workspace/trade.rosetta',
          sourceLine: 9,
          sourceChar: 3
        }
      ]
    });

    expect(usePreviewStore.getState().getFieldSource('alpha.Trade', 'value')).toEqual({
      fieldPath: 'value',
      sourceUri: 'file:///workspace/trade.rosetta',
      sourceLine: 9,
      sourceChar: 3
    });
    expect(usePreviewStore.getState().getFieldSource('beta.Trade', 'value')).toBeUndefined();
  });

  it('tracks invalid sample state and resets back to ready for the active target', () => {
    usePreviewStore.getState().receivePreviewResult(schema('alpha.Trade', 'Trade'));
    usePreviewStore.getState().ensureSample('alpha.Trade', { value: '' });

    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: '' }, true);
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: '' });
    usePreviewStore
      .getState()
      .receiveValidateResult(postMessage.mock.calls[0]![0].requestId, [
        { path: 'value', message: 'Value is required' }
      ]);

    expect(usePreviewStore.getState().status).toEqual({
      state: 'invalid',
      targetId: 'alpha.Trade'
    });

    usePreviewStore.getState().resetSample('alpha.Trade', { value: '' });

    expect(usePreviewStore.getState().status).toEqual({
      state: 'ready',
      targetId: 'alpha.Trade'
    });
    expect(usePreviewStore.getState().samples.get('alpha.Trade')).toMatchObject({
      values: { value: '' },
      serialized: '{\n  "value": ""\n}',
      errors: {},
      valid: true,
      validated: false
    });
  });

  it('preserves sample values and invalid status when a selected target is renamed by source identity', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.Trade',
        namespace: 'alpha',
        name: 'Trade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 12, character: 0 }
        }
      }
    ]);
    usePreviewStore.getState().selectTarget('alpha.Trade');
    usePreviewStore.getState().receivePreviewResult(schema('alpha.Trade', 'Trade'));
    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: '' }, true);
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: '' });
    usePreviewStore
      .getState()
      .receiveValidateResult(postMessage.mock.calls[0]![0].requestId, [
        { path: 'value', message: 'Value is required' }
      ]);

    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'alpha.RenamedTrade',
        namespace: 'alpha',
        name: 'RenamedTrade',
        kind: 'data',
        sourceUri: 'file:///workspace/trade.rosetta',
        sourceIndex: 2,
        sourceRange: {
          start: { line: 8, character: 0 },
          end: { line: 18, character: 0 }
        }
      }
    ]);

    expect(usePreviewStore.getState().selectedTargetId).toBe('alpha.RenamedTrade');
    expect(usePreviewStore.getState().status).toEqual({
      state: 'invalid',
      targetId: 'alpha.RenamedTrade'
    });
    expect(usePreviewStore.getState().samples.get('alpha.RenamedTrade')).toMatchObject({
      values: { value: '' },
      errors: { value: 'Value is required' },
      valid: false,
      validated: true
    });
    expect(usePreviewStore.getState().samples.has('alpha.Trade')).toBe(false);
    expect(usePreviewStore.getState().schemas.has('alpha.Trade')).toBe(false);
  });

  it('reconciles cached sample values when a schema refresh removes and adds fields', () => {
    usePreviewStore.getState().receivePreviewResult({
      schemaVersion: 1,
      targetId: 'alpha.Trade',
      title: 'Trade',
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
    });
    usePreviewStore.getState().setSampleValues('alpha.Trade', {
      tradeId: 'T-1',
      obsolete: 'drop me',
      counterparty: { name: 'Acme' }
    });

    usePreviewStore.getState().receivePreviewResult({
      schemaVersion: 1,
      targetId: 'alpha.Trade',
      title: 'Trade',
      status: 'ready',
      fields: [
        { path: 'tradeId', label: 'Trade id', kind: 'string', required: true },
        { path: 'quantity', label: 'Quantity', kind: 'number', required: false }
      ]
    });

    expect(usePreviewStore.getState().samples.get('alpha.Trade')).toMatchObject({
      values: {
        tradeId: 'T-1',
        quantity: ''
      },
      serialized: '{\n  "tradeId": "T-1",\n  "quantity": ""\n}'
    });
  });

  it('seeds only the FIRST Choice-ancestor arm default when creating a new sample (issue #434 round 2)', () => {
    // This is the real app's sample-creation path: CodegenProvider calls
    // receivePreviewResult before FormPreviewPanel ever mounts, so its own
    // ensureSample effect is a no-op by the time it runs. Before this fix,
    // receivePreviewResult seeded via a separate, Choice-unaware
    // buildDefaultValues copy that treated every field (including every
    // Choice arm) as independently present — disagreeing with
    // FormPreviewPanel's own Choice-aware seeding, which starts only the
    // first arm as selected.
    usePreviewStore.getState().receivePreviewResult({
      schemaVersion: 1,
      targetId: 'alpha.Basket',
      title: 'Basket',
      status: 'unsupported',
      fields: [
        { path: 'label', label: 'Label', kind: 'string', required: true },
        { path: 'cash', label: 'Cash', kind: 'string', required: false },
        { path: 'commodity', label: 'Commodity', kind: 'string', required: false }
      ],
      choiceArmPaths: ['cash', 'commodity']
    });

    const values = usePreviewStore.getState().samples.get('alpha.Basket')?.values;
    expect(values).toHaveProperty('label');
    expect(values).toHaveProperty('cash');
    expect(values).not.toHaveProperty('commodity');
  });

  it('seeds an enum-backed first Choice arm with an actual enum value', () => {
    usePreviewStore.getState().receivePreviewResult({
      schemaVersion: 1,
      targetId: 'alpha.UnitChoice',
      title: 'UnitChoice',
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
    });

    expect(usePreviewStore.getState().samples.get('alpha.UnitChoice')?.serialized).toBe('{\n  "unit": "Share"\n}');
  });

  it('clearHydrationRetriesRemaining removes an existing key and no-ops on a missing one', () => {
    usePreviewStore.getState().setHydrationRetriesRemaining('Scheme', 3);
    expect(usePreviewStore.getState().hydrationRetriesRemaining).toEqual({ Scheme: 3 });

    usePreviewStore.getState().clearHydrationRetriesRemaining('Scheme');
    expect(usePreviewStore.getState().hydrationRetriesRemaining).toEqual({});

    const stateBefore = usePreviewStore.getState();
    usePreviewStore.getState().clearHydrationRetriesRemaining('NeverSet');
    expect(usePreviewStore.getState().hydrationRetriesRemaining).toEqual({});
    expect(usePreviewStore.getState()).toBe(stateBefore);
  });
});

describe('preview-store dispatchValidate/receiveValidateResult', () => {
  beforeEach(() => {
    usePreviewStore.getState().setWorkerRef(null);
    usePreviewStore.getState().resetPreviewState();
  });

  it('retains the provider-owned worker connection when resetting workspace preview data', () => {
    const postMessage = vi.fn();
    const store = usePreviewStore.getState();
    store.setWorkerRef({ postMessage } as unknown as Worker);
    store.resetPreviewState();
    store.updateSampleValues('beta.Trade#Data', { value: 'new workspace' }, true);

    store.dispatchValidate('beta.Trade#Data', { value: 'new workspace' });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'instance:validate', typeFqn: 'beta.Trade', data: { value: 'new workspace' } })
    );
    store.setWorkerRef(null);
  });

  it('dispatchValidate posts an instance:validate message and receiveValidateResult writes errors/valid onto the sample', () => {
    const postMessage = vi.fn();
    const targetId = 'alpha.Trade#Data';
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().updateSampleValues(targetId, { value: '' }, true);

    usePreviewStore.getState().dispatchValidate(targetId, { value: '' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'instance:validate', typeFqn: 'alpha.Trade', data: { value: '' } })
    );
    const requestId = postMessage.mock.calls[0]![0].requestId as string;

    usePreviewStore.getState().receiveValidateResult(requestId, [{ path: 'value', message: 'Value is required' }]);

    expect(usePreviewStore.getState().samples.get(targetId)).toMatchObject({
      values: { value: '' },
      errors: { value: 'Value is required' },
      valid: false,
      validated: true
    });
    expect(usePreviewStore.getState().status).toEqual({ state: 'invalid', targetId });
  });

  it('drops a stale out-of-order receiveValidateResult in favor of the latest dispatched request', () => {
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: 'a' }, true);

    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: 'a' });
    const firstRequestId = postMessage.mock.calls[0]![0].requestId as string;
    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: 'ab' });
    const secondRequestId = postMessage.mock.calls[1]![0].requestId as string;

    usePreviewStore.getState().receiveValidateResult(firstRequestId, []);
    expect(usePreviewStore.getState().samples.get('alpha.Trade')?.validationPending).toBe(true);
    usePreviewStore.getState().receiveValidateResult(secondRequestId, []);
    usePreviewStore.getState().receiveValidateResult(firstRequestId, [{ path: 'value', message: 'stale' }]);

    expect(usePreviewStore.getState().samples.get('alpha.Trade')).toMatchObject({
      errors: {},
      valid: true,
      validationPending: false
    });
  });

  it('updateSampleValues clears prior errors/valid immediately so stale errors never linger against new values', () => {
    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: '' }, true);
    usePreviewStore.getState().receiveValidateResult('nonexistent', []); // no-op, requestId never dispatched

    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: '' });
    const requestId = postMessage.mock.calls[0]![0].requestId as string;
    usePreviewStore.getState().receiveValidateResult(requestId, [{ path: 'value', message: 'Value is required' }]);
    expect(usePreviewStore.getState().samples.get('alpha.Trade')?.errors).toEqual({ value: 'Value is required' });

    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: 'x' }, true);
    expect(usePreviewStore.getState().samples.get('alpha.Trade')).toMatchObject({
      values: { value: 'x' },
      errors: {},
      valid: true
    });
  });

  it('resetSample invalidates an in-flight validate request so its stale response cannot attach to the reset defaults', () => {
    const postMessage = vi.fn();
    usePreviewStore.getState().setWorkerRef({ postMessage } as unknown as Worker);
    usePreviewStore.getState().updateSampleValues('alpha.Trade', { value: 'invalid input' }, true);

    // A validate request goes out for the pre-reset values but never gets a
    // response before the user hits Reset.
    usePreviewStore.getState().dispatchValidate('alpha.Trade', { value: 'invalid input' });
    const staleRequestId = postMessage.mock.calls[0]![0].requestId as string;

    usePreviewStore.getState().resetSample('alpha.Trade', { value: '' });

    // The stale response for the discarded values arrives late — it must
    // NOT overwrite the freshly-reset sample's clean errors/valid state.
    usePreviewStore.getState().receiveValidateResult(staleRequestId, [{ path: 'value', message: 'stale' }]);

    expect(usePreviewStore.getState().samples.get('alpha.Trade')).toMatchObject({
      values: { value: '' },
      errors: {},
      valid: true,
      validated: false
    });
  });
});

// Task 1 (2026-07-17 prod-ux-checkout-harness Phase 2): dispatchExecute/
// receiveExecutionResult/receiveExecutionError gain a `functionExecute`
// op-log span, correlated by function and request ID — mirrors
// model-store.ts's `load()`/modelLoad span test pattern (see
// model-store.test.ts).
describe('usePreviewStore — functionExecute op-log span', () => {
  const postMessage = vi.fn();
  const fakeWorker = { postMessage } as unknown as Worker;
  const latestRequestId = () => postMessage.mock.lastCall![0].requestId as string;

  beforeEach(() => {
    usePreviewStore.getState().setWorkerRef(null);
    usePreviewStore.getState().resetPreviewState();
    postMessage.mockClear();
    usePreviewStore.getState().setWorkerRef(fakeWorker);
    useOutputStore.setState({ lines: [] });
    useActivityStore.setState({ entries: [] });
  });

  it('dispatchExecute + receiveExecutionResult publishes one success functionExecute activity entry', () => {
    usePreviewStore.getState().dispatchExecute('alpha.CalcTrade', {});
    usePreviewStore.getState().receiveExecutionResult('alpha.CalcTrade', { ok: true }, latestRequestId());

    const entries = useActivityStore.getState().entries;
    const functionExecuteEntries = entries.filter((e) => e.tag === 'functionExecute');
    expect(functionExecuteEntries).toHaveLength(1);
    expect(functionExecuteEntries[0]?.ok).toBe(true);
    expect(functionExecuteEntries[0]?.subject).toBe('alpha.CalcTrade');
    expect(functionExecuteEntries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(functionExecuteEntries[0]?.opId).toBeTypeOf('number');

    const lines = useOutputStore.getState().lines;
    const functionExecuteLines = lines.filter((l) => l.op === 'functionExecute');
    expect(functionExecuteLines).toHaveLength(1);
    expect(functionExecuteLines[0]?.severity).toBe('success');
    expect(functionExecuteLines[0]?.subject).toBe('alpha.CalcTrade');
    expect(functionExecuteLines[0]?.opId).toBe(functionExecuteEntries[0]?.opId);
  });

  it('dispatchExecute + receiveExecutionError publishes one failure functionExecute activity entry', () => {
    usePreviewStore.getState().dispatchExecute('alpha.CalcTrade', {});
    usePreviewStore.getState().receiveExecutionError('alpha.CalcTrade', 'boom', latestRequestId());

    const entries = useActivityStore.getState().entries;
    const functionExecuteEntries = entries.filter((e) => e.tag === 'functionExecute');
    expect(functionExecuteEntries).toHaveLength(1);
    expect(functionExecuteEntries[0]?.ok).toBe(false);
    expect(functionExecuteEntries[0]?.subject).toBe('alpha.CalcTrade');
    expect(functionExecuteEntries[0]?.durationMs).toBeGreaterThanOrEqual(0);

    const lines = useOutputStore.getState().lines;
    const functionExecuteLines = lines.filter((l) => l.op === 'functionExecute');
    expect(functionExecuteLines).toHaveLength(1);
    expect(functionExecuteLines[0]?.severity).toBe('error');
    expect(functionExecuteLines[0]?.opId).toBe(functionExecuteEntries[0]?.opId);
  });

  it('receiveExecutionResult for a funcName never dispatched does not throw or log an entry', () => {
    expect(() =>
      usePreviewStore.getState().receiveExecutionResult('never.Dispatched', { ok: true }, 'unknown')
    ).not.toThrow();

    const entries = useActivityStore.getState().entries;
    expect(entries.filter((e) => e.tag === 'functionExecute')).toHaveLength(0);

    const lines = useOutputStore.getState().lines;
    expect(lines.filter((l) => l.op === 'functionExecute')).toHaveLength(0);
  });

  it('drops a stale executeSpans entry on resetPreviewState so a late worker result is not written back', () => {
    usePreviewStore.getState().dispatchExecute('alpha.CalcTrade', {});
    const requestId = latestRequestId();

    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.getState().setWorkerRef(fakeWorker);

    usePreviewStore.getState().receiveExecutionResult('alpha.CalcTrade', { ok: true }, requestId);

    expect(usePreviewStore.getState().executionResults.has('alpha.CalcTrade')).toBe(false);

    const entries = useActivityStore.getState().entries;
    expect(entries.filter((e) => e.tag === 'functionExecute')).toHaveLength(0);

    const lines = useOutputStore.getState().lines;
    expect(lines.filter((l) => l.op === 'functionExecute')).toHaveLength(0);
  });
  it.each(['result', 'error'] as const)('ignores a superseded %s without consuming the latest run', (kind) => {
    const store = usePreviewStore.getState();
    store.dispatchExecute('alpha.CalcTrade', { value: 1 });
    const old = latestRequestId();
    store.dispatchExecute('alpha.CalcTrade', { value: 2 });
    const current = latestRequestId();
    if (kind === 'result') store.receiveExecutionResult('alpha.CalcTrade', 1, old);
    else store.receiveExecutionError('alpha.CalcTrade', 'old error', old);
    expect(usePreviewStore.getState().executionResults.size).toBe(0);
    expect(useActivityStore.getState().entries.filter((entry) => entry.tag === 'functionExecute')).toEqual([]);
    store.receiveExecutionResult('wrong.Function', 99, current);
    store.receiveExecutionResult('alpha.CalcTrade', 2, current);
    store.receiveExecutionError('alpha.CalcTrade', 'duplicate reply', current);
    expect(usePreviewStore.getState().executionResults.get('alpha.CalcTrade')).toEqual({ output: 2 });
    expect(useActivityStore.getState().entries.filter((entry) => entry.tag === 'functionExecute')).toHaveLength(1);
  });
});

it.each(['date', 'time', 'dateTime', 'zonedDateTime'] as const)(
  'keeps optional %s absent but materializes a selected Choice arm',
  (format) => {
    const field = { path: 'value', label: 'Value', kind: 'string' as const, format, required: false };
    expect(buildDefaultValue(field)).toBeUndefined();
    expect(buildArmValue(field)).toBe('');
    expect(buildDefaultValue({ ...field, required: true })).toBe('');
  }
);
