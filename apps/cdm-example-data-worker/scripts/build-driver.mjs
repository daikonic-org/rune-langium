// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/driver.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
  minify: true,
  legalComments: 'inline'
});
const file = new URL('../src/generated/driver-source.json', import.meta.url);
const dependency = JSON.parse(
  await readFile(new URL('../node_modules/drizzle-orm/package.json', import.meta.url), 'utf8')
);
const license = await readFile(new URL('../licenses/Apache-2.0.txt', import.meta.url), 'utf8');
const banner =
  '// SPDX-License-Identifier: FSL-1.1-ALv2 AND Apache-2.0\n' +
  '// Generated example driver; includes drizzle-orm@' +
  dependency.version +
  ' (' +
  dependency.license +
  ').\n' +
  '/*\n' +
  license.replaceAll('*/', '* /') +
  '\n*/\n';
const source = JSON.stringify({ source: banner + result.outputFiles[0].text }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8').catch(() => '')) !== source) throw new Error('Database driver bundle is stale.');
} else {
  await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
  await writeFile(file, source);
}
