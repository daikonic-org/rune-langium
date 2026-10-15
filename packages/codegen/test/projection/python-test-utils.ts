// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { URI } from 'langium';
import {
  createRuneDslServices,
  isRosettaModel,
  assertValidDocuments,
  BASICTYPES_ROSETTA,
  type RosettaExpression,
  type RosettaFunction
} from '@rune-langium/core';
import type { PythonProjectionContext } from '../../src/projection/context.js';
import { PYTHON_RUNTIME_SOURCE } from '../../src/projection/python-runtime.js';

export function pythonContext(): PythonProjectionContext {
  return {
    subject: { uri: 'inmemory:///python.rosetta', nodeId: 'fixture', region: { from: 0, to: 1 } },
    documents: [],
    self: 'data',
    locals: new Map(),
    name(node) {
      return 'name' in node ? String(node.name) : node.$type;
    }
  };
}
export async function linkedExpressions(texts: readonly string[]): Promise<RosettaExpression[]> {
  const source =
    'namespace python.expressions\n' +
    texts
      .map(
        (text, index) =>
          `func Case${index}:\n inputs:\n  a number (0..1)\n  b number (0..1)\n output:\n  result number (0..1)\n set result: ${text}\n`
      )
      .join('\n');
  return (await linkedFunctions(source)).map((func) => func.operations[0]!.expression);
}
export async function linkedFunctions(source: string): Promise<RosettaFunction[]> {
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('inmemory:///python.rosetta')
  );
  const basics = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    BASICTYPES_ROSETTA,
    URI.parse('inmemory:///basics.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([basics, document]);
  expect(document.parseResult.parserErrors.map((error) => error.message)).toEqual([]);
  assertValidDocuments([document]);
  const model = document.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Expected model');
  return model.elements.filter((element) => element.$type === 'RosettaFunction');
}
export function runPython(
  cases: readonly { expression: string; data?: unknown }[],
  source = '',
  options: { includeRuntime?: boolean } = {}
): unknown[] {
  const result = spawnSync(
    process.env.PYTHON_BINARY ?? 'python3',
    [new URL('python-runtime-check.py', import.meta.url).pathname],
    {
      encoding: 'utf8',
      input: JSON.stringify({
        source: options.includeRuntime === false ? source : PYTHON_RUNTIME_SOURCE + '\n' + source,
        cases
      })
    }
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
