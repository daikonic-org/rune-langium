// @ts-check
// SPDX-License-Identifier: MIT
// Custom stylelint rule: forbid literal pixel values for layout-coupled
// properties on geometry-bearing class selectors. Forces use of the
// var(--rune-*) custom properties declared in styles.css.
//
// See test/layout/structure-css-ssot.test.ts (Part A) for the parity check
// that these custom props match `GRAPH_NODE_GEOMETRY` in
// src/layout/graph-node-geometry.ts.

import stylelint from 'stylelint';

const ruleName = 'rune/no-literal-layout-px';

const messages = stylelint.utils.ruleMessages(ruleName, {
  literalPx: (selector, prop, value) =>
    `Layout-coupled property "${prop}: ${value}" on geometry class "${selector}" must use var(--rune-*) custom property (see graph-node-geometry.ts).`
});

const meta = {
  url: 'https://github.com/pradeepmouli/rune-langium/blob/master/packages/visual-editor/stylelint-plugins/no-literal-layout-px.mjs'
};

// Only the structure-view geometry classes that are layout-coupled to
// GRAPH_NODE_GEOMETRY.  Mirrors the pattern in the vitest parity
// checker (test/layout/structure-css-ssot.test.ts Part A) so both tools
// agree on scope.
const GEOMETRY_CLASS_PATTERN =
  /\.rune-(node-header|node-rows|node-row|node-children-slot|graph-group__header|graph-group--base|graph-group__base-rows?|graph-group__base-row|cell)/;

// Header classes (.rune-node-header, .rune-graph-group__header) are in scope
// only for box-dimension properties — their gap/padding are visual insets, not
// y-coordinate coupling.  All other geometry classes use the full property set.
const HEADER_CLASS_PATTERN = /\.rune-(node-header|graph-group__header)\b/;
const HEADER_GEOMETRY_PROPS = new Set(['height', 'min-height', 'max-height']);

const GEOMETRY_PROPS = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'top',
  'left',
  'right',
  'bottom'
]);

/** Returns true if `value` is a layout-coupled literal-px expression. */
function isViolation(value) {
  // Allow zero values, auto/none/inherit/initial
  if (/^0(px)?$/.test(value)) return false;
  if (/^(auto|none|inherit|initial|revert|unset)$/.test(value)) return false;
  // Only exempt var(--rune-*, ...) calls — design-system token vars (e.g.
  // var(--space-2, 8px)) must NOT be used for layout-coupled properties on
  // .rune-* selectors because they bypass the GRAPH_NODE_GEOMETRY
  // coupling. New geometry values must be promoted to --rune-* SSoT first.
  //
  // Regex breakdown:
  //   \bvar\(         — start of var() call
  //   --rune-[^,)]*  — must begin with --rune- and continue until comma or )
  //   (?:,[^)]*)?    — optional fallback (anything after comma until close)
  //   \)             — close paren
  const withoutRuneVars = value.replace(/\bvar\(--rune-[^,)]*(?:,[^)]*)?\)/g, 'VAR');
  if (!/\d+px/.test(withoutRuneVars)) return false;
  // Special-case: shorthand starting with "0 " (vertical zero) followed by
  // horizontal-only px is allowed — horizontal padding/margin doesn't couple
  // to layout y-coords. This matches the existing `.rune-node-row { padding: 0 8px }` pattern.
  if (/^0\s+\d+px$/.test(value.trim())) return false;
  return true;
}

const rule = (primary) => (root, result) => {
  const validOptions = stylelint.utils.validateOptions(result, ruleName, {
    actual: primary,
    possible: [true]
  });
  if (!validOptions) return;

  root.walkRules((ruleNode) => {
    if (!GEOMETRY_CLASS_PATTERN.test(ruleNode.selector)) return;
    // Header classes are layout-coupled only for box-dimension props (height/
    // min-height).  Their gap and padding are visual insets, not y-coord
    // coupling, so we use a narrower property set for those selectors.
    const props = HEADER_CLASS_PATTERN.test(ruleNode.selector) ? HEADER_GEOMETRY_PROPS : GEOMETRY_PROPS;
    ruleNode.walkDecls((decl) => {
      if (!props.has(decl.prop.toLowerCase())) return;
      if (!isViolation(decl.value)) return;
      stylelint.utils.report({
        message: messages.literalPx(ruleNode.selector, decl.prop, decl.value),
        node: decl,
        result,
        ruleName
      });
    });
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;

export default stylelint.createPlugin(ruleName, rule);
