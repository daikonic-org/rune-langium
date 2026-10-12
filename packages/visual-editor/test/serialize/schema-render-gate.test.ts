// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Schema-driven render gate (schema-as-validity-trigger design, Stream 3 T3).
 *
 * `cst-reuse-renderer`'s `render()` closure now `safeParse`s a dirty/new
 * node against `SCHEMA_BY_TYPE[node.$type]` before calling `renderNode`.
 * On failure it takes the SAME CST/skip fallback path a `renderNode`-
 * returns-null outcome already took.
 *
 * Two of the three failure-path tests below are DELIBERATELY redundant with
 * render-core's own throw-based fallback (contentless synonym body — #363 —
 * and empty `sources`'s sibling check don't both apply here; see each test's
 * comment for which). The `empty sources` test is the one that ISN'T
 * redundant: verified empirically (by temporarily reverting the gate) that
 * `renderSynonym` does NOT check `sources.length` and happily emits
 * `"[synonym  value \"x\"]"` (double space, no source name — syntactically
 * broken `.rosetta`, confirmed to fail re-parse) with no throw at all. Only
 * the schema's `sources: z.array(...).min(1)` catches this — proving the
 * gate adds real coverage beyond render-core's existing fallbacks, not just
 * a redundant second check on cases already caught.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '@rune-langium/core';
import { parsedAdapter } from '@rune-langium/core';
import { renderNamespace, setSchemaGateDebug } from '../../src/serialize/cst-reuse-renderer.js';
import { buildDirtyIndex } from '../../src/serialize/dirty-paths.js';
import type { Patches } from 'mutative';
import type { TypeGraphNode } from '../../src/types.js';

afterEach(() => {
  setSchemaGateDebug(false); // restore the production default after debug-flag tests
  vi.restoreAllMocks();
});

const SRC_WITH_SYNONYM = `namespace test
version "1.0.0"

synonym source FpML

type Trade:
  notional number (1..1)
    [synonym FpML value "notionalAmount"]
`;

function makeNode(data: unknown, id: string): TypeGraphNode {
  return { id, data, meta: { namespace: 'test', deferred: false } } as unknown as TypeGraphNode;
}

