// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Cardinality-aware operands; callbacks retain the operands' concrete types. */
export function binaryRuntimeSource(typescript: boolean, exported = false): string {
  const prefix = exported ? 'export ' : '';
  const type = (value: string) => (typescript ? value : '');
  const left = type(': A');
  const right = type(': B');
  const resultType =
    'L extends readonly unknown[] | null | undefined ? V | undefined : R extends readonly unknown[] | null | undefined ? V | undefined : V';
  return `${type('type RuneOperand<T> = T extends readonly (infer I)[] ? NonNullable<I> : NonNullable<T>;')}
${prefix}const runeBinary = ${type('<L, R, V>')}(left${type(': L')}, right${type(': R')}, operate${type(': (a: RuneOperand<L>, b: RuneOperand<R>) => V')})${type(`: ${resultType}`)} => {
  const l = runeList(left).filter((value) => value != null);
  const r = runeList(right).filter((value) => value != null);
  return (${singletonBinaryResult(`operate(l[0]${type(' as RuneOperand<L>')}, r[0]${type(' as RuneOperand<R>')})`)})${type(` as ${resultType}`)};
};
${prefix}const runeCompare = ${type('<A, B>')}(left${left}, right${right}, compare${type(': (a: RuneOperand<A>, b: RuneOperand<B>) => boolean')}, quantifier${type(": 'all' | 'any'")} = 'all')${type(': boolean')} => {
  const l = runeList(left).filter((value) => value != null);
  const r = runeList(right).filter((value) => value != null);
  if (l.length === 0 || r.length === 0) return false;
  return ${cartesianComparison(`compare(a${type(' as RuneOperand<A>')}, b${type(' as RuneOperand<B>')})`, "quantifier === 'all'")};
};
${prefix}const runeOrder = ${type('<T>')}(left${type(': T')}, right${type(': T')}, compare${type(': (a: NonNullable<T>, b: NonNullable<T>) => number')}, nullsLast = true)${type(': number')} => {
  if (left == null) return right == null ? 0 : nullsLast ? 1 : -1;
  if (right == null) return nullsLast ? -1 : 1;
  return compare(left, right);
};`;
}

export function singletonBinaryResult(operation: string): string {
  return `l.length === 1 && r.length === 1 ? ${operation} : undefined`;
}

export function cartesianComparison(comparison: string, all: string): string {
  return `${all} ? l.every((a) => r.every((b) => ${comparison})) : l.some((a) => r.some((b) => ${comparison}))`;
}
