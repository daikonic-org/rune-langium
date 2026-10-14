// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Shared source for structural Rune value equality in TS and executable previews. */
export function valueEqualitySource(
  typescript: boolean,
  exported = false,
  members: Readonly<Record<string, string>> = {}
): string {
  const prefix = exported ? 'export ' : '';
  const valueType = typescript ? ': unknown' : '';
  const fields = typescript ? ' as Record<string, unknown>' : '';
  return `${prefix}const runeValueKey = (value${valueType})${typescript ? ': string' : ''} => {
  if (value == null) return 'null';
  if (typeof value !== 'object') return typeof value + ':' + String(value);
  if (Array.isArray(value)) return 'array:' + JSON.stringify(value.map(runeValueKey));
  const tag = Object.prototype.toString.call(value);
  if (/^\\[object Temporal\\.(PlainDate|PlainTime|PlainDateTime|ZonedDateTime|Instant|PlainYearMonth|PlainMonthDay|Duration)\\]$/.test(tag)) return tag + ':' + String(value);
  const fields = value${fields};
  return 'object:' + JSON.stringify(Object.keys(fields).sort().filter((key) => fields[key] != null).map((key) => [key, runeValueKey(fields[key])]));
};
${prefix}const rune = {
  equals: (left${valueType}, right${valueType}, quantifier${typescript ? "?: 'all' | 'any'" : ' = undefined'}, unequal = false)${typescript ? ': boolean' : ''} => {
    if (quantifier == null) {
      const same = runeValueKey(left) === runeValueKey(right);
      return unequal ? !same : same;
    }
${quantifiedEqualityBody('unequal ? !rune.equals(a, b) : rune.equals(a, b)', typescript)}
  },
${Object.entries(members)
  .map(([name, implementation]) => `  ${name}: ${implementation}`)
  .join(',\n')}
};`;
}

/** The same broadcasting and positional comparison rules for helpers and native predicates. */
export function quantifiedEqualityBody(
  comparison: string,
  typescript: boolean,
  quantifier = "quantifier === 'all'"
): string {
  const valueType = typescript ? ': unknown' : '';
  return `    const leftArray = Array.isArray(left), rightArray = Array.isArray(right);
    const l = leftArray ? left : left == null ? [] : [left];
    const r = rightArray ? right : right == null ? [] : [right];
    if (l.length === 0 || r.length === 0) {
      const same = leftArray === rightArray && l.length === r.length;
      return unequal ? !same : same;
    }
    const compare = (a${valueType}, b${valueType}) => ${comparison};
    if (!leftArray) return ${quantifier} ? r.every((b) => compare(left, b)) : r.some((b) => compare(left, b));
    if (!rightArray) return ${quantifier} ? l.every((a) => compare(a, right)) : l.some((a) => compare(a, right));
    return ${quantifier}
      ? (unequal || l.length === r.length) && l.every((a, i) => i >= r.length ? unequal : compare(a, r[i]))
      : (unequal && l.length !== r.length) || l.some((a, i) => i < r.length && compare(a, r[i]));`;
}
