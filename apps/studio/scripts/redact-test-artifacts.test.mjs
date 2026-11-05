// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { redactEvidenceText, redactTestArtifacts } from './redact-test-artifacts.mjs';

test('retains endpoint failures without WebSocket, JSON or header credentials', () => {
  const secret = 'synthetic-session.signature';
  const result = redactEvidenceText(
    `GET wss://lsp.test/ws/${secret} HTTP 403 {"token":"${secret}"} Bearer ${secret} https://lsp.test/?token=${secret}`
  );
  assert.ok(!result.includes(secret));
  assert.match(result, /GET wss:\/\/lsp.test\/ws\/\[REDACTED\] HTTP 403/);
  assert.equal(redactEvidenceText(result), result);
});

test('scrubs trace ZIP resources and embedded reports without altering binary evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rune-redaction-'));
  try {
    const secret = 'synthetic-session.signature';
    const zip = new JSZip();
    zip.file('1-trace.network', JSON.stringify({ request: { url: `wss://lsp.test/ws/${secret}` }, status: 101 }));
    zip.file('resources/session.json', JSON.stringify({ token: secret, expiresAt: 123 }));
    zip.file('1-trace.trace', JSON.stringify({ params: { body: JSON.stringify({ token: secret }) } }));
    const image = Buffer.from([137, 80, 78, 71, 255, 0, 12]);
    zip.file('resources/checkpoint.png', image);
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(join(dir, 'trace.zip'), bytes);
    await writeFile(
      join(dir, 'index.html'),
      `<script>window.playwrightReportBase64="data:application/zip;base64,${bytes.toString('base64')}";</script>`
    );
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ consoleErrors: [`wss://lsp.test/ws/${secret}`] }));
    assert.equal(await redactTestArtifacts(dir), 3);
    const trace = await JSZip.loadAsync(await readFile(join(dir, 'trace.zip')));
    assert.ok(!(await trace.file('1-trace.network').async('string')).includes(secret));
    assert.ok(!(await trace.file('1-trace.trace').async('string')).includes(secret));
    assert.deepEqual(await trace.file('resources/checkpoint.png').async('nodebuffer'), image);
    assert.equal(JSON.parse(await trace.file('resources/session.json').async('string')).expiresAt, 123);
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const embedded = await JSZip.loadAsync(Buffer.from(/base64,([\w+/=]+)/.exec(html)[1], 'base64'));
    assert.ok(!(await embedded.file('resources/session.json').async('string')).includes(secret));
    assert.ok(!(await readFile(join(dir, 'manifest.json'), 'utf8')).includes(secret));
    assert.equal(await redactTestArtifacts(dir), 0);
    await writeFile(join(dir, 'broken.zip'), 'not an archive');
    await assert.rejects(redactTestArtifacts(dir));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('identifies an empty nested ZIP while refusing unchecked evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rune-redaction-'));
  try {
    const zip = new JSZip();
    zip.file('attachments/empty.zip', Buffer.alloc(0));
    await writeFile(join(dir, 'report.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(redactTestArtifacts(dir), /report\.zip!attachments\/empty\.zip \(0 bytes\)/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
