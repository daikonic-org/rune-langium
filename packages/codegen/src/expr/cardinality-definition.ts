// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** One mapping supplies enum-like runtime constants and their emitted spellings. */
const CARDINALITIES = {
  One: [1, 1],
  Optional: [0, 1],
  ZeroOrMore: [0, null],
  OneOrMore: [1, null]
} as const;

export function renderCardinality(lower: number, upper: number | null): string {
  const common = Object.entries(CARDINALITIES).find(([, bounds]) => bounds[0] === lower && bounds[1] === upper);
  return common
    ? `Cardinality.${common[0]}`
    : upper === null
      ? `Cardinality.atLeast(${lower})`
      : `Cardinality.range(${lower}, ${upper})`;
}

export function cardinalityRuntimeSource(exported: boolean): string {
  const e = exported ? 'export ' : '';
  return `
${e}type Cardinality<Lower extends number = number, Upper extends number | null = number | null> = readonly [Lower, Upper];
const runeCardinalityRange = <const Lower extends number, const Upper extends number | null>(lower: Lower, upper: Upper): Cardinality<Lower, Upper> => {
  if (!Number.isSafeInteger(lower) || lower < 0 || (upper !== null && (!Number.isSafeInteger(upper) || upper < lower))) throw new RangeError('Cardinality requires nonnegative integer counts and an upper count at least as large as the lower count');
  const bounds: [Lower, Upper] = [lower, upper];
  return Object.freeze(bounds);
};
${e}const Cardinality = Object.freeze({
${Object.entries(CARDINALITIES)
  .map(([name, [lower, upper]]) => `  ${name}: runeCardinalityRange(${lower}, ${upper}),`)
  .join('\n')}
  range: <const Lower extends number, const Upper extends number>(lower: Lower, upper: Upper): Cardinality<Lower, Upper> => runeCardinalityRange(lower, upper),
  atLeast: <const Lower extends number>(lower: Lower): Cardinality<Lower, null> => runeCardinalityRange(lower, null)
});`;
}
