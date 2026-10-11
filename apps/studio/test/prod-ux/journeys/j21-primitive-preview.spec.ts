// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test } from '../fixtures.js';
import { checkPrimitivePreviews } from '../../helpers/primitive-preview.js';

test('J21 temporal and enum inputs validate and execute through the preview boundary', async ({ page, evidence }) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  await checkPrimitivePreviews(page, (name) => evidence.checkpoint(name));
});
