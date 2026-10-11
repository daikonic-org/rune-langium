// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, authorScratchFunction } from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectBodyProjection, expectEditorExpansion } from '../../helpers/body-projection.js';

const NAMESPACE = 'scratch.j10cond';
const FUNCTION_NAME = 'ValidateAmount';
const NODE_ID = `${NAMESPACE}.${FUNCTION_NAME}`;

test.describe('J10 — Continuous expression editing and generated views', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J10 displays complete TypeScript and Python bodies without changing Rune', async ({ page, evidence }) => {
    await authorScratchFunction(page, {
      name: FUNCTION_NAME,
      namespace: NAMESPACE,
      inputs: [{ name: 'amount', typeName: 'number', cardinality: '(1..1)' }],
      outputName: 'result',
      outputType: 'number',
      outputCardinality: '(1..1)',
      body: 'amount',
      condition: { name: 'AmountPositive', expression: 'amount > 0' }
    });
    await typeNavigationButton(page, NODE_ID, 'RosettaFunction').click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const implementation = page.getByRole('region', { name: 'Function implementation' });
    await expect(implementation.getByTestId('implementation-editor')).toHaveCount(1);
    await expect(implementation).toContainText('AmountPositive');
    await expect(implementation).toContainText('set result: amount');
    await expectEditorExpansion(implementation);
    await evidence.checkpoint('continuous-rune-implementation');

    for (const language of ['TypeScript', 'Python'] as const) {
      await expectBodyProjection(
        implementation,
        language,
        language === 'TypeScript' ? 'input.amount' : 'input["amount"]',
        'return result'
      );
      await evidence.checkpoint(`generated-${language.toLowerCase()}`);
    }
    await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
    await expect(implementation).toContainText('AmountPositive');
    await expect(implementation).toContainText('set result: amount');
    await evidence.checkpoint('canonical-rune-unchanged');
  });
});
