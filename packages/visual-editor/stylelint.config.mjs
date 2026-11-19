// @ts-check

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  plugins: [
    './stylelint-plugins/no-literal-layout-px.mjs',
    './stylelint-plugins/no-raw-color.mjs',
    './stylelint-plugins/no-raw-typography.mjs',
    './stylelint-plugins/no-raw-geometry.mjs'
  ],
  rules: {
    'rune/no-literal-layout-px': true,
    // Keep radius + spacing on the design-system token ladders (raw px can't
    // drift back in). Hairline insets ≤3px and custom-prop defs are allowed.
    'rune/no-raw-geometry': true,
    'rune/no-raw-typography': true,
    // Require design tokens for color values.
    // box-shadow excluded: depth-cue alpha layers (glass shadows) use raw
    // oklch(0 0 0 / alpha) with no 1-to-1 token mapping.
    'rune/no-raw-color': [
      true,
      {
        ignoreProperties: ['box-shadow', 'text-shadow']
      }
    ],
    // Relax rules that don't fit the existing repo style:
    'selector-class-pattern': null, // allow BEM-style with double-dash modifiers
    'no-descending-specificity': null, // existing repo has these
    'declaration-block-no-redundant-longhand-properties': null,
    // Existing CSS uses oklch(L C H / A) shorthand notation with bare numbers
    // (no "deg"/"%" suffixes) and rgba() — disable the pedantic notation rules
    // so we don't need a mass rewrite of the existing color palette.
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'hue-degree-notation': null,
    'lightness-notation': null,
    // Existing CSS uses shorthand `#rrggbb` hex colors — allow both lengths.
    'color-hex-length': null,
    // Existing CSS uses `0px` in some shorthand values (e.g. "0px 1px").
    'length-zero-no-unit': null,
    // Existing CSS uses `currentColor` (capital C) from upstream libraries.
    'value-keyword-case': null,
    // Existing CSS has some shorthand redundancies intentional for clarity.
    'shorthand-property-no-redundant-values': null,
    // Existing CSS comment / rule blank-line placement doesn't match standard.
    'comment-empty-line-before': null,
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null
  },
  ignoreFiles: ['dist/**', 'node_modules/**']
};
