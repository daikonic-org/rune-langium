// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { checkout as test, captureOpLogSnapshot } from '../fixtures.js';
import type { Page } from '@playwright/test';
import type { JourneyObserver } from '../../helpers/journey-observer.js';
import { checkNamedTargets } from '../../helpers/project-targets.js';

const journeys: Array<{ id: string; title: string; run(page: Page, observer: JourneyObserver): Promise<void> }> = [
  {
    id: 'targets',
    title: 'saves and builds independent targets, reloads changes and preserves removed outputs',
    run: checkNamedTargets
  }
];
for (const journey of journeys)
  test(
    `J24 ${journey.title}`,
    { annotation: { type: 'journey-subid', description: journey.id } },
    async ({ page, evidence }) => {
      test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
      await journey.run(page, {
        checkpoint: (name) => evidence.checkpoint(name),
        beforeReload: () => captureOpLogSnapshot(page, evidence),
        afterReload: () => evidence.markNavigation()
      });
    }
  );
