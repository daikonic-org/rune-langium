// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { DefaultScopeComputation } from 'langium';
import type { AstNode, AstNodeDescription, LangiumDocument, MultiMap } from 'langium';
import { isRosettaFunction, isRosettaEnumeration } from '../generated/ast.js';
import { qualifiedExportPath } from '../naming/qualified-export-path.js';

/**
 * Custom scope computation for the Rune DSL.
 *
 * 1. Exports every top-level element under both its simple name AND its
 *    fully-qualified namespace name (e.g. `fpml.consolidated.shared.PartyReference`),
 *    so that cross-file references using qualified names resolve correctly.
 *
 * 2. For dispatch function overloads, also adds the BASE function's inputs to
 *    the overload's local symbols.  Overloads share a name with the base
 *    function but have no explicit `inputs:` section; their bodies still
 *    reference the base function's inputs by name.
 */
export class RuneDslScopeComputation extends DefaultScopeComputation {
  // ── Global exports ───────────────────────────────────────────────

  protected override addExportedSymbol(node: AstNode, exports: AstNodeDescription[], document: LangiumDocument): void {
    // Always add the simple-name entry (default behaviour).
    super.addExportedSymbol(node, exports, document);

    // Also add a namespace-qualified entry when the node is a direct child
    // of a RosettaModel (i.e. a top-level declaration such as Data, Choice,
    // RosettaEnumeration, RosettaFunction, …).
    const container = node.$container;
    if (!container || container.$type !== 'RosettaModel') return;

    const ns = (container as { name?: string }).name;
    if (!ns) return;

    const simpleName = this.nameProvider.getName(node);
    if (!simpleName) return;

    const qualifiedName = qualifiedExportPath(ns, simpleName);
    exports.push(this.descriptions.createDescription(node, qualifiedName, document));

    // Also export enum values (nested inside RosettaEnumeration) to the global index,
    // so they can be resolved as RosettaSymbol references (e.g. `Upfront` passed as
    // a function argument).  The default Langium export only covers direct children of
    // RosettaModel, so enum values would otherwise be invisible in the global scope.
    if (isRosettaEnumeration(node)) {
      for (const enumValue of node.enumValues) {
        const valueName = this.nameProvider.getName(enumValue);
        if (valueName) {
          exports.push(this.descriptions.createDescription(enumValue, valueName, document));
        }
      }
    }
  }

  // ── Local symbols ────────────────────────────────────────────────

  protected override addLocalSymbol(
    node: AstNode,
    document: LangiumDocument,
    symbols: MultiMap<AstNode, AstNodeDescription>
  ): void {
    // Default behaviour: add the node to its direct container's local scope.
    super.addLocalSymbol(node, document, symbols);

    // Extra: when a dispatch overload is encountered, also expose the BASE
    // function's inputs in the overload's own local scope.
    //
    // Context: `func YearFraction(dcf: DayCountFractionEnum -> ACT_360):` is a
    // dispatch overload.  It has no `inputs:` section of its own, yet its body
    // may reference `dcf` (or any other input defined on the base declaration).
    // Langium's default local-symbol logic only looks at a node's OWN container,
    // so the base function's inputs are invisible inside the overload body.
    //
    // We fix this by injecting the base function's Attribute inputs into the
    // overload's local symbol map.  We do this once per overload function node
    // by checking whether the overload has a dispatchAttribute.
    if (isRosettaFunction(node) && node.dispatchAttribute) {
      const model = node.$container;
      if (!model || model.$type !== 'RosettaModel') return;

      for (const element of model.elements) {
        if (!isRosettaFunction(element)) continue;
        if (element.name !== node.name) continue;
        if (element === node || element.dispatchAttribute) continue;

        // Inherit only from the base declaration. Sibling variants have independent
        // alias scopes, even when their shortcut names are identical.
        for (const input of element.inputs) {
          const name = this.nameProvider.getName(input);
          if (name) {
            symbols.add(node, this.descriptions.createDescription(input, name, document));
          }
        }
        if (element.output) {
          const name = this.nameProvider.getName(element.output);
          if (name) {
            symbols.add(node, this.descriptions.createDescription(element.output, name, document));
          }
        }
        for (const shortcut of element.shortcuts) {
          const name = this.nameProvider.getName(shortcut);
          if (name) {
            symbols.add(node, this.descriptions.createDescription(shortcut, name, document));
          }
        }
      }
    }
  }
}
