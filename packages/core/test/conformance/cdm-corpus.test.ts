// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { URI } from 'langium';
import { loadCorpusFixtures, loadAllFixtures, fixtureVersion, listFixtures } from '../helpers/fixture-loader.js';
import { parse } from '../../src/api/parse.js';
import { addLegacyAnnotations, assertValidDocuments, createRuneDslServices } from '../../src/index.js';

describe('CDM Corpus Conformance (SC-001)', () => {
  it('should have vendored CDM fixtures', async () => {
    const version = await fixtureVersion('cdm');
    expect(version).toBeDefined();
    const files = await listFixtures('cdm');
    expect(files.length).toBeGreaterThan(0);
  });

  it('should parse all CDM .rosetta files without parse errors', async () => {
    const fixtures = await loadAllFixtures('cdm');
    expect(fixtures.length).toBeGreaterThan(0);

    const results: Array<{ name: string; errors: string[] }> = [];
    let _totalErrors = 0;

    for (const { name, content } of fixtures) {
      const result = await parse(content, `inmemory:///cdm/${name}`);
      const errors = [
        ...result.lexerErrors.map((e) => `[lexer] ${e.message}`),
        ...result.parserErrors.map((e) => `[parser] ${e.message}`)
      ];
      if (errors.length > 0) {
        results.push({ name, errors });
        _totalErrors += errors.length;
      }
    }

    if (results.length > 0) {
      const summary = results
        .map((r) => `  ${r.name}: ${r.errors.length} error(s)\n${r.errors.map((e) => `    ${e}`).join('\n')}`)
        .join('\n');
      console.log(`CDM parse failures (${results.length}/${fixtures.length} files):\n${summary}`);
    }

    // SC-001: 100% parse rate
    const parseRate = ((fixtures.length - results.length) / fixtures.length) * 100;
    console.log(
      `CDM parse rate: ${parseRate.toFixed(1)}% (${fixtures.length - results.length}/${fixtures.length} files)`
    );
    expect(results.length).toBe(0);
  }, 30_000);

  it('should parse and link the entire dependency workspace without exclusions', async () => {
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
    for (const document of documents) expect(document.parseResult.value.$type).toBe('RosettaModel');
    console.info('Full corpus parse/link gate:', {
      sources: sources.map(({ corpus, version, files }) => ({ corpus, version, documents: files.length })),
      documents: documents.length,
      references: documents.reduce((total, document) => total + document.references.length, 0)
    });
  }, 60_000);
});

describe('Rune DSL Built-in Types', () => {
  it('should have vendored Rune DSL fixtures', async () => {
    const version = await fixtureVersion('rune-dsl');
    expect(version).toBeDefined();
    const files = await listFixtures('rune-dsl');
    expect(files.length).toBeGreaterThan(0);
  });

  it('should parse all Rune DSL built-in type files', async () => {
    const fixtures = await loadAllFixtures('rune-dsl');
    expect(fixtures.length).toBeGreaterThan(0);

    for (const { name, content } of fixtures) {
      const result = await parse(content, `inmemory:///rune-dsl/${name}`);
      const errors = [
        ...result.lexerErrors.map((e) => `[lexer] ${e.message}`),
        ...result.parserErrors.map((e) => `[parser] ${e.message}`)
      ];
      expect(errors, `Parse errors in ${name}:\n${errors.join('\n')}`).toHaveLength(0);
    }
  });
});
