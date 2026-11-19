#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * rune-codegen CLI entry point.
 *
 * Implements the CLI contract from specs/015-rune-codegen-zod/contracts/cli.md.
 * Accepts <input...> file or directory paths, parses them with the Rune Langium
 * service, and emits code to the --output directory.
 *
 * Tasks: T041–T043 (Phase 3, US1).
 * FR-001, FR-015, FR-016, FR-025, SC-001.
 */

import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { watch } from 'node:fs';
import process from 'node:process';
import { Command } from 'commander';
import { URI, type LangiumDocument } from 'langium';
import { createRuneDslServices } from '@rune-langium/core';
import { generate, IMPLEMENTED_TARGETS } from '../src/export.js';
import type { Target, GeneratorDiagnostic, GeneratorOutput } from '../src/types.js';
import { runImport } from '../src/import/cli.js';

// ---- package version --------------------------------------------------------

// Resolved at build time via import.meta (Node 22+) or fallback
const PKG_VERSION = '0.1.0';

// ---- helpers ----------------------------------------------------------------

/**
 * Recursively find all .rune files under a path (file or directory).
 */
async function findRuneFiles(inputPath: string): Promise<string[]> {
  let s;
  try {
    s = await stat(inputPath);
  } catch {
    throw new Error(`Input path not found: ${inputPath}`);
  }

  if (s.isFile()) {
    if (extname(inputPath) !== '.rune') {
      throw new Error(`Input file is not a .rune file: ${inputPath}`);
    }
    return [inputPath];
  }

  if (s.isDirectory()) {
    const results: string[] = [];
    await collectRuneFiles(inputPath, results);
    return results;
  }

  throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
}

async function collectRuneFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRuneFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.rune')) {
      out.push(fullPath);
    }
  }
}

/**
 * Parse a .rune file and return the Langium document.
 */
async function parseRuneFile(
  filePath: string,
  services: ReturnType<typeof createRuneDslServices>
): Promise<LangiumDocument> {
  const content = await readFile(filePath, 'utf-8');
  // Use .rosetta URI so the Langium service registry recognizes the extension
  const fileName = filePath.replace(/\.rune$/, '.rosetta').replace(/.*[/\\]/, '');
  const doc = services.RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse(`inmemory:///${fileName}`)
  );
  await services.RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  return doc;
}

/**
 * Write a single GeneratorOutput to disk.
 */
async function writeOutput(output: GeneratorOutput, outputDir: string): Promise<void> {
  const outPath = join(outputDir, output.relativePath);
  const outDir = outPath.replace(/[^/\\]+$/, '');
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, output.content, 'utf-8');
}

/**
 * Format a timestamp for watch mode output: [HH:MM:SS]
 */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Aggregate diagnostics across all outputs (deduped by sourceUri+line+char+code).
 */
