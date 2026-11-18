// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import typography from '../../stylelint-plugins/no-raw-typography.mjs';

const config = { plugins: [typography], rules: { 'rune/no-raw-typography': true } };
const warnings = async (code: string) => (await stylelint.lint({ code, config })).results[0]!.warnings;

describe('font token enforcement', () => {
  it('allows the four families, weight tokens and cascade inheritance', async () => {
    expect(
      await warnings(`
        .title { font-family: var(--font-title); font-weight: var(--font-weight-medium); }
        .body { font-family: var(--font-body); }
        .mono { font-family: var(--font-mono); }
        .code { font-family: var(--font-code); }
        button { font: inherit; font-weight: inherit; font-family: unset; }
      `)
    ).toEqual([]);
  });

  it.each([
    'font-family: "Daikonic Transit Sans", sans-serif',
    'font-family: var(--font-display)',
    'font-family: var(--font-body), Arial',
    'font-family: var(--font-body, Arial)',
    'font-weight: 500',
    'font-weight: bold',
    'font: 500 13px Arial'
  ])('rejects a token bypass: %s', async (declaration) => {
    expect(await warnings(`.label { ${declaration}; }`)).toHaveLength(1);
  });

  it('permits literal token definitions and font-face registration descriptors', async () => {
    expect(
      await warnings(`
        :root { --font-body: "Daikonic Transit System", sans-serif; --font-weight-medium: 500; }
        @font-face { font-family: "Daikonic Transit System"; font-weight: 300 600; src: url(system.woff2); }
      `)
    ).toEqual([]);
  });

  it('checks all shared design-system stylesheets using the same rule', async () => {
    const directory = resolve(import.meta.dirname, '../../../design-system/src');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.css'));
    for (const name of files) {
      expect(await warnings(await readFile(resolve(directory, name), 'utf8')), name).toEqual([]);
    }
  });
});
