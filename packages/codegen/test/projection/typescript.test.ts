// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, describe, expect, it } from 'vitest';
import { AstUtils, URI } from 'langium';
import { Temporal } from '@js-temporal/polyfill';
import ts from 'typescript-classic';
import {
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  getNodeSourceRegion,
  isRosettaFunction,
  isData,
  getExpressionRegions
} from '@rune-langium/core';
import { generate, selectTypeScriptProjection } from '../../src/export.js';
import { referenceFiles } from '../helpers/cdm-reference.js';

describe('authoritative TypeScript projections', () => {
  const { RuneDsl } = createRuneDslServices();
  let outputs: Awaited<ReturnType<typeof generate>>;
  const documents = referenceFiles().map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  beforeAll(async () => {
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    outputs = await generate(documents, { target: 'typescript', strict: true });
  });

  it('displays each pinned typed function using its actual generated declaration', () => {
    let count = 0;
    for (const doc of documents)
      for (const node of AstUtils.streamAst(doc.parseResult.value)) {
        if (!isRosettaFunction(node)) continue;
        const generated = outputs.flatMap((output) => output.funcs).find((func) => func.name === node.name);
        if (!generated) continue;
        const subject = { uri: doc.uri.toString(), nodeId: `selected:${node.name}`, region: getNodeSourceRegion(node) };
        const projected = selectTypeScriptProjection(outputs, subject, 'function');
        expect(projected.code, node.name).toBe(generated.fileContents);
        if (projected.code.includes('rune.equals(')) expect(projected.requiredHelpers).toContain('rune');
        expect(projected.subject).toEqual(subject);
        expect(projected.sourceMap.length).toBeGreaterThan(0);
        count++;
      }
    expect(count).toBe(outputs.flatMap((output) => output.funcs).length);
    expect(count).toBeGreaterThan(10);
  });

  it('records Data condition code during emission using the same predicate', () => {
    let count = 0;
    for (const doc of documents)
      for (const node of AstUtils.streamAst(doc.parseResult.value)) {
        if (!isData(node)) continue;
        const regions = getExpressionRegions(node);
        for (const { region } of regions) {
          const subject = { uri: doc.uri.toString(), nodeId: 'selected:data-rule', region };
          const projected = selectTypeScriptProjection(outputs, subject, 'condition');
          expect(outputs.some((output) => output.content.includes(projected.code))).toBe(true);
          if (projected.code.includes('rune.equals(')) expect(projected.requiredHelpers).toContain('rune');
          expect(projected.sourceMap[0]!.sourceUri).toBe(subject.uri);
          count++;
        }
      }
    expect(count).toBeGreaterThan(0);
  });

  it('reports a real missing subject instead of a reversible-subset refusal', () => {
    expect(() =>
      selectTypeScriptProjection(
        outputs,
        { uri: 'file:///missing.rosetta', nodeId: 'missing', region: { from: 0, to: 1 } },
        'function'
      )
    ).toThrow('No generated');
  });

  it('preserves Temporal semantics in function precondition and postcondition bodies', async () => {
    const { RuneDsl: services } = createRuneDslServices();
    const factory = services.shared.workspace.LangiumDocumentFactory;
    const doc = factory.fromString(
      `namespace typed.calendar
func Calendar:
 inputs: left date (1..1) right date (1..1)
 output: result date (1..1)
 condition Ordered: left <= right
 set result: left
 post-condition Same: left = right
`,
      URI.parse('inmemory:///calendar-projections.rosetta')
    );
    const builtins = factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basictypes.rosetta'));
    await services.shared.workspace.DocumentBuilder.build([builtins, doc]);
    expect(doc.parseResult.parserErrors).toEqual([]);
    const generated = await generate([builtins, doc], { target: 'typescript', strict: true });
    expect(
      generated.flatMap((output) => output.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'))
    ).toEqual([]);
    const owner = [...AstUtils.streamAst(doc.parseResult.value)].find(isRosettaFunction)!;
    const regions = getExpressionRegions(owner).filter(
      ({ kind }) => kind === 'precondition' || kind === 'postcondition'
    );
    expect(regions).toHaveLength(2);
    for (const { kind, region } of regions) {
      const projected = selectTypeScriptProjection(
        generated,
        { uri: doc.uri.toString(), nodeId: owner.name, region },
        'condition',
        'body'
      );
      const predicate = new Function(
        'left',
        'right',
        'result',
        'Temporal',
        ts.transpileModule(`return ${projected.code};`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 }
        }).outputText
      );
      const left = Temporal.PlainDate.from('2026-10-10');
      const right = Temporal.PlainDate.from('2026-10-10');
      expect(predicate(left, right, left, Temporal), kind).toBe(true);
      const earlier = Temporal.PlainDate.from('2026-10-09');
      expect(predicate(left, earlier, left, Temporal), kind).toBe(false);
      expect(projected.code).toContain(kind === 'precondition' ? 'Temporal.PlainDate.compare(' : '.equals(');
    }
  });

  it('retains provenance when namespaces are bundled into a single file', async () => {
    const bundled = await generate(documents, {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'single-file' }
    });
    const owner = documents.flatMap((doc) =>
      [...AstUtils.streamAst(doc.parseResult.value)].filter(isRosettaFunction)
    )[0]!;
    const subject = {
      uri: AstUtils.getDocument(owner).uri.toString(),
      nodeId: owner.name,
      region: getNodeSourceRegion(owner)
    };
    const projected = selectTypeScriptProjection(bundled, subject, 'function');
    expect(bundled.some((output) => output.content.includes(projected.code))).toBe(true);
  }, 30_000);
});
