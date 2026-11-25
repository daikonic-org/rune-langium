// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';
import { localOrigin, loopback, pagesPort, workers } from './dev-services.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const studio = '@rune-langium/studio';
const dataWorker = '@rune-langium/cdm-example-data-worker';
const vitePort = Number(process.env.STUDIO_DEV_PORT || 5173);

function runPnpm(args) {
  const result = spawnSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${result.status ?? result.signal})`);
}

async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Local port ${port} is in use or unavailable.`)));
    server.listen(port, loopback, () => server.close(resolve));
  });
}

async function main() {
  if (!Number.isInteger(vitePort) || vitePort < 1 || vitePort > 65535) {
    throw new Error('STUDIO_DEV_PORT must be a valid TCP port.');
  }
  const ports = [vitePort, pagesPort, ...workers.map(({ port }) => port)];
  if (new Set(ports).size !== ports.length) throw new Error('STUDIO_DEV_PORT conflicts with a local Worker port.');
  await Promise.all(ports.map(checkPort));

  // Compile workspace packages that export dist/ entry points. Vite owns
  // the Studio client and serves its source directly.
  runPnpm([
    '--filter',
    `${studio}^...`,
    '--filter',
    '@rune-langium/lsp-worker^...',
    '--filter',
    '@rune-langium/curated-mirror-worker^...',
    '--filter',
    `${dataWorker}...`,
    'run',
    'build'
  ]);
  runPnpm(['--filter', dataWorker, 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);

  const allowedOrigins = `${localOrigin(vitePort)},http://localhost:${vitePort}`;
  const { result } = concurrently(
    [
      {
        name: 'vite',
        command: `pnpm --filter ${studio} exec vite --host ${loopback} --port ${vitePort} --strictPort`,
        env: { STUDIO_LOCAL_CLOUDFLARE: '1' }
      },
      {
        name: 'pages',
        command: `pnpm --filter ${studio} dev:pages`
      },
      ...workers.map(({ name, port, allowOrigin }) => {
        const args = [`--ip ${loopback}`, `--port ${port}`];
        if (allowOrigin) args.push(`--var ALLOWED_ORIGIN:${allowedOrigins}`);
        const keyName = name === 'lsp' ? 'SESSION_SIGNING_KEY' : name === 'telemetry' ? 'IP_SALT_SECRET' : undefined;
        const env = keyName ? { RUNE_LOCAL_WORKER_KEY: randomBytes(32).toString('hex') } : {};
        if (keyName) args.push(`--var ${keyName}:"$RUNE_LOCAL_WORKER_KEY"`);
        return { name, command: `pnpm --filter @rune-langium/${name}-worker dev ${args.join(' ')}`, env };
      })
    ],
    { cwd: repoRoot, killOthersOn: ['failure', 'success'] }
  );
  console.log(`[studio] Browser entry point: ${localOrigin(vitePort)}/`);
  await result;
}

try {
  await main();
} catch (error) {
  console.error(`[studio] ${error instanceof Error ? error.message : 'Local dev stack stopped.'}`);
  process.exitCode = 1;
}
