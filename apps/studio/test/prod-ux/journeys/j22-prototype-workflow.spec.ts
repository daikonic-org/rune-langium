// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workflowJourneys } from '../../helpers/prototype-workflow.js';
import { captureOpLogSnapshot, checkout as test } from '../fixtures.js';
import { REPORT_DIR } from '../evidence.js';

for (const journey of workflowJourneys) {
  test(
    `J22 ${journey.title}`,
    { annotation: { type: 'journey-subid', description: journey.id } },
    async ({ page, evidence }, info) => {
      test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
      await journey.run(page, {
        beforeReload: () => captureOpLogSnapshot(page, evidence),
        checkpoint: (name) => evidence.checkpoint(name),
        accessibility: async (name, results) => {
          const directory = path.join(REPORT_DIR, 'axe', 'J22', `attempt${info.retry}`);
          await mkdir(directory, { recursive: true });
          await writeFile(path.join(directory, `${name}.json`), JSON.stringify(results, null, 2));
        }
      });
    }
  );
}
