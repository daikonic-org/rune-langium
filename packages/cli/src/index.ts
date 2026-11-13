#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * @packageDocumentation
 *
 * Command-line entry points for parsing, validating, and generating code from
 * Rune DSL workspaces.
 *
 * @remarks
 * Use the CLI when you need batch validation in CI, ad-hoc parsing from a
 * terminal, or code generation without embedding the libraries directly in a
 * Node.js tool. `build` runs explicit portable project targets natively;
 * `generate` retains the legacy toolchain bridge. `parse` and `validate` provide
 * lightweight syntax and diagnostics checks.
 */

import { Command } from 'commander';
import { runParse } from './parse.js';
import { runValidate } from './validate.js';
import { runGenerate } from './generate.js';
import type { GenerateCommandOptions } from './generate.js';
import { runBuild, type BuildCommandOptions } from './build.js';
import { runMarketData, type MarketDataCommandOptions } from './market-data.js';

const program = new Command();

program.name('rune-dsl').description('CLI tools for the Rune DSL').version('0.1.0');

program
  .command('parse')
  .description('Parse Rosetta DSL files and report syntax errors')
  .argument('<paths...>', 'Files or directories to parse')
  .option('--json', 'Output results as JSON')
  .action(async (paths: string[], options: { json?: boolean }) => {
    const exitCode = await runParse(paths, options);
    process.exit(exitCode);
  });

program
  .command('validate')
  .description('Validate Rosetta DSL files and report diagnostics')
  .argument('<paths...>', 'Files or directories to validate')
  .option('--json', 'Output results as JSON')
  .action(async (paths: string[], options: { json?: boolean }) => {
    const exitCode = await runValidate(paths, options);
    process.exit(exitCode);
  });

program
  .command('generate')
  .description('Generate code from Rosetta DSL files via rosetta-code-generators')
  .option('-l, --language <lang>', 'Target language (e.g., typescript, scala, kotlin)')
  .option('-i, --input <paths...>', '.rosetta file paths or directories')
  .option('-o, --output <dir>', 'Output directory for generated code')
  .option('-r, --reference <paths...>', 'Reference model paths (compilation context, not exported)')
  .option('--codegen-cli <path>', 'Path to codegen CLI script (default: auto-detected)')
  .option('--list-languages', 'List available code generators and exit')
  .option('--json', 'Output results as JSON')
  .action(async (options: GenerateCommandOptions) => {
    const exitCode = await runGenerate(options);
    process.exit(exitCode);
  });

program
  .command('build')
  .description('Build explicit named targets from portable project settings')
  .requiredOption('--project <root>', 'Project working-copy root')
  .option('--target <names...>', 'Named build targets')
  .option('--all', 'Build every configured target')
  .option('--json', 'Output the build result as JSON')
  .action(async (options: BuildCommandOptions) => {
    process.exitCode = await runBuild(options);
  });

program
  .command('market-data')
  .description('Acquire public SOFR, SONIA and €STR snapshots with a portable Rune observation provider')
  .requiredOption('--start <date>', 'First observation date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'Last observation date (YYYY-MM-DD), up to 366 dates')
  .requiredOption('--output <directory>', 'New output directory; existing directories are never replaced')
  .option('--series <names...>', 'Series IDs; defaults to all three rates and their compounded indices')
  .option('--json', 'Output the acquisition receipt as JSON')
  .action(async (options: MarketDataCommandOptions) => {
    process.exitCode = await runMarketData(options);
  });

program.parseAsync().catch((failure: unknown) => {
  console.error(failure instanceof Error ? failure.message : 'Command failed.');
  process.exitCode = 1;
});
