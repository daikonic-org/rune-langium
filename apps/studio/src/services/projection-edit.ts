// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { parseExpression, type RosettaExpression, type SourceRegion } from '@rune-langium/core';
import { RosettaExpressionSchema } from '@rune-langium/core/zod-schemas';
import { renderExpression, treesEquivalent } from '@rune-langium/codegen/rosetta';
import { parseSourceTsBody, renderSourceTypeScriptExpression, type ProjectionOrigin } from '@rune-langium/codegen/lens';
import type { DocumentBinding, DocumentEdit } from './expression-document.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Shared by inline projection edits and the legacy single-expression lens. */
export const expressionReplacement = withInstrumentation(
  function expressionReplacement(node: RosettaExpression, expectedText: string): string {
    if (!RosettaExpressionSchema.safeParse(node).success)
      throw new Error('The parsed expression is not a valid Rune AST.');
    const original = parseExpression(expectedText);
    const replacement =
      !original.hasErrors && treesEquivalent(original.value, node) ? expectedText : renderExpression(node);
    if (parseExpression(replacement).hasErrors) throw new Error('The draft does not produce valid Rune source.');
    return replacement;
  },
  { op: 'expressionReplacement', capture: 0 }
);

/** Stage one revision-guarded edit; parsing never writes to the canonical document. */
export const prepareProjectionEdit = withInstrumentation(
  async function prepareProjectionEdit(
    binding: DocumentBinding,
    regions: readonly SourceRegion[],
    baseline: string,
    draft: string,
    syntax: 'expression' | 'statements',
    wasm: Uint8Array,
    origins?: readonly ProjectionOrigin[]
  ): Promise<DocumentEdit> {
    if (origins && origins.length !== regions.length)
      throw new Error('The projection origins no longer match the source.');
    const expressions = regions.map((region, index) => {
      if (region.from < binding.region.from || region.to > binding.region.to)
        throw new Error('The expression is outside the captured source.');
      const text = binding.source.slice(region.from, region.to);
      const parsed = parseExpression(text);
      if (parsed.hasErrors) throw new Error('The captured Rune expression is invalid.');
      const projected = origins?.[index];
      const origin = renderSourceTypeScriptExpression(parsed.value, { nameScope: projected?.nameScope }).origin;
      if (projected) {
        const original = parseExpression(projected.rune);
        if (original.hasErrors || !treesEquivalent(original.value, parsed.value))
          throw new Error('The projection origin no longer matches the captured Rune expression.');
        // Linked display facts and outer binding names come from the worker.
        // Reparsed source contributes only safe CST fragments, never replacement type facts.
        origin.code = projected.code;
      }
      return { region, text, origin };
    });
    const body = (code: string) => (syntax === 'expression' ? `const result = ${code};\nreturn result;` : code);
    const result = await parseSourceTsBody(
      body(draft),
      body(baseline),
      expressions.map((item) => item.origin),
      wasm
    );
    if (!result.ok) throw new Error(result.reason.message);
    let replacement = binding.source.slice(binding.region.from, binding.region.to);
    // Apply back-to-front so every coordinate still refers to the captured source.
    for (let index = expressions.length - 1; index >= 0; index--) {
      const expression = expressions[index]!;
      const from = expression.region.from - binding.region.from;
      const to = expression.region.to - binding.region.from;
      replacement =
        replacement.slice(0, from) +
        expressionReplacement(result.nodes[index]!, expression.text) +
        replacement.slice(to);
    }
    return {
      binding,
      region: binding.region,
      expectedText: binding.source.slice(binding.region.from, binding.region.to),
      replacement
    };
  },
  { op: 'prepareProjectionEdit', capture: 0 }
);
