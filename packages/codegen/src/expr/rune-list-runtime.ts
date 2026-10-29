// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Array composition keeps Rune collection behavior off native prototypes and API values. */
export function runeListRuntimeSource(typescript: boolean, exported = false): string {
  const t = (source: string) => (typescript ? source : '');
  const prefix = exported ? 'export ' : '';
  return `${prefix}class RuneList${t('<T>')} {
  ${t('private readonly ')}items${t(': T[]')};
  constructor(items${t(': readonly T[]')}) { this.items = items.filter(item => item != null); }
  static from${t('<T>')}(...items${t(': T[]')})${t(': RuneList<T>')} { return new RuneList(items); }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  toArray()${t(': T[]')} { return [...this.items]; }
  toJSON()${t(': T[]')} { return this.toArray(); }
  map${t('<U>')}(project${t(': (item: T, index: number) => U')})${t(': RuneList<NonNullable<U>>')} {
    return new RuneList(this.items.map(project).filter((value)${t(': value is NonNullable<U>')} => value != null));
  }
  flatMap${t('<U>')}(project${t(': (item: T, index: number) => U | readonly U[] | null | undefined')})${t(': RuneList<U>')} {
    return new RuneList(this.items.flatMap((item, index) => [...runeList(project(item, index))])${t(' as U[]')});
  }
  filter(predicate${t(': (item: T, index: number) => boolean')}) { return new RuneList(this.items.filter(predicate)); }
  first() { return this.items[0]; }
  last() { return this.items[this.items.length - 1]; }
  count() { return this.items.length; }
  sum(${t('this: RuneList<number>')}) { return this.items.reduce((total, item) => total + item, 0); }
  onlyElement() { return this.items.length === 1 ? this.items[0] : undefined; }
  distinct() { return new RuneList(runeDistinct(this.items)); }
  reverse() { return new RuneList([...this.items].reverse()); }
  flat${t('<U>')}(${t('this: RuneList<U | readonly U[]>')})${t(': RuneList<U>')} {
    return new RuneList(this.items.flatMap(value => [...runeList(value)])${t(' as U[]')});
  }
  sort${t('<K = T>')}(key${t(': (item: T) => K')} = (item) => item${t(' as unknown as K')}, compare${t(': (a: NonNullable<K>, b: NonNullable<K>) => number')} = (a, b) => a < b ? -1 : a > b ? 1 : 0) {
    return new RuneList([...this.items].sort((a, b) => runeOrder(key(a), key(b), compare)));
  }
  min${t('<K = T>')}(key${t(': (item: T) => K')} = (item) => item${t(' as unknown as K')}, compare${t(': (a: NonNullable<K>, b: NonNullable<K>) => number')} = (a, b) => a < b ? -1 : a > b ? 1 : 0) {
    return this.items.reduce${t('<T | undefined>')}((best, item) => best === undefined || runeOrder(key(item), key(best), compare) < 0 ? item : best, undefined);
  }
  max${t('<K = T>')}(key${t(': (item: T) => K')} = (item) => item${t(' as unknown as K')}, compare${t(': (a: NonNullable<K>, b: NonNullable<K>) => number')} = (a, b) => a < b ? -1 : a > b ? 1 : 0) {
    return this.items.reduce${t('<T | undefined>')}((best, item) => best === undefined || runeOrder(key(item), key(best), compare, false) > 0 ? item : best, undefined);
  }
  reduce(reduce${t(': (previous: T, current: T) => T')}) { return this.items.length ? this.items.reduce(reduce) : undefined; }
  join(separator = '') { return this.items.join(separator); }
  has(value${t(': unknown')}) { return runeContains(this.items, [value]); }
  isSupersetOf(values${t(': unknown')}) { return runeContains(this.items, values instanceof RuneList ? values.items : values); }
  isDisjointFrom(values${t(': unknown')}) { return runeDisjoint(this.items, values instanceof RuneList ? values.items : values); }
}
${prefix}const runeExtract = ${t('<T, U>')}(value${t(': T')}, project${t(': (value: NonNullable<T>) => U')})${t(': U | undefined')} => value == null ? undefined : project(value);
${prefix}const runeFilter = ${t('<T>')}(value${t(': T')}, predicate${t(': (value: NonNullable<T>) => boolean')})${t(': T | undefined')} => value != null && predicate(value) ? value : undefined;`;
}
