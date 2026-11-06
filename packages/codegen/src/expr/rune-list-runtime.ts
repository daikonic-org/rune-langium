// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Array-backed proxies retain Rune collection operations without modifying native prototypes. */
export function runeListRuntimeSource(typescript: boolean, exported = false): string {
  const t = (source: string) => (typescript ? source : '');
  const prefix = exported ? 'export ' : '';
  return `${prefix}const runeListStorage = Symbol.for('rune-langium.list.items');\n${t(`${prefix}type RuneKeyArguments<T, K> = [key?: undefined, compare?: (a: NonNullable<T>, b: NonNullable<T>) => number] | [key: (item: T) => K, compare?: (a: NonNullable<K>, b: NonNullable<K>) => number];\n${prefix}type RuneFlatElement<T> = T extends readonly (infer U)[] ? U : T;\n${prefix}type RuneArray<T> = RuneList<T> & T[];\n${prefix}type One<T> = T;\n${prefix}type Optional<T> = T | undefined;\n${prefix}type Many<T> = RuneList<T, number, number | null> & [T, T, ...T[]];\n${prefix}type OneOrMore<T> = T | Many<T>;\n${prefix}type ZeroOrMore<T> = OneOrMore<T> | undefined;\n`)}${prefix}class RuneList${t('<T, Min extends number = 0, Max extends number | null = null>')} {
${t('  declare readonly $rune$cardinality?: readonly [T, Min, Max];\n')}  ${t('private readonly ')}items${t(': T[]')};
  constructor(items${t(': readonly T[]')}) {
    this.items = Array.from(items).filter(item => item != null);
    const proxy${t(': unknown')} = new Proxy(this.items, {
      get: (target, key) => {
        if (Object.hasOwn(target, key)) return Reflect.get(target, key, target);
        const owner = key in this ? this : target;
        const value${t(': unknown')} = Reflect.get(owner, key, owner);
        return typeof value === 'function' ? value.bind(owner) : value;
      }
    });
    if (!this.owns(proxy)) throw new TypeError('Invalid RuneList proxy');
    return proxy;
  }
  ${t('private ')}owns(value${t(': unknown')})${t(': value is this')} { return Array.isArray(value) && typeof Reflect.get(value, runeListStorage) === 'function' && Reflect.apply(Reflect.get(value, runeListStorage), value, []) === this.items; }
  static [Symbol.hasInstance](value${t(': unknown')}) { return Array.isArray(value) && typeof Reflect.get(value, runeListStorage) === 'function'; }
  get length() { return this.items.length; }
${t('  project(): ZeroOrMore<T>;\n')}  project()${t(': unknown')} { return this.items.length === 0 ? undefined : this.items.length === 1 ? this.items[0] : this; }
  static from${t('<T>')}(...items${t(': T[]')})${t(': RuneArray<T>')} { return runeArray(items); }
  [runeListStorage]() { return this.items; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  toArray()${t(': T[]')} { return [...this.items]; }
  toJSON()${t(': T[]')} { return this.toArray(); }
  map${t('<U>')}(project${t(': (item: T, index: number, array: T[]) => U')})${t(': RuneArray<NonNullable<U>>')} {
    return runeArray(this.items.map(project).filter((value)${t(': value is NonNullable<U>')} => value != null));
  }
  flatMap${t('<U>')}(project${t(': (item: T, index: number, array: T[]) => U | readonly U[] | null | undefined')})${t(': RuneArray<U>')} {
    return runeArray(this.items.flatMap((item, index) => [...runeList(project(item, index, this.items))])${t(' as U[]')});
  }
${t('  filter<S extends T>(predicate: (item: T, index: number, array: T[]) => item is S): RuneArray<S>;\n  filter(predicate: (item: T, index: number, array: T[]) => unknown): RuneArray<T>;\n')}  filter(predicate${t(': (item: T, index: number, array: T[]) => unknown')}) { return runeArray(this.items.filter(predicate)); }
  every(predicate${t(': (item: T, index: number, array: T[]) => unknown')}) { return this.items.length > 0 && this.items.every(predicate); }
  some(predicate${t(': (item: T, index: number, array: T[]) => unknown')}) { return this.items.some(predicate); }
${t('  first(): 0 extends Min ? T | undefined : T;\n')}  first()${t(': T | undefined')} { return this.items[0]; }
${t('  last(): 0 extends Min ? T | undefined : T;\n')}  last()${t(': T | undefined')} { return this.items[this.items.length - 1]; }
  count() { return this.items.length; }
  sum(${t('this: RuneList<number, Min, Max>')}) { return this.items.reduce((total, item) => total + item, 0); }
  onlyElement() { return this.items.length === 1 ? this.items[0] : undefined; }
  distinct() { return runeArray(runeDistinct(this.items)); }
  reverse() { return runeArray([...this.items].reverse()); }
  flat${t('<Depth extends number = 1>')}(depth${t('?: Depth')}) {
    return runeArray(this.items.flat(depth));
  }
  sort${t('<K = T>')}(...args${t(': RuneKeyArguments<T, K>')}) {
    const [key, compare] = args;
    return runeArray([...this.items].sort((a, b) => key === undefined ? runeOrder(a, b, compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0)) : runeOrder(key(a), key(b), compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0))));
  }
  min${t('<K = T>')}(...args${t(': RuneKeyArguments<T, K>')}) {
    const [key, compare] = args;
    const order = (a${t(': T')}, b${t(': T')}) => key === undefined ? runeOrder(a, b, compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0)) : runeOrder(key(a), key(b), compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0));
    return this.items.reduce${t('<T | undefined>')}((best, item) => best === undefined || order(item, best) < 0 ? item : best, undefined);
  }
  max${t('<K = T>')}(...args${t(': RuneKeyArguments<T, K>')}) {
    const [key, compare] = args;
    const order = (a${t(': T')}, b${t(': T')}) => key === undefined ? runeOrder(a, b, compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0), false) : runeOrder(key(a), key(b), compare ?? ((a, b) => a < b ? -1 : a > b ? 1 : 0), false);
    return this.items.reduce${t('<T | undefined>')}((best, item) => best === undefined || order(item, best) > 0 ? item : best, undefined);
  }
${t('  reduce(reduce: (previous: T, current: T, index: number, array: T[]) => T): T | undefined;\n  reduce<U>(reduce: (previous: U, current: T, index: number, array: T[]) => U, initialValue: U): U;\n')}  reduce(...args${t(': unknown[]')})${t(': unknown')} { return this.items.length || args.length > 1 ? Reflect.apply(Array.prototype.reduce, this.items, args) : undefined; }
  join(separator = '') { return this.items.join(separator); }
  has(value${t(': unknown')}) { return runeContains(this.items, [value]); }
  isSupersetOf(values${t(': unknown')}) { return runeContains(this.items, values instanceof RuneList ? values.items : values); }
  isDisjointFrom(values${t(': unknown')}) { return runeDisjoint(this.items, values instanceof RuneList ? values.items : values); }
}
${t(`${prefix}function runeArray<T>(items: readonly T[]): RuneArray<T>;\n`)}${prefix}function runeArray(items${t(': readonly unknown[]')}) { return new RuneList(items); }
${prefix}const runeExtract = ${t('<T, U>')}(value${t(': T')}, project${t(': (value: NonNullable<T>) => U')})${t(': U | undefined')} => value == null ? undefined : project(value);
${prefix}const runeFilter = ${t('<T>')}(value${t(': T')}, predicate${t(': (value: NonNullable<T>) => boolean')})${t(': T | undefined')} => value != null && predicate(value) ? value : undefined;`;
}
