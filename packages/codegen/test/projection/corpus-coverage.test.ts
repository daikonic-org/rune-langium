// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AstUtils, URI } from 'langium';
import {
  addLegacyAnnotations,
  assertValidDocuments,
  createRuneDslServices,
  getNodeSourceRegion,
  isData,
  isRosettaFunction,
  isRosettaExpression,
  isRosettaRule,
  isRosettaModel
} from '@rune-langium/core';
import { loadCorpusFixtures } from '../../../core/test/helpers/fixture-loader.js';
import {
  createPythonProjectionContext,
  projectPythonFunction,
  projectPythonCondition
} from '../../src/projection/python-functions.js';
import { renderPythonExpression } from '../../src/projection/python.js';
import { PYTHON_RUNTIME_SOURCE } from '../../src/projection/python-runtime.js';

const resources = resolve(import.meta.dirname, '../../../../.resources');

describe.skipIf(!existsSync(resolve(resources, 'cdm')))('staged Python projection corpus', () => {
  it('requires the full corpus to link before rendering and compiling every implementation and condition', async () => {
    const sources = await loadCorpusFixtures();
    const { RuneDsl } = createRuneDslServices();
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const documents = sources.flatMap(({ corpus, files }) =>
      files.map(({ name, content }) => {
        const document = factory.fromString(content, URI.parse(`file:///corpus/${corpus}/${name}`));
        return corpus === 'rune-dsl' && name === 'annotations.rosetta'
          ? addLegacyAnnotations(document, factory)
          : document;
      })
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    assertValidDocuments(documents);
    const context = createPythonProjectionContext(documents, { uri: '', nodeId: '', region: { from: 0, to: 0 } });
    const code: string[] = [],
      kinds = new Map<string, number>(),
      refusals: string[] = [];
    let functions = 0,
      conditions = 0,
      rules = 0,
      nativeBindings = 0;
    for (const document of documents) {
      const model = document.parseResult.value;
      if (!isRosettaModel(model)) throw new Error(`Expected Rune model in ${document.uri}`);
      for (const node of model.elements) {
        const subjects = isRosettaFunction(node) || isRosettaRule(node) ? [node] : isData(node) ? node.conditions : [];
        for (const subject of subjects) {
          const region = getNodeSourceRegion(subject);
          const bound = {
            ...context,
            subject: { uri: document.uri.toString(), nodeId: 'name' in node ? node.name : node.$type, region }
          };
          try {
            if (isRosettaFunction(subject)) {
              const projected = projectPythonFunction(subject, bound);
              code.push(projected.code);
              functions++;
              if (context.functionFacts?.get(subject)?.isAbstract) nativeBindings++;
            } else if (isRosettaRule(subject)) {
              const expression = renderPythonExpression(subject.expression, {
                ...bound,
                self: 'data',
                resultMode: 'condition',
                state: { next: 0 }
              });
              code.push(`def ${context.name(subject)}(data=None):\n    return ${expression}\n`);
              rules++;
            } else {
              code.push(projectPythonCondition(subject, bound).code);
              conditions++;
            }
            for (const child of AstUtils.streamAllContents(subject))
              if (isRosettaExpression(child)) kinds.set(child.$type, (kinds.get(child.$type) ?? 0) + 1);
          } catch (error) {
            refusals.push(`${document.uri.toString()}:${region.from}: ${(error as Error).message}`);
          }
        }
      }
    }
    const report = {
      sources: sources.map(({ corpus, version, files }) => ({
        corpus,
        version,
        files: files.length,
        contentSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex')
      })),
      functions,
      conditions,
      rules,
      nativeBindings,
      documents: documents.length,
      references: documents.reduce((total, document) => total + document.references.length, 0),
      syntaxDocuments: 0,
      unlinkedDeclarations: 0,
      expressionKinds: Object.fromEntries(kinds),
      refusals
    };
    const reportDirectory = resolve(import.meta.dirname, '../../dist');
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(
      resolve(reportDirectory, 'python-projection-coverage.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    console.info(JSON.stringify(report, null, 2));
    expect(functions).toBeGreaterThan(0);
    expect(conditions).toBeGreaterThan(0);
    expect(refusals).toEqual([]);
    const result = spawnSync(
      process.env.PYTHON_BINARY ?? 'python3',
      [new URL('python-runtime-check.py', import.meta.url).pathname],
      {
        input: JSON.stringify({ source: PYTHON_RUNTIME_SOURCE + '\n' + code.join('\n'), syntax_only: true, cases: [] }),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
      }
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  }, 120_000);
});
