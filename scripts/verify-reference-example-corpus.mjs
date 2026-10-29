#!/usr/bin/env node
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import assert from 'node:assert/strict';
import ts from '../packages/codegen/node_modules/typescript-classic/lib/typescript.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createRuneDslServices,
  isData,
  isChoice,
  isRosettaFunction,
  isRosettaModel
} from '../packages/core/dist/index.js';
import { decodeRuneJson, encodeRuneJson, isRuneJsonPayload } from '../packages/core/dist/serialization/rune-json.js';
import { adaptPreviewData } from '../packages/codegen/dist/src/export.js';
import { isCuratedSourceFile } from '../packages/curated-schema/dist/index.js';
import {
  isRepositoryExample,
  prepareReferenceExample,
  referenceExecutionBindings
} from '../packages/project-runtime/dist/reference-examples.js';
const { URI } = await import(new URL('../packages/core/node_modules/langium/lib/index.js', import.meta.url));
const { values: options } = parseArgs({ options: { 'cache-dir': { type: 'string' }, report: { type: 'string' } } });
const pins = JSON.parse(
  await readFile(new URL('../test/fixtures/third-party/reference-example-corpus/sources.json', import.meta.url), 'utf8')
);
const cache = options['cache-dir'] ?? 'dist/reference-example-corpus';
const reportPath = options.report ?? 'dist/reference-example-import-report.json';
await mkdir(cache, { recursive: true });
await mkdir('dist', { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'rune-reference-imports-'));
const { RuneDsl } = createRuneDslServices();
const documents = [],
  inventories = [],
  failures = [];
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
try {
  for (const pin of pins.sources) {
    const archive = join(cache, `${pin.id}-${pin.commit}.tar.gz`);
    let bytes;
    try {
      bytes = await readFile(archive);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(`https://codeload.github.com/${pin.owner}/${pin.repo}/tar.gz/${pin.commit}`);
      assert(response.ok, `${pin.id}: archive HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, `${pin.id}: archive checksum`);
      await writeFile(archive, bytes);
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, `${pin.id}: cached archive checksum`);
    // Extract only the checksum-pinned archive in our own temporary directory.
    execFileSync('tar', ['-xzf', archive, '-C', temp]);
    const root = join(temp, `${pin.repo}-${pin.commit}`);
    const inventory = { ...pin, files: [], counts: {}, externalFunctionBindings: {}, javaFunctions: [] };
    for (const path of await files(root)) {
      const name = relative(root, path).split('\\').join('/');
      if (name.endsWith('.rosetta') && isCuratedSourceFile(pin.id, name)) {
        const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
          await readFile(path, 'utf8'),
          URI.parse(`inmemory:///${pin.id}/${name}`)
        );
        assert.equal(doc.parseResult.parserErrors.length, 0, `${pin.id}/${name}: model parse errors`);
        documents.push(doc);
      }
      if (name.includes('/src/main/java/') && name.endsWith('.java'))
        inventory.javaFunctions.push(
          name
            .split('/src/main/java/')[1]
            .replace(/\.java$/, '')
            .replaceAll('/', '.')
        );
      if (!/\.(json|xml)$/i.test(name)) continue;
      inventory.files.push({ path: name, format: name.endsWith('.json') ? 'JSON' : 'XML', file: path });
    }
    assert.equal(
      inventory.files.filter((entry) => entry.format === 'JSON').length,
      pin.jsonFiles,
      `${pin.id}: complete JSON inventory`
    );
    assert.equal(
      inventory.files.filter((entry) => isRepositoryExample(entry.path)).length,
      pin.exampleFiles,
      `${pin.id}: example discovery inventory`
    );
    inventories.push(inventory);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents);
  const symbols = documents.flatMap((doc) => {
    const model = doc.parseResult.value;
    return isRosettaModel(model)
      ? model.elements
          .filter((node) => isData(node) || isChoice(node) || isRosettaFunction(node))
          .map((node) => ({
            model: doc.uri.path.split('/')[1],
            namespace: model.name,
            name: node.name,
            kind: node.$type
          }))
      : [];
  });
  for (const inventory of inventories) {
    const origin = {
      model: inventory.id,
      repository: `https://github.com/${inventory.owner}/${inventory.repo}`,
      release: inventory.release,
      commit: inventory.commit
    };
    const paths = new Set(inventory.files.map((file) => file.path));
    const inputBindings = new Map();
    for (const descriptor of inventory.files.filter((file) => file.path.endsWith('-descriptor.json'))) {
      for (const [path, binding] of referenceExecutionBindings(
        descriptor.path,
        await readFile(descriptor.file, 'utf8')
      )) {
        assert(paths.has(path), `${descriptor.path}: missing catalog payload ${path}`);
        if (binding.role !== 'input') continue;
        const target = symbols.find(
          (symbol) =>
            symbol.model === inventory.id &&
            symbol.kind === 'RosettaFunction' &&
            `${symbol.namespace}.functions.${symbol.name}` === binding.descriptor.executableFunctionClass
        );
        if (!target) {
          assert(
            inventory.javaFunctions.includes(binding.descriptor.executableFunctionClass),
            `${descriptor.path}: missing catalog function ${binding.descriptor.executableFunctionClass}`
          );
          inventory.externalFunctionBindings[path] = binding.descriptor.executableFunctionClass;
        }
        const previous = inputBindings.get(path);
        if (previous)
          assert.equal(
            previous.descriptor.executableFunctionClass,
            binding.descriptor.executableFunctionClass,
            `${path}: conflicting catalogs`
          );
        inputBindings.set(path, binding);
      }
    }

    for (const entry of inventory.files) {
      const text = await readFile(entry.file, 'utf8');
      delete entry.file;
      if (inventory.externalFunctionBindings[entry.path])
        entry.function = inventory.externalFunctionBindings[entry.path];
      let raw;
      try {
        if (entry.format === 'XML') {
          entry.result = 'XML: separate codec required';
          continue;
        }
        if (!text.trim() && inventory.emptyFiles.includes(entry.path)) {
          assert.equal(text.length, 0, 'Expected pinned empty upstream file');
          assert.throws(() => prepareReferenceExample(origin, entry.path, text, symbols), /not valid JSON/);
          entry.result = 'empty upstream fixture: actionable rejection';
          continue;
        }
        if (isRepositoryExample(entry.path)) raw = JSON.parse(text);
        else {
          try {
            raw = JSON.parse(text);
          } catch {
            const config = ts.parseConfigFileTextToJson(entry.path, text);
            assert(!config.error, `${entry.path}: invalid JSON/JSONC configuration`);
            raw = config.config;
          }
        }
        if (!isRepositoryExample(entry.path)) {
          assert(!isRuneJsonPayload(raw), `${entry.path}: undiscovered Rune payload outside known example roots`);
          // Descriptors can name payloads outside their own directory. Check those links too.
          const visit = (value) => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
              if (
                ['inputFile', 'expectedOutputFile'].includes(key) &&
                typeof child === 'string' &&
                child.endsWith('.json')
              ) {
                const linked = `rosetta-source/src/main/resources/${child}`;
                assert(paths.has(linked), `${entry.path}: missing referenced payload ${linked}`);
                assert(isRepositoryExample(linked), `${entry.path}: undiscovered referenced payload ${linked}`);
              }
              visit(child);
            }
          };
          visit(raw);
          entry.result = 'configuration, code list or descriptor';
          continue;
        }
        assert.deepEqual(encodeRuneJson(decodeRuneJson(raw)), raw, `${entry.path}: lossless wire import`);
        if (Array.isArray(raw)) {
          assert.throws(() => prepareReferenceExample(origin, entry.path, text, symbols), /single object/);
          entry.result = 'collection payload: explicit single-object selection required';
          continue;
        }
        if (!raw?.['@type']) {
          assert.throws(
            () => prepareReferenceExample(origin, entry.path, text, symbols),
            /Choose its exact object type/
          );
          const binding = inputBindings.get(entry.path);
          if (binding) {
            if (inventory.externalFunctionBindings[entry.path]) {
              assert.throws(
                () => prepareReferenceExample(origin, entry.path, text, symbols, undefined, binding),
                /catalog function.*unavailable/
              );
              entry.result = 'catalog Java-only function: explicit availability diagnostic';
              continue;
            }
            const prepared = prepareReferenceExample(origin, entry.path, text, symbols, undefined, binding);
            const id = `${prepared.type.namespace}.${prepared.type.name}#RosettaFunction`;
            assert(adaptPreviewData(documents, id, structuredClone(prepared.data)).data);
            assert.deepEqual(prepared.source.execution, binding);
            entry.function = id;
            entry.result = 'imported as catalog-declared function argument bundle';
            continue;
          }
          // Upstream FpML serialization tests explicitly use Document as their root.
          if (inventory.id === 'fpml' && /\/serialisation\/output\/json\//.test(entry.path)) {
            const type = symbols.find(
              (symbol) =>
                symbol.model === 'fpml' &&
                symbol.namespace === 'fpml.consolidated.doc' &&
                symbol.name === 'Document' &&
                symbol.kind === 'Data'
            );
            assert(type, 'Missing upstream FpML Document root');
            const prepared = prepareReferenceExample(origin, entry.path, text, symbols, type);
            assert(
              adaptPreviewData(documents, `${type.namespace}.${type.name}#Data`, structuredClone(prepared.data)).data
            );
            entry.result = 'imported with upstream-declared FpML Document type';
            continue;
          }
          entry.result = 'headerless payload: explicit type selection required';
          continue;
        }
        const prepared = prepareReferenceExample(origin, entry.path, text, symbols);
        const id = `${prepared.type.namespace}.${prepared.type.name}#${prepared.type.kind}`;
        // Same linked decoder as the Studio preview worker, including structured-clone transport.
        const decoded = adaptPreviewData(documents, id, structuredClone(prepared.data)).data;
        assert(decoded && typeof decoded === 'object', `${entry.path}: linked import produced no object`);
        entry.result = 'imported through shared preparation and linked worker decoder';
      } catch (error) {
        entry.result = 'FAILED';
        entry.error = error.message;
        failures.push(`${inventory.id}/${entry.path}: ${error.message}`);
      } finally {
        inventory.counts[entry.result] = (inventory.counts[entry.result] ?? 0) + 1;
      }
    }
    console.log(inventory.id, inventory.counts);
  }
  await writeFile(reportPath, JSON.stringify({ sources: inventories, failures }, null, 2) + '\n');
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log(`PASS: complete repository inventory and corpus import checks; report: ${reportPath}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
