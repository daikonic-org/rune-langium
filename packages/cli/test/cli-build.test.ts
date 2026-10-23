// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBuild } from '../src/build.js';
afterEach(() => vi.restoreAllMocks());
describe('rune-dsl build selection', () => {
  it('returns usage exit 2 without a target or all', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runBuild({ project: '/does-not-need-to-exist', json: true })).toBe(2);
  });
  it('returns usage exit 2 for both all and named targets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runBuild({ project: '/does-not-need-to-exist', all: true, target: ['pg'], json: true })).toBe(2);
  });
});

it('keeps JSON mode machine-readable when preflight fails', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await runBuild({ project: '/does-not-need-to-exist', json: true })).toBe(2);
  const result = JSON.parse(String(output.mock.calls[0]?.[0]));
  expect(result.status).toBe('failed');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'TARGET_REQUIRED' })]);
});

it('runs the built CLI with explicit selection and machine-readable output', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const temp = await mkdtemp(join(tmpdir(), 'rune-cli-project-'));
  try {
    const root = join(temp, 'project');
    await mkdir(join(root, 'model'), { recursive: true });
    await writeFile(join(root, 'rune-config.yml'), 'model: {name: Example}');
    await writeFile(
      join(root, 'build-config.yml'),
      JSON.stringify({
        schemaVersion: 1,
        targets: { pg: { generator: 'sql', options: { dialect: 'postgres' }, output: 'generated/pg' } }
      })
    );
    await writeFile(join(root, 'model', 'trade.rosetta'), 'namespace example\ntype Trade:\n  amount number (1..1)\n');
    const command = promisify(execFile);
    const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
    const options = { env: { ...process.env, XDG_CACHE_HOME: join(temp, 'cache') } };
    const built = await command(
      process.execPath,
      [cli, 'build', '--project', root, '--target', 'pg', '--json'],
      options
    );
    const result = JSON.parse(built.stdout);
    expect(result.status).toBe('success');
    expect(await readFile(join(root, result.outputs[0]), 'utf8')).toContain('Trade');
    try {
      await command(process.execPath, [cli, 'build', '--project', root, '--json'], options);
      throw new Error('Expected usage error');
    } catch (failure) {
      expect((failure as { code: number }).code).toBe(2);
      expect(JSON.parse((failure as { stdout: string }).stdout).diagnostics[0].code).toBe('TARGET_REQUIRED');
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