describe('schema-driven render gate', () => {
  it('a contentless synonym body (all 5 alternatives empty) fails schema and falls back to CST byte-identically', async () => {
    const { value, hasErrors } = await parse(SRC_WITH_SYNONYM);
    expect(hasErrors).toBe(false);
    // elements[0] is the `synonym source FpML` declaration (RosettaSynonymSource);
    // `Trade` is elements[1].
    const raw = (value as unknown as { elements: unknown[] }).elements[1];
    const dehydrated = parsedAdapter.dehydrate(raw as Parameters<typeof parsedAdapter.dehydrate>[0]);

    const dd = dehydrated as unknown as {
      attributes: Array<{ synonyms: Array<{ body: Record<string, unknown> }> }>;
    };
    // Blank out the parsed synonym's body — all 5 RosettaSynonymBody
    // alternatives (values/hints/merge/mappingLogic/metaValues) absent.
    // This is the #363 fallback shape (render-synonym-body.ts's
    // UnsupportedSynonymBodyError case), now caught by the schema gate
    // BEFORE renderNode/renderSynonymBody is ever called.
    const synonym = dd.attributes[0]!.synonyms[0]!;
    synonym.body = { $type: 'RosettaSynonymBody', hints: [], metaValues: [] };

    const nodeId = 'test.Trade';
    const node = makeNode(dehydrated, nodeId);

    // Dirty the synonym's OWN path so render() recurses into it as a
    // regenerate (a patch scoped only to a sibling field on the attribute
    // would leave the synonym's own $cstRange clean and CST-reuse it
    // directly, never reaching renderNode/the gate at all).
    const patches = [
      { op: 'replace', path: ['nodes', nodeId, 'data', 'attributes', 0, 'synonyms', 0, 'body'], value: synonym.body }
    ] as unknown as Patches;

    let out = '';
    expect(() => {
      out = renderNamespace({ nodes: [node], originalSource: SRC_WITH_SYNONYM, dirty: buildDirtyIndex(patches) });
    }).not.toThrow();

    // The synonym's ORIGINAL bytes are reused verbatim (CST fallback) —
    // schema-driven now, but byte-identical to the pre-gate throw-based
    // outcome (render-synonym-body.ts would have thrown on this exact
    // all-empty shape too).
    expect(out).toContain('[synonym FpML value "notionalAmount"]');
    expect(out).toContain('notional number (1..1)');

    const re = await parse(out);
    expect(re.hasErrors).toBe(false);
  });

  it('an empty sources array fails schema and falls back to CST — render-core alone would emit broken text', async () => {
    const { value, hasErrors } = await parse(SRC_WITH_SYNONYM);
    expect(hasErrors).toBe(false);
    const raw = (value as unknown as { elements: unknown[] }).elements[1];
    const dehydrated = parsedAdapter.dehydrate(raw as Parameters<typeof parsedAdapter.dehydrate>[0]);

    const dd = dehydrated as unknown as {
      attributes: Array<{ synonyms: Array<{ sources: unknown[] }> }>;
    };
    // Empirically verified (gate temporarily reverted): renderSynonym does
    // NOT check sources.length and emits `"[synonym  value \"x\"]"` (double
    // space, no source name) — syntactically broken .rosetta, no throw.
    // RosettaSynonymSchema.sources is `z.array(ReferenceSchema).min(1)`
    // (comma-list min-1, langium-zod 0.10.1+) — this is the ONE case here
    // the schema gate catches that render-core's own fallbacks do not.
    dd.attributes[0]!.synonyms[0]!.sources = [];

    const nodeId = 'test.Trade';
    const node = makeNode(dehydrated, nodeId);
    // Dirty the SYNONYM's own path (not just a sibling field on the
    // attribute) so render() actually recurses into it as a regenerate —
    // an attribute-level-only patch leaves the synonym's own $cstRange
    // clean and it gets CST-reused before ever reaching renderNode/the gate.
    const patches = [
      { op: 'replace', path: ['nodes', nodeId, 'data', 'attributes', 0, 'synonyms', 0, 'sources'], value: [] }
    ] as unknown as Patches;

    const out = renderNamespace({ nodes: [node], originalSource: SRC_WITH_SYNONYM, dirty: buildDirtyIndex(patches) });

    // CST fallback preserves the ORIGINAL (valid) synonym text — never the
    // broken `[synonym  value "x"]` render-core alone would have produced.
    expect(out).toContain('[synonym FpML value "notionalAmount"]');
    expect(out).not.toContain('[synonym  value');

    const re = await parse(out);
    expect(re.hasErrors).toBe(false);
  });

  it('the fallback warn is silent by default (production) and only logs when setSchemaGateDebug(true) is set', async () => {
    const { value, hasErrors } = await parse(SRC_WITH_SYNONYM);
    expect(hasErrors).toBe(false);
    const raw = (value as unknown as { elements: unknown[] }).elements[1];

    function renderWithEmptySources(): void {
      const dehydrated = parsedAdapter.dehydrate(raw as Parameters<typeof parsedAdapter.dehydrate>[0]);
      const dd = dehydrated as unknown as { attributes: Array<{ synonyms: Array<{ sources: unknown[] }> }> };
      dd.attributes[0]!.synonyms[0]!.sources = [];
      const nodeId = 'test.Trade';
      const node = makeNode(dehydrated, nodeId);
      const patches = [
        { op: 'replace', path: ['nodes', nodeId, 'data', 'attributes', 0, 'synonyms', 0, 'sources'], value: [] }
      ] as unknown as Patches;
      renderNamespace({ nodes: [node], originalSource: SRC_WITH_SYNONYM, dirty: buildDirtyIndex(patches) });
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Default (production) state: the schema failure still triggers the CST
    // fallback (proven by the sibling test above), but logs NOTHING — the
    // Copilot-flagged concern (PR #371): under live-apply forms, an
    // intermediate invalid node is the NORMAL editing case, and an
    // unconditional warn would spam production consoles on every serialize
    // of a half-built node.
    renderWithEmptySources();
    expect(warnSpy).not.toHaveBeenCalled();

    // Flipping the debug flag surfaces the same diagnostic for local debugging.
    setSchemaGateDebug(true);
    renderWithEmptySources();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cst-reuse] schema validation failed for $type "Data"'),
      expect.anything()
    );
  });

  it('a valid populated synonym renders structurally unchanged when the attribute is dirtied', async () => {
    const { value, hasErrors } = await parse(SRC_WITH_SYNONYM);
    expect(hasErrors).toBe(false);
    // elements[0] is the `synonym source FpML` declaration (RosettaSynonymSource);
    // `Trade` is elements[1].
    const raw = (value as unknown as { elements: unknown[] }).elements[1];
    const dehydrated = parsedAdapter.dehydrate(raw as Parameters<typeof parsedAdapter.dehydrate>[0]);

    const nodeId = 'test.Trade';
    // Rename the attribute — dirties `attributes.0`, so the synonym is
    // reused via CST (clean $cstRange) rather than regenerated; this proves
    // the gate does not disturb the ALREADY-clean reuse path.
    (dehydrated as unknown as { attributes: Array<{ name: string }> }).attributes[0]!.name = 'notionalRenamed';
    const node = makeNode(dehydrated, nodeId);
    const patches = [
      { op: 'replace', path: ['nodes', nodeId, 'data', 'attributes', 0, 'name'], value: 'notionalRenamed' }
    ] as unknown as Patches;

    const out = renderNamespace({ nodes: [node], originalSource: SRC_WITH_SYNONYM, dirty: buildDirtyIndex(patches) });

    expect(out).toContain('notionalRenamed number (1..1)');
    // The synonym itself is untouched — still byte-identical, whether via
    // CST reuse or (if ever regenerated) a schema-valid structural render.
    expect(out).toContain('[synonym FpML value "notionalAmount"]');

    const re = await parse(out);
    expect(re.hasErrors).toBe(false);
  });
});
