// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { redactTestArtifacts } from '../../scripts/redact-test-artifacts.mjs';

// This canary owns and retains its trace explicitly, rather than starting a
// second trace on top of the candidate runner's automatic capture.
test.use({ trace: 'off' });

test('real Playwright trace removes signed session response and browser warning credentials', async ({
  browser
}, info) => {
  const context = await browser.newContext();
  const secret = 'redaction-canary-session.signature';
  await context.route('https://redaction.test/**', async (route) => {
    await route.fulfill(
      route.request().url().endsWith('/session')
        ? { json: { token: secret, expiresAt: 12345 } }
        : { contentType: 'text/html', body: '<title>Trace redaction</title><p>Session ready</p>' }
    );
  });
  const directory = info.outputPath('sanitized');
  const tracePath = `${directory}/trace.zip`;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.goto('https://redaction.test/');
    await page.evaluate(async () => {
      const session = await fetch('/session').then((response) => response.json());
      console.warn(`WebSocket wss://lsp.test/ws/${session.token} closed before establishment`);
    });
    await context.tracing.stop({ path: tracePath });
    // Prove the canary actually reached a genuine trace before testing the sanitizer.
    const texts = async () => {
      const zip = await JSZip.loadAsync(await readFile(tracePath));
      return Promise.all(
        Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .map((entry) => entry.async('string'))
      );
    };
    expect((await texts()).some((text) => text.includes(secret))).toBe(true);
    await redactTestArtifacts(directory);
    expect((await texts()).some((text) => text.includes(secret))).toBe(false);
    expect((await texts()).some((text) => text.includes('expiresAt'))).toBe(true);
  } finally {
    await context.close();
    // Also scrub if an assertion fails, before the enclosing runner publishes artifacts.
    await redactTestArtifacts(directory);
  }
});
