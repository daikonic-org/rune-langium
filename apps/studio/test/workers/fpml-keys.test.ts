// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { parseProjectPayload } from '@rune-langium/core/serialization';
import { afterEach, expect, it, vi } from 'vitest';
import { fpmlKeyCases, fpmlKeyNamespace, publishFpmlKeyFixture } from '../../../../test/helpers/cdm-fpml-keys.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('validates tagged FpML subtypes and preserves their exact decimals through Prototype execution', async () => {
  const { snapshot, published } = await publishFpmlKeyFixture();
  const project = await captureProjectRuntimeInput(snapshot, [], published);
  const { scope, dispatch } = await loadRealWorker();
  const projectReceipt = project.receipt;
  const reply = (requestId: string) =>
    vi.waitFor(
      () => {
        const message = scope.postMessage.mock.calls.find(([value]) => value.requestId === requestId)?.[0];
        expect(message).toBeDefined();
        return message;
      },
      { timeout: 15000 }
    );
  dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [], project, requestId: 'installed' });
  expect(await reply('installed')).toMatchObject({ type: 'preview:files-ready', projectReceipt });
  for (const test of fpmlKeyCases.filter(
    ({ id }) => id.startsWith('cross rate scale') || id.startsWith('quoted pair nested')
  )) {
    const input = parseProjectPayload(test.json, 'JSON', { preserveNumberText: true });
    const funcName = fpmlKeyNamespace + '.' + test.function;
    dispatch({
      type: 'preview:execute',
      funcName,
      projectReceipt,
      requestId: test.id,
      inputs: { keyPrefix: test.prefix, fpmlQuotedCurrencyPair: input }
    });
    expect(await reply(test.id)).toMatchObject({ type: 'preview:execute-result', output: test.expected });
  }
  dispatch({
    type: 'preview:execute',
    funcName: fpmlKeyNamespace + '.CreateKeyForQuotedCurrencyPair',
    projectReceipt,
    requestId: 'bad-rate',
    inputs: {
      keyPrefix: 'observable',
      fpmlQuotedCurrencyPair: {
        '@type': 'fpml.consolidated.fx.CrossRate',
        currency1: { value: 'USD' },
        currency2: { value: 'EUR' },
        rate: 'bad'
      }
    }
  });
  expect(await reply('bad-rate')).toMatchObject({ type: 'preview:execute-error' });
}, 45000);
