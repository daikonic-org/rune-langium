// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { existsSync, readFileSync } from 'node:fs';
import { BASE_TYPE_FILES } from '@rune-langium/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { loadRealWorker, type WorkerScope } from './helpers/real-codegen-worker.js';

async function waitForMessage(scope: WorkerScope, type: string): Promise<void> {
  await vi.waitFor(() => {
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });
}

describe('codegen-worker parsed/emitted function execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates deep recursive Data/Choice payloads and executes recursive function inputs', async () => {
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        {
          uri: 'file:///recursive.rosetta',
          content: `namespace recursive
type Node:
 value int (1..1)
 next Node (0..1)
 children Node (0..*)
 content Content (0..1)
choice Content:
 Node
 string
func Identity:
 inputs: node Node (1..1)
 output: result Node (1..1)
 set result: node
`
        }
      ]
    });
    const tail = { value: 8, children: [] };
    let data: Record<string, unknown> = tail;
    for (let value = 7; value >= 0; value--) data = { value, next: data, children: [] };
    data.content = { node: { value: 9, children: [] } };
    data.children = [{ value: 10, children: [] }];
    dispatch({ type: 'instance:validate', typeFqn: 'recursive.Node', data, requestId: 'deep:valid' });
    await vi.waitFor(
      () =>
        expect(scope.postMessage).toHaveBeenCalledWith({
          type: 'instance:validateResult',
          requestId: 'deep:valid',
          diagnostics: []
        }),
      { timeout: 15000 }
    );
    dispatch({
      type: 'preview:execute',
      funcName: 'recursive.Identity',
      inputs: { node: data },
      requestId: 'deep:execute'
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'preview:execute-result',
        requestId: 'deep:execute',
        funcName: 'recursive.Identity',
        output: data
      })
    );
    const invalid = structuredClone(data);
    (invalid.content as { node: { value: unknown } }).node.value = 'invalid';
    dispatch({ type: 'instance:validate', typeFqn: 'recursive.Node', data: invalid, requestId: 'deep:invalid' });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'instance:validateResult',
          requestId: 'deep:invalid',
          diagnostics: expect.arrayContaining([expect.objectContaining({ path: 'content' })])
        })
      )
    );
  }, 20000);

  it.skipIf(!existsSync('../../.resources/cdm/base-math-func.rosetta'))(
    'executes StringEquals from the real CDM math namespace',
    async () => {
      const { scope, dispatch } = await loadRealWorker();
      dispatch({
        type: 'preview:setFiles',
        filesRevision: 1,
        files: [
          ...BASE_TYPE_FILES.map((f) => ({ uri: f.path, content: f.content })),
          ...['func', 'type', 'enum'].map((kind) => ({
            uri: `file:///base-math-${kind}.rosetta`,
            content: readFileSync(`../../.resources/cdm/base-math-${kind}.rosetta`, 'utf8')
          }))
        ]
      });
      dispatch({
        type: 'preview:execute',
        funcName: 'cdm.base.math.StringEquals',
        inputs: { s1: 'hello', s2: 'hello' },
        requestId: 'cdm:equals'
      });
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'cdm:equals' }))
      );
      expect(
        scope.postMessage.mock.calls.map(([message]) => message).find((message) => message.requestId === 'cdm:equals')
      ).toEqual({
        type: 'preview:execute-result',
        requestId: 'cdm:equals',
        funcName: 'cdm.base.math.StringEquals',
        output: true
      });
    }
  );

  it('returns constructed objects from collection callbacks', async () => {
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        {
          uri: 'file:///objects.rosetta',
          content: `namespace objects
type Box:
 value int (1..1)
func Wrap:
 inputs: values int (0..*)
 output: result Box (0..*)
 set result: values extract x [Box { value: x }]`
        }
      ]
    });
    dispatch({ type: 'preview:execute', funcName: 'objects.Wrap', inputs: { values: [1, 2] }, requestId: 'objects' });
    await waitForMessage(scope, 'preview:execute-result');
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'preview:execute-result',
      funcName: 'objects.Wrap',
      requestId: 'objects',
      output: [{ value: 1 }, { value: 2 }]
    });
  });

  it('executes models whose type names match private evaluator bindings', async () => {
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      requestId: 'bindings:files',
      files: [
        {
          uri: 'file:///bindings.rosetta',
          content: `namespace bindings
type __generatedRuntime:
 value int (1..1)
type __module:
 value int (1..1)
type __functionRuntime:
 value int (1..1)
func Read:
 inputs: value __generatedRuntime (1..1)
 output: result __module (1..1)
 set result: __module {value: value -> value}`
        }
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    dispatch({
      type: 'preview:execute',
      funcName: 'bindings.Read',
      inputs: { value: { value: 7 } },
      requestId: 'bindings:execute'
    });
    await waitForMessage(scope, 'preview:execute-result');
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      funcName: 'bindings.Read',
      requestId: 'bindings:execute',
      output: { value: 7 }
    });
  }, 15_000);

  it.each([undefined, 5])(
    'adapts raw inherited metadata inputs, including recursive fields (optional=%s)',
    async (maybe) => {
      const { scope, dispatch } = await loadRealWorker();
      dispatch({
        type: 'preview:setFiles',
        filesRevision: 1,
        requestId: 'metadata:files',
        files: [
          {
            uri: 'file:///metadata.rosetta',
            content: `namespace forms
type Payload:
 next Payload (0..1)
 value int (1..1)
 items int (0..*)
  [metadata scheme]
type Result:
 amount int (1..1)
 maybe int (0..1)
 values int (0..*)
 payload Payload (1..1)
func Base:
 inputs:
  amount int (1..1)
   [metadata scheme]
  maybe int (0..1)
   [metadata reference]
  values int (0..*)
   [metadata reference]
  payload Payload (1..1)
   [metadata scheme]
 output: result Result (1..1)
 set result: Result { amount: amount, maybe: maybe, values: values, payload: payload }
func Derived extends Base:
 set result: super(amount, maybe, values, payload)`
          }
        ]
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const tail = { value: 9, items: [6] };
      const inputs = {
        amount: 0,
        maybe,
        values: [0, 2],
        payload: { value: 7, items: [3, 4], next: { value: 8, items: [], next: { value: 8, items: [], next: tail } } }
      };
      const original = structuredClone(inputs);
      dispatch({ type: 'preview:execute', funcName: 'forms.Derived', inputs, requestId: 'metadata:execute' });
      await waitForMessage(scope, 'preview:execute-result');
      expect(scope.postMessage).toHaveBeenLastCalledWith({
        type: 'preview:execute-result',
        funcName: 'forms.Derived',
        requestId: 'metadata:execute',
        output: {
          amount: 0,
          maybe,
          values: [0, 2],
          payload: {
            value: 7,
            items: [
              { value: 3, meta: {} },
              { value: 4, meta: {} }
            ],
            next: {
              value: 8,
              items: [],
              next: { value: 8, items: [], next: { value: 9, items: [{ value: 6, meta: {} }] } }
            }
          }
        }
      });
      expect(inputs).toEqual(original);
    },
    15_000
  );

  it('executes qualified calls when both namespaces declare the same function name', async () => {
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      requestId: 'qualified:files',
      files: [
        {
          uri: 'file:///alpha.rosetta',
          content: `namespace alpha
func Echo:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value + 1`
        },
        {
          uri: 'file:///beta.rosetta',
          content: `namespace beta
func Echo:
 inputs: value int (1..1)
 output: result int (1..1)
 alias Echo: value + 10
 set result: alpha.Echo(value) + Echo`
        }
      ]
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    dispatch({ type: 'preview:execute', funcName: 'beta.Echo', inputs: { value: 4 }, requestId: 'qualified:execute' });
    await waitForMessage(scope, 'preview:execute-result');
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      funcName: 'beta.Echo',
      requestId: 'qualified:execute',
      output: 19
    });
  }, 15_000);

  it('executes a parsed and emitted function using generated generic set helpers', async () => {
    const { scope, dispatch } = await loadRealWorker();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        {
          uri: 'file:///real-preview.rosetta',
          content: `
            namespace "real.preview"
            version "1"
            func Unique:
              inputs:
                values number (0..*)
              output:
                result number (0..*)
              set result: values distinct
          `
        }
      ],
      requestId: 'real:files'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    dispatch({
      type: 'preview:execute',
      funcName: 'real.preview.Unique',
      inputs: { values: [2, 2, 1] },
      requestId: 'real:execute'
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await waitForMessage(scope, 'preview:execute-result');

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      requestId: 'real:execute',
      funcName: 'real.preview.Unique',
      output: [2, 1]
    });
  }, 15_000);
});

