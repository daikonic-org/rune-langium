// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { writeFile } from 'node:fs/promises';
import { test } from '@playwright/test';
import { workflowJourneys } from '../helpers/prototype-workflow.js';

for (const journey of workflowJourneys) {
  test(journey.title, async ({ page }, info) => {
    await journey.run(page, {
      checkpoint: (name) => page.screenshot({ path: info.outputPath(`${name}.png`) }).then(() => {}),
      accessibility: (name, results) => writeFile(info.outputPath(`${name}-axe.json`), JSON.stringify(results, null, 2))
    });
  });
}