function aggregateDiagnostics(outputs: GeneratorOutput[]): GeneratorDiagnostic[] {
  const seen = new Set<string>();
  const all: GeneratorDiagnostic[] = [];
  for (const o of outputs) {
    for (const d of o.diagnostics) {
      const key = `${d.sourceUri ?? ''}:${d.line ?? 0}:${d.char ?? 0}:${d.code}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(d);
      }
    }
  }
  return all;
}

/**
 * Print a diagnostic to stderr.
 */
function printDiagnostic(d: GeneratorDiagnostic): void {
  const loc = d.sourceUri
    ? `${d.sourceUri}${d.line != null ? `:${d.line}` : ''}${d.char != null ? `:${d.char}` : ''} `
    : '';
  const prefix = d.severity === 'error' ? 'error' : d.severity;
  process.stderr.write(`rune-codegen: ${prefix} in ${loc}[${d.code}]\n  ${d.message}\n`);
}

// ---- core generate-and-write ------------------------------------------------

interface RunOptions {
  target: Target;
  outputDir: string;
  strict: boolean;
  json: boolean;
}

interface RunResult {
  success: boolean;
  durationMs: number;
  outputs: GeneratorOutput[];
  diagnostics: GeneratorDiagnostic[];
}

async function runOnce(
  files: string[],
  services: ReturnType<typeof createRuneDslServices>,
  opts: RunOptions
): Promise<RunResult> {
  const start = Date.now();

  const workspace = services.shared.workspace;
  if (opts.target === 'python') await workspace.WorkspaceManager.initializeWorkspace([]);
  const inputs = await Promise.all(files.map((f) => parseRuneFile(f, services)));
  const docs = opts.target === 'python' ? [...new Set([...inputs, ...workspace.LangiumDocuments.all])] : inputs;

  // Generate
  let outputs: GeneratorOutput[];
  try {
    outputs = await generate(docs, { target: opts.target, strict: opts.strict });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    const diag: GeneratorDiagnostic = {
      severity: 'error',
      message,
      code: 'generator-error'
    };
    return { success: false, durationMs, outputs: [], diagnostics: [diag] };
  }

  const allDiags = aggregateDiagnostics(outputs);
  const hasErrors = allDiags.some((d) => d.severity === 'error');

  // Write outputs (skip if strict and errors)
  if (!opts.strict || !hasErrors) {
    await Promise.all(outputs.map((o) => writeOutput(o, opts.outputDir)));
  }

  const durationMs = Date.now() - start;
  return {
    success: !hasErrors,
    durationMs,
    outputs,
    diagnostics: allDiags
  };
}

// ---- output formatters ------------------------------------------------------

function printHumanProgress(result: RunResult, opts: RunOptions): void {
  const { outputs, diagnostics, durationMs, success } = result;
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;

  process.stdout.write(`rune-codegen: generating '${opts.target}' for ${outputs.length} document(s)...\n`);
  for (const o of outputs) {
    process.stdout.write(`  ✓ ${o.relativePath}\n`);
  }
  for (const d of diagnostics) {
    printDiagnostic(d);
  }
  process.stdout.write(
    `rune-codegen: ${success ? 'done' : 'failed'} (${errorCount} error(s), ${warnCount} warning(s)) in ${(durationMs / 1000).toFixed(2)}s\n`
  );
}

function printJsonOutput(result: RunResult, opts: RunOptions): void {
  const payload = {
    target: opts.target,
    durationMs: result.durationMs,
    files: result.outputs.map((o) => ({
      relativePath: o.relativePath,
      diagnostics: o.diagnostics
    })),
    diagnostics: result.diagnostics,
    success: result.success
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

// ---- watch mode -------------------------------------------------------------

const DEBOUNCE_MS = 200;

async function runWatch(
  files: string[],
  services: ReturnType<typeof createRuneDslServices>,
  opts: RunOptions
): Promise<void> {
  const inputPaths = [...new Set(files.map((f) => resolve(f).replace(/[^/\\]+\.rune$/, '')))];

  process.stdout.write(`rune-codegen: watching ${inputPaths.join(', ')} for changes...\n`);

  // Initial generation
  const initial = await runOnce(files, services, opts);
  if (opts.json) {
    printJsonOutput(initial, opts);
  } else {
    printHumanProgress(initial, opts);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Watch each unique directory
  for (const dir of inputPaths) {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || !String(filename).endsWith('.rune')) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const ts = timestamp();
        process.stdout.write(`[${ts}] change detected: ${filename}\n`);

        // Re-create services for clean parse state
        const freshServices = createRuneDslServices();
        const result = await runOnce(files, freshServices, opts);

        if (opts.json) {
          printJsonOutput(result, opts);
        } else {
          const prefix = `[${ts}] `;
          process.stdout.write(
            `${prefix}rune-codegen: generating '${opts.target}' for ${result.outputs.length} document(s)...\n`
          );
          for (const o of result.outputs) {
            process.stdout.write(`  ✓ ${o.relativePath}\n`);
          }
          for (const d of result.diagnostics) {
            printDiagnostic(d);
          }
          const errorCount = result.diagnostics.filter((d) => d.severity === 'error').length;
          process.stdout.write(
            `${prefix}rune-codegen: ${result.success ? 'done' : 'failed'} (${errorCount} error(s)) in ${(result.durationMs / 1000).toFixed(2)}s\n`
          );
        }
      }, DEBOUNCE_MS);
    });
  }

  // Wait for SIGINT / SIGTERM
  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      clearTimeout(debounceTimer);
      process.stdout.write('rune-codegen: stopped.\n');
      resolve();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
}

// ---- main -------------------------------------------------------------------

/**
 * The root program's default (outbound) action body. Extracted to a plain
 * `.action(...)` handler (rather than driving everything from a `.then()`
 * after a bare `.parseAsync()`) specifically so that registering the
 * `import` subcommand below does not break it: verified empirically that a
 * commander `Command` with a registered subcommand REJECTS an unrecognized
 * bare positional to the root as `error: unknown command '<path>'` UNLESS
 * the root itself has its own `.action(...)` registered — a bare
 * `.then()`-only root (no `.action()`) has no such fallback and commander
 * treats every invocation as "must name a subcommand". With `.action(...)`
 * present, both `rune-codegen file.rune -t zod` (root default) and
 * `rune-codegen import ...` (named subcommand) dispatch correctly side by
 * side (confirmed with an isolated commander-only repro before this change).
 */
async function runDefault(
  args: string[],
  options: { target: string; output: string; watch?: boolean; strict?: boolean; json?: boolean }
): Promise<void> {
  // Validate target — derived from IMPLEMENTED_TARGETS (generator.ts's own
  // registry of targets with a real emitter registered), not a hand-maintained
  // list: a prior hardcoded ['zod', 'json-schema', 'typescript'] silently
  // predated (and was never updated for) sql/excel/openapi/xsd, so the CLI
  // rejected valid, already-shipped targets before they ever reached the
  // generator.
  if (!IMPLEMENTED_TARGETS.includes(options.target as Target)) {
    process.stderr.write(
      `rune-codegen: error: unknown target '${options.target}'. Expected: ${IMPLEMENTED_TARGETS.join(', ')}.\n`
    );
    process.exit(2);
  }

  const target = options.target as Target;
  const outputDir = resolve(options.output);

  // Collect input files
  let files: string[];
  try {
    const allFiles = await Promise.all(args.map((a) => findRuneFiles(resolve(a))));
    files = allFiles.flat();
  } catch (err: unknown) {
    process.stderr.write(`rune-codegen: error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    process.stderr.write('rune-codegen: error: no .rune files found in the given input paths.\n');
    process.exit(1);
  }

  const opts: RunOptions = {
    target,
    outputDir,
    strict: options.strict ?? false,
    json: options.json ?? false
  };

  const services = createRuneDslServices();

  if (options.watch) {
    await runWatch(files, services, opts);
    process.exit(0);
  }

  const result = await runOnce(files, services, opts);

  if (opts.json) {
    printJsonOutput(result, opts);
  } else {
    printHumanProgress(result, opts);
  }

  process.exit(result.success ? 0 : 1);
}

const program = new Command();

program
  .name('rune-codegen')
  .description('Generate code and schemas from Rune models')
  .version(`rune-codegen ${PKG_VERSION}`, '-v, --version')
  .argument('<input...>', 'One or more .rune file paths or directories')
  .option('-t, --target <target>', `Output target: ${IMPLEMENTED_TARGETS.join(', ')}`, 'zod')
  .option('-o, --output <dir>', 'Output directory root', './generated')
  .option('-w, --watch', 'Watch mode: re-generate on file changes')
  .option('--strict', 'Treat any generator error diagnostic as fatal')
  .option('--json', 'Emit machine-readable JSON to stdout instead of human-readable progress')
  .exitOverride() // Prevent commander from calling process.exit() directly
  .action(runDefault);

program
  .command('import')
  .description('Import a .rune model from an external source format (json-schema, openapi, sql, xsd)')
  .argument('<input>', 'Path to the source file (e.g. a JSON Schema, OpenAPI, SQL DDL, or XSD document)')
  .requiredOption('--from <source>', "Source format: 'json-schema', 'openapi' (JSON or YAML), 'sql', or 'xsd'")
  // NOTE: deliberately NOT `-o`/`--output` (spec.md's example CLI syntax
  // uses `-o <output.rune>`) — the root program ALSO declares
  // `-o, --output <dir>` (a directory, for the outbound multi-file case).
  // Verified with an isolated commander-only repro that a subcommand
  // colliding with a PARENT option on EITHER the short flag character OR
  // the long option name (independently — either one alone is enough)
  // silently loses its own option value in its own action's `opts()`, even
  // though the subcommand redeclares the option itself. Neither `-o,
  // --out-file` (same short, different long) nor plain `--output`
  // (different/no short, same long) worked; only a fully distinct pair
  // (`--out-file`, no short flag) does. This appears to be commander's
  // documented "`.command()` automatically copies the inherited settings
  // from the parent command" behavior interacting badly with a same-letter/
  // same-name redeclaration — a real gotcha, not a typo in this file.
  .option('--out-file <file>', 'Output .rune file path (default: stdout)')
  .option('--namespace <name>', 'Override namespace derivation (required for --from sql)')
  .option('--no-synonyms', 'Suppress synonym annotations')
  .option('--no-conditions', 'Structural import only — skip expression translation')
  .option('--on-untranslatable <mode>', "How to handle an untranslatable construct: 'stub' (default)", 'stub')
  .option('--sql-dialect <dialect>', "--from sql only: 'postgres' (default) or 'sqlserver'", 'postgres')
  .action(async (input: string, cmdOpts: Parameters<typeof runImport>[1]) => {
    process.exit(await runImport(input, cmdOpts));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // commander exitOverride throws CommanderError for --help/--version/usage errors
  if (err && typeof err === 'object' && 'exitCode' in err) {
    const exitCode = (err as { exitCode: number }).exitCode;
    // exitCode 0 = --help or --version (already printed)
    // exitCode non-zero = usage error
    process.exit(exitCode === 0 ? 0 : 2);
  }
  process.stderr.write(`rune-codegen: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