it('links a newly authored function to hydrated curated input types, then validates and executes it', async () => {
  const documents = await declarationDocuments([
    ['terms', 'namespace curated.terms\ntype Terms:\n amount number (1..1)\n']
  ]);
  const { scope, dispatch } = await loadRealWorker();
  dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      { uri: 'file:///[cdm]/terms.rosetta', content: '', serializedModelJson: documents[0]!.serializedModel },
      {
        uri: 'file:///workspace/local.rosetta',
        content:
          'namespace local.copy\nimport curated.terms.*\nfunc Compute:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n set result: terms -> amount * 2\n'
      }
    ]
  });
  dispatch({
    type: 'instance:generateSchema',
    typeFqn: 'local.copy.Compute#RosettaFunction',
    requestId: 'copy:schema'
  });
  await vi.waitFor(
    () =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'instance:generateSchemaResult',
          requestId: 'copy:schema',
          schema: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                path: 'terms',
                kind: 'object',
                children: expect.arrayContaining([expect.objectContaining({ path: 'terms.amount', kind: 'number' })])
              })
            ])
          })
        })
      ),
    { timeout: 10000 }
  );
  dispatch({
    type: 'preview:execute',
    funcName: 'local.copy.Compute',
    inputs: { terms: { amount: 12 } },
    requestId: 'copy:execute'
  });
  await vi.waitFor(
    () =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preview:execute-result', requestId: 'copy:execute', output: 24 })
      ),
    { timeout: 10000 }
  );
  // Unloading the reference corpus must not leave its exports available to raw source.
  dispatch({
    type: 'preview:setFiles',
    filesRevision: 2,
    files: [
      {
        uri: 'file:///workspace/local.rosetta',
        content:
          'namespace local.copy\nimport curated.terms.*\nfunc Compute:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n set result: 1\n'
      }
    ]
  });
  dispatch({
    type: 'instance:generateSchema',
    typeFqn: 'local.copy.Compute#RosettaFunction',
    requestId: 'copy:unloaded'
  });
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instance:generateSchemaResult',
        requestId: 'copy:unloaded',
        schema: expect.objectContaining({
          fields: expect.arrayContaining([expect.objectContaining({ path: 'terms', kind: 'unknown' })])
        })
      })
    )
  );
  vi.unstubAllGlobals();
}, 25000);

