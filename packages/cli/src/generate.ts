// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { discoverFiles } from './discover-files.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CodegenServiceProxy, KNOWN_GENERATORS } from '@rune-langium/codegen-legacy/node';
import type { CodeGenerationResult } from '@rune-langium/codegen-legacy';

export interface GenerateCommandOptions {
  language: string;
  input: string[];
  output: string;
  reference?: string[];
  codegenCli?: string;
  listLanguages?: boolean;
  json?: boolean;
}

/**
 * List available code generators.
 */
export function listLanguages(options: { json?: boolean }): number {
  if (options.json) {
    console.log(JSON.stringify(KNOWN_GENERATORS, null, 2));
  } else {
    console.log('Available code generators:');
    console.log();
    for (const gen of KNOWN_GENERATORS) {
      console.log(`  ${gen.id.padEnd(14)} ${gen.label}`);
    }
    console.log();
    console.log('Note: Requires rosetta-code-generators and Java 21+.');
    console.log('Build: pnpm codegen:build-deps && pnpm codegen:build');
  }
  return 0;
}

/**
 * Run the code generation command.
 */
export async function runGenerate(options: GenerateCommandOptions): Promise<number> {
  // Handle --list-languages
  if (options.listLanguages) {
    return listLanguages({ json: options.json });
  }

  // Validate language
  if (!options.language) {
    console.error('Error: --language is required. Use --list-languages to see available options.');
    return 2;
  }

  // Validate input
  if (!options.input || options.input.length === 0) {
    console.error('Error: --input is required. Specify .rosetta files or directories.');
    return 2;
  }

  // Validate output
  if (!options.output) {
    console.error('Error: --output is required. Specify the output directory.');
    return 2;
  }

  // Create proxy (uses CLI subprocess)
  const proxy = new CodegenServiceProxy(options.codegenCli ?? undefined);

  // Check availability
  const available = await proxy.isAvailable();
  if (!available) {
    console.error(
      'Error: Codegen CLI not available. Build it first:\n' + '  pnpm codegen:build-deps && pnpm codegen:build'
    );
    return 2;
  }

  // Discover user files
  const userFiles = await discoverFiles(options.input);
  if (userFiles.length === 0) {
    console.error('No .rosetta files found in the specified input paths.');
    return 2;
  }

  // Discover reference files (compilation context, not exported)
  const referenceFiles = options.reference ? await discoverFiles(options.reference) : [];

  if (!options.json) {
    console.log(
      `Generating ${options.language} code from ${userFiles.length} file(s)` +
        (referenceFiles.length > 0 ? ` with ${referenceFiles.length} reference file(s)` : '') +
        '...'
    );
  }

  // Read all files into memory for the JSON request
  const files: Array<{ path: string; content: string }> = [];
  for (const file of [...userFiles, ...referenceFiles]) {
    const content = await readFile(file, 'utf-8');
    files.push({ path: file, content });
  }

  // Generate via CLI subprocess
  let codegenResult: CodeGenerationResult;
  try {
    codegenResult = await proxy.generate({
      language: options.language,
      files
    });
  } catch (err) {
    console.error(`Code generation failed: ${err instanceof Error ? err.message : err}`);
    return 1;
  }

  // Write output files
  const outputDir = resolve(options.output);
  await mkdir(outputDir, { recursive: true });

  for (const f of codegenResult.files) {
    const dest = resolve(outputDir, f.path);
    const dir = resolve(dest, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(dest, f.content, 'utf-8');
  }

  if (options.json) {
    const jsonOutput = {
      language: codegenResult.language,
      files: codegenResult.files.map((f) => ({
        path: f.path,
        size: f.content.length
      })),
      errors: codegenResult.errors,
      warnings: codegenResult.warnings
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    if (codegenResult.errors.length > 0) {
      console.error(`\nCode generation completed with ${codegenResult.errors.length} error(s):`);
      for (const err of codegenResult.errors) {
        const location = [err.sourceFile, err.construct].filter(Boolean).join(':');
        console.error(`  ${location ? `${location}: ` : ''}${err.message}`);
      }
    }

    if (codegenResult.warnings.length > 0) {
      console.warn(`\n${codegenResult.warnings.length} warning(s):`);
      for (const w of codegenResult.warnings) {
        console.warn(`  ${w}`);
      }
    }

    if (codegenResult.files.length > 0) {
      console.log(`\nGenerated ${codegenResult.files.length} file(s) in ${outputDir}`);
      for (const f of codegenResult.files) {
        console.log(`  ${f.path}`);
      }
    } else if (codegenResult.errors.length === 0) {
      console.log('\nNo files generated.');
    }
  }

  return codegenResult.errors.length > 0 ? 1 : 0;
}
