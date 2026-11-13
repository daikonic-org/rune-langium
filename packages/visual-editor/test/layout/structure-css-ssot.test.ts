// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPH_NODE_GEOMETRY, GRAPH_NODE_CSS_VARS } from '../../src/layout/graph-node-geometry.js';
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const css = readFileSync(join(sourceRoot, 'styles.css'), 'utf8');
const componentStyles = readdirSync(sourceRoot, { recursive: true })
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => readFileSync(join(sourceRoot, file), 'utf8'))
  .join('\n');

describe('Graph header geometry', () => {
  it('has one authoritative header height for the emitted CSS variable', () => {
    expect(GRAPH_NODE_CSS_VARS['--rune-header-height']).toBe(`${GRAPH_NODE_GEOMETRY.HEADER_HEIGHT}px`);
    expect(css).not.toMatch(/--rune-header-height\s*:/);
    expect(css).toContain('height: var(--rune-header-height)');
  });
});

// ── Part B: every --rune-* custom property is referenced at least once ───────

describe('Shared styles — every --rune-* var is referenced (not just declared)', () => {
  it('every --rune-* custom property is consumed in shared CSS or component styles', () => {
    // Collect all custom-property names declared anywhere in the stylesheet.
    const declRe = /(--rune-[a-z-]+)\s*:/g;
    const declared = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(css)) !== null) declared.add(m[1]);

    const unused: string[] = [];
    for (const v of declared) {
      const refRe = new RegExp(`var\\(${v}\\b`);
      // Components can own their intrinsic look through Tailwind's token syntax,
      // e.g. TypeChip's py-(--rune-chip-padding-y), rather than duplicate CSS.
      const componentRefRe = new RegExp(`(?:var\\(|[a-z-]+-\\()${v}\\b`);
      if (!refRe.test(css) && !componentRefRe.test(componentStyles)) unused.push(v);
    }
    expect(unused, `These --rune-* vars have no CSS or component consumer: ${unused.join(', ')}`).toEqual([]);
  });
});