it('installs a verified project before preview and executes curated callers through local overrides', async () => {
  const { createProjectDraftSnapshot } = await import('@rune-langium/project-config');
  const { captureProjectRuntimeInput } = await import('../../src/services/project-runtime-input.js');
  const { projectOverrideInput } = await import('../helpers/project-override-input.js');
  const { input: project, snapshot, files: sources } = await projectOverrideInput();
  const { scope, dispatch } = await loadRealWorker();
  const files = sources.map((file) => ({ uri: 'file:///workspace/' + file.path, content: file.content }));
  dispatch({ type: 'preview:setFiles', filesRevision: 1, files, project, requestId: 'project:install' });
  await vi.waitFor(
    () =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:files-ready',
          requestId: 'project:install',
          projectReceipt: project.receipt
        })
      ),
    { timeout: 15000 }
  );
  dispatch({
    type: 'preview:execute',
    funcName: 'ref.Caller',
    inputs: { amount: 10 },
    requestId: 'project:caller',
    projectReceipt: project.receipt
  });
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview:execute-result',
        requestId: 'project:caller',
        output: 12,
        projectReceipt: project.receipt
      })
    )
  );
  dispatch({
    type: 'preview:execute',
    funcName: 'ref.Compute',
    inputs: { amount: 10 },
    requestId: 'project:direct',
    projectReceipt: project.receipt
  });
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview:execute-result',
        requestId: 'project:direct',
        output: 12,
        projectReceipt: project.receipt
      })
    )
  );
  dispatch({
    type: 'preview:execute',
    funcName: 'ref.Caller',
    inputs: { amount: 10 },
    requestId: 'project:stale',
    projectReceipt: { ...project.receipt, revision: '0'.repeat(64) }
  });
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'preview:execute-error', requestId: 'project:stale' })
    )
  );
  expect(
    scope.postMessage.mock.calls.some(
      ([message]) => message.type === 'preview:execute-result' && message.requestId === 'project:stale'
    )
  ).toBe(false);
  const brokenSnapshot = await createProjectDraftSnapshot(
    snapshot,
    new Map([['model/custom.rosetta', null]]),
    () => []
  );
  const broken = await captureProjectRuntimeInput(brokenSnapshot, [], project.referenceDocuments);
  dispatch({ type: 'preview:setFiles', filesRevision: 2, files, project: broken, requestId: 'project:broken' });
  await vi.waitFor(() =>
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview:files-ready',
        requestId: 'project:broken',
        projectError: expect.any(String)
      })
    )
  );
  expect(
    scope.postMessage.mock.calls.some(([message]) => message.requestId === 'project:broken' && message.projectReceipt)
  ).toBe(false);
  vi.unstubAllGlobals();
}, 25000);
