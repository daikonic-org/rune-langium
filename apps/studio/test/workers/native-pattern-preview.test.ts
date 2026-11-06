// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { BASICTYPES_ROSETTA } from '@rune-langium/core';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => vi.unstubAllGlobals());

it('converts time and pattern inputs, executes native values and serializes pattern output', async () => {
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      { uri: 'file:///basictypes.rosetta', content: BASICTYPES_ROSETTA },
      {
        uri: 'file:///patterns.rosetta',
        content: `namespace patterns
type Settings:
 at time (1..1)
 expression pattern (1..1)
func Copy:
 inputs: settings Settings (1..1)
 output: result Settings (1..1)
 set result: settings
func Same:
 inputs:
  left pattern (1..1)
  right pattern (1..1)
 output: result boolean (1..1)
 set result: left = right
func SelectPattern:
 inputs: kind int (1..1)
 output: result pattern (1..1)
 set result: kind switch 1 then "^a$", default "^b$"
func SelectSame:
 inputs: kind int (1..1) expected pattern (1..1)
 output: result boolean (1..1)
 set result: Same(SelectPattern(kind), expected)
func ExtractPatterns:
 inputs: values int (0..*)
 output: result pattern (0..*)
 set result: values extract ["^extract$"]
func ExtractSame:
 inputs: values int (1..*) expected pattern (1..1)
 output: result boolean (1..1)
 set result: Same(ExtractPatterns(values) first, expected)
func ThenPattern:
 output: result pattern (1..1)
 set result: 1 then "^then$"
func ThenSame:
 inputs: expected pattern (1..1)
 output: result boolean (1..1)
 set result: Same(ThenPattern(), expected)`
      }
    ]
  });
  const cases = [
    {
      funcName: 'patterns.Copy',
      inputs: { settings: { at: '12:34:56', expression: '^x+$' } },
      output: { at: '12:34:56', expression: '^x+$' }
    },
    { funcName: 'patterns.Same', inputs: { left: 'x', right: 'y' }, output: false },
    { funcName: 'patterns.Same', inputs: { left: 'x', right: 'x' }, output: true },
    { funcName: 'patterns.SelectPattern', inputs: { kind: 1 }, output: '^a$' },
    { funcName: 'patterns.SelectPattern', inputs: { kind: 2 }, output: '^b$' },
    { funcName: 'patterns.SelectSame', inputs: { kind: 1, expected: '^a$' }, output: true },
    { funcName: 'patterns.SelectSame', inputs: { kind: 2, expected: '^b$' }, output: true },
    { funcName: 'patterns.SelectSame', inputs: { kind: 1, expected: '^b$' }, output: false },
    { funcName: 'patterns.ExtractPatterns', inputs: { values: [1, 2] }, output: ['^extract$', '^extract$'] },
    { funcName: 'patterns.ExtractSame', inputs: { values: [1], expected: '^extract$' }, output: true },
    { funcName: 'patterns.ExtractSame', inputs: { values: [1], expected: '^other$' }, output: false },
    { funcName: 'patterns.ThenPattern', inputs: {}, output: '^then$' },
    { funcName: 'patterns.ThenSame', inputs: { expected: '^then$' }, output: true },
    { funcName: 'patterns.ThenSame', inputs: { expected: '^other$' }, output: false }
  ];
  for (const [index, value] of cases.entries()) {
    const requestId = `pattern-${index}`;
    worker.dispatch({ type: 'preview:execute', requestId, funcName: value.funcName, inputs: value.inputs });
    const response = await vi.waitFor(
      () => {
        const call = worker.scope.postMessage.mock.calls.find(([message]) => message.requestId === requestId);
        expect(call).toBeDefined();
        return call![0];
      },
      { timeout: 15000 }
    );
    expect(response).toMatchObject({ requestId, type: 'preview:execute-result', output: value.output });
  }
  worker.dispatch({
    type: 'preview:execute',
    requestId: 'invalid-pattern',
    funcName: 'patterns.Same',
    inputs: { left: '[', right: 'x' }
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'invalid-pattern',
          type: 'preview:execute-error',
          error: expect.stringContaining('Invalid pattern')
        })
      ),
    { timeout: 15000 }
  );
});
