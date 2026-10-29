// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { GeneratedExpressionView } from '../../src/components/editing/GeneratedExpressionView.js';
import type { GeneratedProjection } from '@rune-langium/codegen/export';

afterEach(cleanup);
const base: GeneratedProjection = {
  language: 'typescript',
  code: '',
  requiredHelpers: [],
  sourceMap: [],
  subject: { uri: 'file:///model.rosetta', nodeId: 'Calculate', region: { from: 0, to: 1 } }
};
it('shows unavailable implementation status without inventing an editor body', () => {
  const host = render(
    <GeneratedExpressionView
      projection={{
        ...base,
        implementation: {
          status: 'unavailable',
          language: 'typescript',
          label: 'No TypeScript implementation available'
        }
      }}
    />
  );
  expect(host.getByRole('status')).toHaveTextContent('No TypeScript implementation available');
  expect(host.queryByRole('textbox')).toBeNull();
});
it('shows actual implementation text alongside its provenance', () => {
  const host = render(
    <GeneratedExpressionView
      projection={{
        ...base,
        code: 'return amount + 1;',
        implementation: {
          status: 'available',
          language: 'typescript',
          label: 'Bundled TypeScript implementation',
          reference: 'native.Test'
        }
      }}
    />
  );
  expect(host.getByRole('status')).toHaveTextContent('native.Test');
  expect(host.getByRole('textbox', { name: 'Generated typescript' })).toHaveTextContent('return amount + 1;');
});
