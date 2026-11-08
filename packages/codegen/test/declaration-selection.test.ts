// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { createRuneDslServices, isData, isRosettaModel, type RosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { declarationKey, generate, generateSelected, resolveExportSelection } from '../src/export.js';
import { compileGeneratedTypeScript } from './helpers/compiled-typescript.js';

describe('declaration selection', () => {
  it.each([false, true])(
    'does not force references when all effective roots are explicit (override=%s)',
    async (override) => {
      const { shared } = createRuneDslServices();
      await shared.workspace.WorkspaceManager.initializeWorkspace([]);
      const documents = [
        'namespace closed\ntype Dep:\n value string (1..1)\ntype Root:\n dep Dep (1..1)',
        ...(override ? ['override namespace closed\ntype Dep:\n replacement boolean (1..1)'] : [])
      ].map((source, index) =>
        shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
          source,
          URI.parse(`inmemory:///closed-${index}.rosetta`)
        )
      );
      for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
      await shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
      expect(documents.flatMap((document) => document.diagnostics ?? [])).toEqual([]);
      const root = documents[0]!.parseResult.value.elements.find((node) => isData(node) && node.name === 'Root');
      if (!isData(root)) throw new Error('Expected Root data');
      const reference = root.attributes[0]!.typeCall.type;
      const target = reference.ref;
      const read = vi.fn(() => target);
      Object.defineProperty(reference, 'ref', { get: read });

      const complete = resolveExportSelection(documents, { namespaces: ['closed'], declarations: [] });
      expect(complete.included).toHaveLength(2);
      expect(complete.explicit).toEqual(complete.included);
      expect(complete.requiredBy.size).toBe(0);
      expect(
        complete.documents.flatMap((document) => {
          const model = document.parseResult.value;
          return isRosettaModel(model) ? model.elements : [];
        })
      ).toContain(target);
      expect(read).not.toHaveBeenCalled();

      const partial = resolveExportSelection(documents, {
        namespaces: [],
        declarations: [{ namespace: 'closed', kind: 'Data', name: 'Root' }]
      });
      expect(partial.included).toEqual(expect.arrayContaining([...complete.included]));
      expect(partial.included).toHaveLength(complete.included.length);
      expect(partial.requiredBy.get(declarationKey({ namespace: 'closed', kind: 'Data', name: 'Dep' }))).toEqual([
        declarationKey({ namespace: 'closed', kind: 'Data', name: 'Root' })
      ]);
      expect(read).toHaveBeenCalled();
    }
  );

  it('keeps effective transitive dispatch families and their dependencies after a complete namespace override', async () => {
    const { shared } = createRuneDslServices();
    await shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const documents = [
      `namespace dispatch
enum Mode:
 Fast
 Slow
func Compute:
 inputs:
  mode Mode (1..1)
  amount number (1..1)
 output: result number (1..1)
func Compute(mode: Mode -> Fast):
 set result: amount + 1
func Compute(mode: Mode -> Slow):
 set result: amount + 2
func Caller:
 inputs:
  mode Mode (1..1)
  amount number (1..1)
 output: result number (1..1)
 set result: Compute(mode, amount)`,
      `override namespace dispatch
import helpers.*
func Compute:
 inputs:
  mode Mode (1..1)
  amount number (1..1)
 output: result number (1..1)
func Compute(mode: Mode -> Fast):
 set result: Multiply(amount)
func Compute(mode: Mode -> Slow):
 set result: Multiply(amount) + amount`,
      `namespace helpers
func Multiply:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: amount * 2`,
      `namespace unrelated
func Compute:
 output: result number (1..1)
 set result: 999`
    ].map((text, index) =>
      shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///dispatch-${index}.rosetta`))
    );
    for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
    await shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
    expect(documents.flatMap((document) => document.diagnostics ?? [])).toEqual([]);
    const result = await generateSelected(
      documents,
      { namespaces: [], declarations: [{ namespace: 'dispatch', kind: 'RosettaFunction', name: 'Caller' }] },
      { target: 'typescript', strict: true }
    );
    const fn = result.outputs.flatMap((output) => output.funcs).find((fn) => fn.name === 'Caller')!;
    const entry = result.outputs.find((output) => output.funcs.includes(fn))!.relativePath;
    const compiled = compileGeneratedTypeScript(result.outputs, { entry });
    expect(compiled[fn.exportName!]!('Fast', 10)).toBe(20);
    expect(compiled[fn.exportName!]!('Slow', 10)).toBe(30);
    expect(result.selection.included.some((root) => root.namespace === 'unrelated')).toBe(false);
    expect(
      result.selection.requiredBy.get(
        declarationKey({ namespace: 'helpers', kind: 'RosettaFunction', name: 'Multiply' })
      )
    ).toEqual([declarationKey({ namespace: 'dispatch', kind: 'RosettaFunction', name: 'Caller' })]);
  });
  it('compiles and executes a selected original caller through a same-namespace override', async () => {
    const { shared } = createRuneDslServices();
    await shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const documents = [
      'namespace native\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 1\nfunc Caller:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: Compute(amount)',
      'override namespace native\nfunc Compute:\n inputs: amount number (1..1)\n output: result number (1..1)\n set result: amount + 2'
    ].map((text, i) =>
      shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///native-${i}.rosetta`))
    );
    for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
    await shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
    expect(documents.flatMap((document) => document.diagnostics ?? [])).toEqual([]);
    const result = await generateSelected(
      documents,
      { namespaces: [], declarations: [{ namespace: 'native', kind: 'RosettaFunction', name: 'Caller' }] },
      { target: 'typescript' }
    );
    expect(result.outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const code = result.outputs.map((output) => output.content).join('\n');
    expect(code).not.toMatch(/amount\s*\+\s*1/);
    const compiled = compileGeneratedTypeScript<{ Caller: (amount: number) => number }>(result.outputs);
    expect(compiled.Caller(10)).toBe(12);
  });
  it('includes a selected declaration dependency and excludes an unrelated sibling', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
type Dep:
  value string (1..1)
type Party:
  dep Dep (1..1)
type Unrelated:
  ignored string (1..1)`,
      URI.parse('inmemory:///selection.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.diagnostics ?? []).toEqual([]);

    const outputs = await generate(doc, {
      target: 'typescript',
      selection: { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }
    });
    const content = outputs.map((output) => output.content).join('\n');
    expect(content).toMatch(/(?:class|interface|type|enum)\s+Party\b/);
    expect(content).toMatch(/(?:class|interface|type|enum)\s+Dep\b/);
    expect(content).not.toMatch(/(?:class|interface|type|enum)\s+Unrelated\b/);
  });

  it('treats a selected namespace as roots for all of its declarations', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
type Included:
  value string (1..1)
type AlsoIncluded:
  value string (1..1)`,
      URI.parse('inmemory:///selection-namespace.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.diagnostics ?? []).toEqual([]);

    const outputs = await generate(doc, {
      target: 'typescript',
      selection: { namespaces: ['test'], declarations: [] }
    });
    const content = outputs.map((output) => output.content).join('\n');
    expect(content).toMatch(/(?:class|interface|type|enum)\s+Included\b/);
    expect(content).toMatch(/(?:class|interface|type|enum)\s+AlsoIncluded\b/);
  });

  it('reports unknown declaration roots without mutating the source document', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
type Party:
  name string (1..1)`,
      URI.parse('inmemory:///selection-unknown.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    const model = doc.parseResult.value as unknown as { elements: unknown[] };
    const elements = model.elements;

    const result = resolveExportSelection([doc], {
      namespaces: [],
      declarations: [{ namespace: 'test', name: 'Missing', kind: 'Data' }]
    });

    expect(result.unknown).toEqual([{ namespace: 'test', name: 'Missing', kind: 'Data' }]);
    expect(result.unknownNamespaces).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(model.elements).toBe(elements);

    const outputs = await generate(doc, {
      target: 'typescript',
      selection: { namespaces: [], declarations: [{ namespace: 'test', name: 'Missing', kind: 'Data' }] }
    });
    expect(outputs[0]?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unknown-export-selection' })])
    );
  });

  it('rejects a selected namespace that no longer exists', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
type Party:
  name string (1..1)`,
      URI.parse('inmemory:///selection-unknown-namespace.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

    const result = resolveExportSelection([doc], { namespaces: ['missing'], declarations: [] });
    expect(result.unknown).toEqual([]);
    expect(result.unknownNamespaces).toEqual(['missing']);

    const outputs = await generate(doc, {
      target: 'typescript',
      selection: { namespaces: ['missing'], declarations: [] }
    });
    expect(outputs[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-export-selection', message: "Unknown namespace 'missing'." })
      ])
    );
  });

  it('returns the receipt used for declaration-scoped generation', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
type Dep:
  value string (1..1)
type Party:
  dep Dep (1..1)`,
      URI.parse('inmemory:///selection-receipt.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

    const result = await generateSelected(
      doc,
      { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] },
      { target: 'typescript' }
    );

    expect(result.selection.explicit).toEqual([{ namespace: 'test', name: 'Party', kind: 'Data' }]);
    expect(result.selection.included).toEqual(
      expect.arrayContaining([
        { namespace: 'test', name: 'Party', kind: 'Data' },
        { namespace: 'test', name: 'Dep', kind: 'Data' }
      ])
    );
    expect(result.selection.requiredBy).toEqual(
      new Map([
        [
          declarationKey({ namespace: 'test', name: 'Dep', kind: 'Data' }),
          [declarationKey({ namespace: 'test', name: 'Party', kind: 'Data' })]
        ]
      ])
    );
    expect(result.outputs.flatMap((output) => output.diagnostics)).toEqual([]);
  });

  it('records one receipt root for a selected dispatch function and all of its overloads', async () => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace test
enum Kind:
 Cash
 Credit
type CashResult:
 amount number (1..1)
type CreditResult:
 amount number (1..1)
func Compute:
 inputs:
  kind Kind (1..1)
 output:
  result CashResult (1..1)
func Compute(kind: Kind -> Cash):
func Compute(kind: Kind -> Credit):`,
      URI.parse('inmemory:///selection-dispatch.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.diagnostics ?? []).toEqual([]);

    const selection = resolveExportSelection([doc], {
      namespaces: [],
      declarations: [{ namespace: 'test', name: 'Compute', kind: 'RosettaFunction' }]
    });

    expect(selection.explicit).toEqual([{ namespace: 'test', name: 'Compute', kind: 'RosettaFunction' }]);
    expect(selection.included.filter((item) => item.name === 'Compute')).toEqual([
      { namespace: 'test', name: 'Compute', kind: 'RosettaFunction' }
    ]);
    expect(
      selection.requiredBy.get(declarationKey({ namespace: 'test', name: 'Kind', kind: 'RosettaEnumeration' }))
    ).toEqual([declarationKey({ namespace: 'test', name: 'Compute', kind: 'RosettaFunction' })]);
  });
});
