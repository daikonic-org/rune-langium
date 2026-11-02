// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { refinedPreviewSource } from '../../../../packages/codegen/test/helpers/refined-preview.js';
import {
  inheritedArraySource,
  inheritedArrayValue
} from '../../../../packages/codegen/test/helpers/inherited-schema.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => vi.unstubAllGlobals());

describe('refined inherited preview validation', () => {
  it('loads condition functions and sibling calls, converts temporal arguments, and refreshes their bodies', async () => {
    const worker = await loadRealWorker();
    const files = [
      {
        uri: 'file:///helper.rosetta',
        content:
          'namespace checks.helper\nfunc AboveZero:\n inputs: value int (1..1)\n output: result boolean (1..1)\n set result: value > 0'
      },
      {
        uri: 'file:///checks.rosetta',
        content: `namespace checks.api
import checks.helper.*
func Positive:
 inputs: value int (1..1)
 output: result boolean (1..1)
 set result: AboveZero(value)
func Recent:
 inputs: value date (1..1)
 output: result boolean (1..1)
 set result: value -> year >= 2020`
      },
      {
        uri: 'file:///record.rosetta',
        content: `namespace records
import checks.api.*
type Sample:
 amount int (1..1)
 effectiveDate date (1..1)
 condition AmountPositive: Positive(amount)
 condition RecentDate: Recent(effectiveDate)`
      }
    ];
    worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files });
    for (const [index, data] of [
      { amount: 5, effectiveDate: '2024-01-01' },
      { amount: -1, effectiveDate: '2024-01-01' },
      { amount: 5, effectiveDate: '2010-01-01' }
    ].entries()) {
      const requestId = `condition-function:${index}`;
      worker.dispatch({ type: 'instance:validate', typeFqn: 'records.Sample', data, requestId });
      await vi.waitFor(() =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ requestId, type: 'instance:validateResult' })
        )
      );
      const response = worker.scope.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.requestId === requestId);
      if (index === 0) expect(response.diagnostics).toEqual([]);
      else
        expect(response.diagnostics).toEqual([
          expect.objectContaining({ conditionName: index === 1 ? 'AmountPositive' : 'RecentDate' })
        ]);
    }
    worker.dispatch({
      type: 'preview:setFiles',
      filesRevision: 2,
      files: files.map((file) =>
        file.uri === 'file:///helper.rosetta'
          ? { ...file, content: file.content.replace('value > 0', 'value > 10') }
          : file
      )
    });
    worker.dispatch({
      type: 'instance:validate',
      typeFqn: 'records.Sample',
      data: { amount: 5, effectiveDate: '2024-01-01' },
      requestId: 'condition-function:updated'
    });
    await vi.waitFor(() =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'condition-function:updated',
          diagnostics: [expect.objectContaining({ conditionName: 'AmountPositive' })]
        })
      )
    );
  });

  it('validates an inherited collection through the same generated schema used when selecting a Prototype example', async () => {
    const worker = await loadRealWorker();
    worker.dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///inherited-array.rosetta', content: inheritedArraySource }]
    });
    for (const [index, data] of [
      inheritedArrayValue,
      { tradeIdentifier: [{ assignedIdentifier: [{ identifier: 123 }] }] }
    ].entries()) {
      const requestId = `inherited-array:${index}`;
      worker.dispatch({ type: 'instance:validate', typeFqn: 'test.inheritedArray.Trade', data, requestId });
      await vi.waitFor(() =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ requestId, type: 'instance:validateResult' })
        )
      );
      const response = worker.scope.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.requestId === requestId);
      if (index === 0) expect(response.diagnostics).toEqual([]);
      else
        expect(response.diagnostics).toEqual([
          expect.objectContaining({ path: 'tradeIdentifier[0].assignedIdentifier[0].identifier' })
        ]);
    }
  });

  it('validates overrides and retains parent and child conditions through the real worker', async () => {
    const worker = await loadRealWorker();
    worker.dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///refined.rosetta', content: refinedPreviewSource }]
    });
    for (const [index, data] of [
      { value: 1, note: 'valid' },
      { value: -1, note: 'valid' },
      { value: 1, note: '' }
    ].entries()) {
      const requestId = `refined:${index}`;
      worker.dispatch({ type: 'instance:validate', typeFqn: 'test.refinedPreview.Grandchild', data, requestId });
      await vi.waitFor(
        () =>
          expect(worker.scope.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ requestId, type: 'instance:validateResult' })
          ),
        { timeout: 10_000 }
      );
      const response = worker.scope.postMessage.mock.calls
        .map(([message]) => message)
        .find((message) => message.requestId === requestId);
      expect(
        response.diagnostics.some((entry: { message: string }) =>
          entry.message.startsWith('Structural validation unavailable:')
        )
      ).toBe(false);
      if (index === 0) expect(response.diagnostics).toEqual([]);
      else expect(response.diagnostics.length).toBeGreaterThan(0);
    }
  }, 15_000);
});
