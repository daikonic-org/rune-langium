// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  AstUtils,
  DefaultHydrator,
  type AstNode,
  type CstNode,
  type DehydrateContext,
  type HydrateContext,
  type Reference
} from 'langium';
import { isRosettaModel } from '../generated/ast.js';
import type { Dehydrated } from '../serializer/dehydrated.js';

/**
 * Hydrator variant for the Rune store substrate.
 *
 * Differences from DefaultHydrator:
 *  - CST nodes are dropped entirely — the store has no use for parse-tree data.
 *    (`$cstNode`, `$containerIndex`, and `$containerProperty` are deleted from
 *    the output so the runtime object matches the `Dehydrated<T>` type, which
 *    excludes all Langium runtime fields.)
 *  - `$cstText` (a custom field stamped by `preserveCstText` BEFORE dehydration)
 *    is preserved — the visual editor's expression cells read it after the
 *    round-trip, and DefaultHydrator would otherwise drop it as a `$`-field.
 *  - References are stored as `{ $refText: string }` only — the editable `Dehydrated<T>` wire format.
 *  - Re-hydration rebuilds a proper `Reference` via `this.linker.buildReference`, passing
 *    `undefined` for the CST node (consistent with the drop above).
 *  - $namespace is stamped from the enclosing RosettaModel before $container is stripped.
 */
export class RuneStoreHydrator extends DefaultHydrator {
  /** Dehydrate a single AST node to its Dehydrated<T> wire form. */
  dehydrateNode<T extends AstNode>(node: T): Dehydrated<T> {
    const context = this.createDehyrationContext(node);
    return this.dehydrateAstNode(node, context) as Dehydrated<T>;
  }

  /**
   * CST nodes never survive dehydration here (see class doc), so skip the
   * base class's full CST-tree walk when building the context — on large
   * corpora that walk dominates dehydration cost for zero benefit.
   */
  protected override createDehyrationContext(node: AstNode): DehydrateContext {
    const astNodes = new Map<AstNode, unknown>();
    for (const astNode of AstUtils.streamAst(node)) {
      astNodes.set(astNode, {});
    }
    return { astNodes, cstNodes: new Map() };
  }

  protected override dehydrateAstNode(node: AstNode, context: DehydrateContext): object {
    const result = super.dehydrateAstNode(node, context) as Record<string, unknown>;
    delete result.$containerIndex;
    delete result.$containerProperty;
    delete result.$cstNode;
    // The transport uses JSON numbers. Restore the editor AST's integer type
    // before generated schemas validate it. CST ranges retain the authored digits.
    if (node.$type === 'RosettaIntLiteral' && typeof result.value === 'number' && Number.isInteger(result.value)) {
      result.value = BigInt(result.value);
    }
    // Permanent baseline locator for CST-reuse serialization. Two ints; not the
    // text (which would nest/duplicate). Read from the live node, whose $cstNode
    // is still attached at this point.
    const cst = node.$cstNode;
    if (cst && typeof cst.offset === 'number' && typeof cst.end === 'number') {
      result.$cstRange = { offset: cst.offset, end: cst.end };
    } else {
      // Deserialized nodes (e.g. from /api/parse's JSON-serialized response) never
      // carry a live $cstNode — Langium's JsonSerializer deliberately drops it on
      // serialize and never reconstructs it on deserialize. It DOES carry a plain
      // $textRegion snapshot (RUNE_SERIALIZE_OPTIONS sets textRegions: true), copied
      // from the same real CstNode.offset/.end at serialize time — same offset
      // space cst-reuse-renderer.ts already assumes, no conversion needed. Without
      // this fallback, every node parsed via the production /api/parse router path
      // silently loses its $cstRange, and CST-reuse serialization can never patch
      // an existing declaration in place — it always appends a duplicate instead.
      const textRegion = (node as AstNode & { $textRegion?: { offset?: number; end?: number } }).$textRegion;
      if (textRegion && typeof textRegion.offset === 'number' && typeof textRegion.end === 'number') {
        result.$cstRange = { offset: textRegion.offset, end: textRegion.end };
      }
    }
    const cstText = (node as AstNode & { $cstText?: unknown }).$cstText;
    if (typeof cstText === 'string') {
      result.$cstText = cstText;
    }
    const model = AstUtils.getContainerOfType(node, isRosettaModel);
    if (model) {
      result.$namespace = model.name;
    }
    return result;
  }

  protected override dehydrateCstNode(_node: CstNode, _context: DehydrateContext): Record<string, never> {
    return {};
  }

  protected override dehydrateReference(reference: Reference, _context: DehydrateContext): { $refText: string } {
    return { $refText: reference.$refText };
  }

  protected override hydrateReference(
    reference: { $refText: string },
    node: AstNode,
    name: string,
    _context: HydrateContext
  ): Reference {
    return this.linker.buildReference(node, name, undefined, reference.$refText);
  }
}
