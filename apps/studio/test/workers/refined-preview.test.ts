// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { refinedPreviewSource } from '../../../../packages/codegen/test/helpers/refined-preview.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => vi.unstubAllGlobals());

describe('refined inherited preview validation', () => {
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
