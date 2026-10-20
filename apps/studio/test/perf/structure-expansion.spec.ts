// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

/** Diagnostic replay: actual input-to-content/frame timings, without a machine-specific budget. */
for (const { extraTypes, fields } of [
  { extraTypes: 0, fields: 2 },
  { extraTypes: 1000, fields: 2 },
  { extraTypes: 1000, fields: 100 }
]) {
  test(`Structure expansion latency with ${fields} fields and ${extraTypes} unrelated declarations`, async ({
    page
  }, info) => {
    await page.setViewportSize({ width: 1461, height: 988 });
    await page.goto('./');
    const source = `namespace expansion
type Branch:
${Array.from({ length: fields }, (_, index) => ` value${index} string (0..1)`).join('\n')}
type ExpansionRoot:
 branch Branch (0..1)
${Array.from({ length: extraTypes }, (_, index) => `type Other${index}:\n value string (0..1)`).join('\n')}
`;
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'expansion.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(source)
    });
    await page.getByTestId('namespace-search').fill('ExpansionRoot');
    await page.getByRole('button', { name: 'Navigate to ExpansionRoot', exact: true }).click();
    await dismissLocalTransportNotices(page);
    const view = page.getByTestId('structure-view-flow');
    const samples = [];
    for (let index = 0; index < 6; index++) {
      const toggle = view.getByRole('button', { name: 'Expand branch', exact: true });
      const timing = await toggle.evaluateHandle((button) => {
        const owner = button.closest('li')!;
        let frame = 0;
        let observer: MutationObserver | undefined;
        let started = 0;
        let committed = 0;
        let firstFrame = 0;
        let settled = 0;
        let previous = '';
        let stable = 0;
        let frames = 0;
        let finish!: (result: { commitMs: number; firstFrameMs: number; settledMs: number; frames: number }) => void;
        const promise = new Promise<{ commitMs: number; firstFrameMs: number; settledMs: number; frames: number }>(
          (resolve) => {
            finish = resolve;
          }
        );
        const child = () => owner.querySelector<HTMLElement>(':scope > .rune-structure-member__child > section');
        const tick = () => {
          const card = child();
          if (card) {
            const now = performance.now() - started;
            firstFrame ||= now;
            const box = card.getBoundingClientRect();
            const bounds = [box.x, box.y, box.width, box.height].join(',');
            stable = bounds === previous ? stable + 1 : 0;
            if (bounds !== previous) settled = now;
            previous = bounds;
            frames++;
            if (stable >= 3 || frames >= 30) {
              observer?.disconnect();
              finish({ commitMs: committed, firstFrameMs: firstFrame, settledMs: settled, frames });
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        const start = () => {
          started = performance.now();
          observer = new MutationObserver(() => {
            if (!committed && child()) committed = performance.now() - started;
          });
          observer.observe(owner, { childList: true, subtree: true });
          frame = requestAnimationFrame(tick);
        };
        button.addEventListener('click', start, { capture: true, once: true });
        return {
          promise,
          cleanup: () => {
            button.removeEventListener('click', start, true);
            observer?.disconnect();
            cancelAnimationFrame(frame);
          }
        };
      });
      try {
        await toggle.click();
        await expect(view.getByRole('region', { name: 'Branch', exact: true })).toBeVisible();
        samples.push(await timing.evaluate(async (state) => state.promise));
      } finally {
        await timing.evaluate((state) => state.cleanup());
        await timing.dispose();
      }
      await view.getByRole('button', { name: 'Collapse branch', exact: true }).click();
    }
    await info.attach('expansion-latency.json', {
      body: JSON.stringify({ extraTypes, fields, samples }, null, 2),
      contentType: 'application/json'
    });
    console.log(JSON.stringify({ extraTypes, fields, samples }));
  });
}
