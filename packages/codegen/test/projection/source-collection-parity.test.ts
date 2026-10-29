// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { AstUtils } from 'langium';
import { sourceProjectionCollections } from '../helpers/source-projection-collections.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { linkedFunctions, runPython } from './python-test-utils.js';

it('keeps scalar extraction and collection groups consistent in Python exports', async () => {
  const functions = await linkedFunctions(sourceProjectionCollections);
  const python = generatePythonModule([AstUtils.getDocument(functions[0]!)]);
  const result = runPython(
    [
      { expression: 'GroupCount([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'Flat([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'Mix([{"values": [1, 2]}, {"values": [3]}], 4)' },
      { expression: 'GroupCount([{}, {"values": []}])' },
      { expression: 'EmptyCount([{"values": [1]}])' },
      { expression: 'ScalarEmpty(7)' },
      { expression: 'Scalar(None)' },
      { expression: 'Scalar(7)' },
      { expression: 'ScalarFilter(7)' },
      { expression: 'ScalarFilter(-1)' }
    ],
    python.code,
    { includeRuntime: false }
  );
  expect(result).toEqual([
    { value: 2 },
    { value: [1, 2, 3] },
    { value: [1, 2, 3, 4] },
    { value: 2 },
    { value: 0 },
    { value: null },
    { value: null },
    { value: 1 },
    { value: 7 },
    { value: null }
  ]);
});
