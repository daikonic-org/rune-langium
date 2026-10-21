// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { discoverFiles } from './discover-files.js';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import type { LangiumDocument } from 'langium';

export interface ValidateCommandOptions {
  json?: boolean;
}

/**
 * Validate one or more Rosetta DSL files and report diagnostics.
 */
export async function runValidate(paths: string[], options: ValidateCommandOptions): Promise<number> {
  const files = await discoverFiles(paths);
  if (files.length === 0) {
    console.error('No .rosetta files found.');
    return 1;
  }

  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;

  const documents: LangiumDocument[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const doc = factory.fromString(content, URI.file(file));
    documents.push(doc);
  }

  await builder.build(documents, { validation: true });

  let hasErrors = false;
  const results: Array<{
    file: string;
    diagnostics: Array<{ severity: string; message: string; line: number }>;
  }> = [];

  for (const doc of documents) {
    const filePath = relative(process.cwd(), doc.uri.fsPath);
    const diagnostics = (doc.diagnostics ?? []).map((d) => ({
      severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
      // `Diagnostic.message` widened to `string | MarkupContent` in newer LSP
      // types; the CLI emits plain strings, so normalize to the text value.
      message: typeof d.message === 'string' ? d.message : d.message.value,
      line: (d.range.start.line ?? 0) + 1
    }));

    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) hasErrors = true;

    results.push({ file: filePath, diagnostics });
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      if (r.diagnostics.length === 0) {
        console.log(`${r.file}: OK`);
      } else {
        for (const d of r.diagnostics) {
          const prefix = d.severity === 'error' ? 'ERROR' : d.severity === 'warning' ? 'WARN' : 'INFO';
          console.log(`${r.file}:${d.line}: [${prefix}] ${d.message}`);
        }
      }
    }
  }

  return hasErrors ? 1 : 0;
}
