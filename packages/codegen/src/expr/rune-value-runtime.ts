// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { DEEP_RUNTIME_SOURCE } from './generated/deep-runtime-source.js';

export const RUNE_VALUE_IMPORTS = [
  'runeValue',
  'type RuneValueSelection',
  'type RuneValueType',
  'type RuneEmptyType',
  'type RunePayload',
  'type RuneInputPayload',
  'type RuneInput',
  'type RuneView',
  'type RuneInputMin',
  'type RuneInputMax',
  'type RuneFactoryInput',
  'type RuneFromMin',
  'type RuneFromMax'
] as const;
export const RUNE_VALUE_NAMES = [
  'Reflect',
  'Proxy',
  'RuneValue',
  'RuneTuple',
  'RuneProduct',
  'RuneValueStep',
  'RuneSelected',
  'RuneDeepView',
  'RuneMinProduct',
  'RuneMaxProduct',
  'runeDeepPaths',
  'runeValueBounds',
  'runeValueProduct',
  'runeValueOrder',
  'RuneMapMin',
  'RuneFirstMin',
  'RuneBounded',
  'RuneReadonly',
  'RuneValueLike',
  'runeValueProtocol',
  'runeValueInput',
  'runeValueMaterialize',
  'runeValueType',
  ...RUNE_VALUE_IMPORTS.map((name) => name.replace(/^type /, ''))
];

/** One descriptor-driven value runtime for generated public TypeScript views. */
export function runeValueRuntimeSource(exported = false): string {
  const e = exported ? 'export ' : '';
  return `${DEEP_RUNTIME_SOURCE}
${e}type RuneTuple<T, N extends number, A extends T[] = []> = number extends N ? T[] : A['length'] extends N ? A : A['length'] extends 32 ? T[] : RuneTuple<T, N, [...A, T]>;
type RuneReadonly<T> = T extends readonly unknown[] ? Readonly<T> : T;
${e}type RuneBounded<T, Min extends number, Max extends number, A extends T[] = RuneTuple<T, Min>, Result = never> = number extends A['length'] ? T | T[] | undefined : A['length'] extends Max ? Result | (A['length'] extends 0 ? undefined : A['length'] extends 1 ? T : A) : A['length'] extends 32 ? T | T[] | undefined : RuneBounded<T, Min, Max, [...A, T], Result | (A['length'] extends 0 ? undefined : A['length'] extends 1 ? T : A)>;
${e}type RunePayload<T, Min extends number, Max extends number | null> = Max extends 0 ? undefined : Max extends 1 ? 0 extends Min ? T | undefined : T : Max extends number ? number extends Max ? T | T[] | undefined : RuneBounded<T, Min, Max> : 0 extends Min ? T | [T, ...T[]] | undefined : Min extends 1 ? T | [T, ...T[]] : [...RuneTuple<T, Min>, ...T[]];
${e}type RuneInputPayload<T, Min extends number, Max extends number | null> = Max extends number ? RuneReadonly<RunePayload<T, Min, Max>> : Min extends 0 ? T | readonly T[] | undefined : Min extends 1 ? T | readonly [T, ...T[]] : readonly [...RuneTuple<T, Min>, ...T[]];
${e}type RuneInput<T> = T | readonly T[] | null | undefined;
${e}type RuneInputMin<I> = undefined extends I ? 0 : null extends I ? 0 : I extends readonly unknown[] ? number extends I['length'] ? 0 : I['length'] : 1;
${e}type RuneInputMax<I> = I extends readonly unknown[] ? number extends I['length'] ? null : I['length'] : I extends null | undefined ? 0 : 1;
interface RuneValueLike<T, Min extends number, Max extends number | null> { readonly $rune$cardinality?: readonly [T, Min, Max]; toArray(): readonly T[]; unwrap(): RunePayload<T, Min, Max>; }
${e}type RuneFactoryInput<I, T, Output = T> = unknown extends I ? unknown : I extends string ? string : I extends RuneValueLike<infer U, number, number | null> ? U extends Output ? I : never : RuneInput<T>;
${e}type RuneFromMin<I> = unknown extends I ? 0 : I extends string ? 0 : I extends RuneValueLike<unknown, infer L, number | null> ? L : RuneInputMin<I>;
${e}type RuneFromMax<I> = unknown extends I ? null : I extends string ? null : I extends RuneValueLike<unknown, number, infer U> ? U : RuneInputMax<I>;
type RuneProduct<A extends number, B extends number, R extends unknown[] = [], N extends unknown[] = []> = number extends A | B ? number : N['length'] extends A ? R['length'] : N['length'] extends 32 ? number : RuneProduct<A, B, [...R, ...RuneTuple<unknown, B>], [...N, unknown]>;
type RuneMapMin<Min extends number, U> = undefined extends U ? 0 : null extends U ? 0 : Min;
type RuneFirstMin<Min extends number> = 0 extends Min ? 0 : 1;
${e}type RuneMinProduct<A extends number, B extends number> = A extends 0 ? 0 : B extends 0 ? 0 : RuneProduct<A, B>;
${e}type RuneMaxProduct<A extends number | null, B extends number | null> = A extends 0 ? 0 : B extends 0 ? 0 : A extends number ? B extends number ? RuneProduct<A, B> : null : null;
interface RuneValueStep { key: string; min: number; max: number | null; metadata?: boolean; wireMin?: number; wireMax?: number | null; read?: (value: unknown) => unknown; }
${e}interface RuneValueSelection<T = unknown, Min extends number = number, Max extends number | null = number | null, Model = RuneEmptyType> {
  readonly input?: T;
  readonly min: Min;
  readonly max: Max;
  readonly id: string;
  readonly key: string;
  readonly metadata?: boolean;
  readonly wireMin?: number;
  readonly wireMax?: number | null;
  readonly read?: (value: unknown) => unknown;
  readonly check?: (value: unknown) => boolean;
  readonly paths?: readonly (readonly RuneValueStep[])[];
  readonly type?: () => Model;
}
${e}interface RuneValueType<T = unknown, Output = T> {
  readonly input?: T;
  readonly output?: Output;
  readonly create?: (value: unknown) => Output;
  readonly native?: boolean;
  readonly choice?: readonly string[];
  readonly fields: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
  readonly deep: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
  readonly selections: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
}
${e}interface RuneEmptyType extends RuneValueType { fields: {}; deep: {}; selections: {}; }
type RuneSelected<S, Min extends number, Max extends number | null> = S extends RuneValueSelection<infer T, infer L, infer U, infer Model> ? RuneView<T, RuneMinProduct<Min, L>, RuneMaxProduct<Max, U>, Model extends RuneValueType ? Model : RuneEmptyType> : never;
${e}type RuneDeepView<Model extends RuneValueType, Min extends number, Max extends number | null> = { readonly [K in keyof Model['deep']]: RuneSelected<Model['deep'][K], Min, Max> };
${e}type RuneView<T, Min extends number, Max extends number | null, Model extends RuneValueType = RuneEmptyType> = RuneValue<T, Min, Max, Model> & { readonly [K in Exclude<keyof Model['fields'], keyof RuneValue<T, Min, Max, Model>>]: RuneSelected<Model['fields'][K], Min, Max> };
// Erase only the descriptor getter at the runtime boundary; field types remain exact in RuneSelected.
const runeValueType = (field: RuneValueSelection<unknown, number, number | null, unknown>): (() => RuneValueType) | undefined => field.type as (() => RuneValueType) | undefined;
const runeValueBounds = (count: number, min: number, max: number | null, label: string) => {
  if (count < min || (max !== null && count > max)) throw new Error(label + ': expected ' + min + '..' + (max ?? '*') + ' values, received ' + count);
};
const runeValueProduct = (a: number | null, b: number | null): number | null => a === 0 || b === 0 ? 0 : a === null || b === null ? null : a * b;
const runeValueProtocol = Symbol.for('rune-langium.value.items');
const runeValueInput = (value: unknown): unknown => value != null && typeof value === 'object' && typeof Reflect.get(value, runeValueProtocol) === 'function' ? Reflect.apply(Reflect.get(value, runeValueProtocol), value, []) : value;
const runeValueMaterialize = (value: unknown, model: RuneValueType, seen = new WeakMap<object, Map<RuneValueType, unknown>>()): unknown => {
  if (model.native) return model.create ? model.create(value) : value;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a Rune model object');
  let models = seen.get(value);
  if (models?.has(model)) return models.get(model);
  if (!models) { models = new Map(); seen.set(value, models); }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  models.set(model, result);
  for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
  for (const field of Object.values(model.fields)) {
    const raw = runeValueInput(result[field.key]);
    const values = runeList(raw).filter(item => item != null);
    const min = field.metadata ? field.wireMin ?? 0 : field.min;
    const max = field.metadata ? field.wireMax ?? field.max : field.max;
    runeValueBounds(values.length, min, max, field.key);
    const normalized = values.map(item => {
      if (field.metadata) {
        if (typeof item !== 'object' || item === null) throw new TypeError('Expected a Rune metadata envelope for ' + field.key);
        const envelope = Object.fromEntries(Object.entries(item));
        if (envelope.value != null && field.type) envelope.value = runeValueMaterialize(envelope.value, runeValueType(field)!(), seen);
        if (envelope.value != null && field.check && !field.check(envelope.value)) throw new TypeError('Invalid Rune value for ' + field.key);
        return envelope;
      }
      const output = field.type ? runeValueMaterialize(item, runeValueType(field)!(), seen) : item;
      if (field.check && !field.check(output)) throw new TypeError('Invalid Rune value for ' + field.key);
      return output;
    });
    result[field.key] = max !== null && max <= 1 ? normalized[0] : raw == null ? undefined : normalized;
  }
  const output = model.create ? model.create(result) : result;
  if (output !== result && output != null && typeof output === 'object') {
    Object.setPrototypeOf(result, Object.getPrototypeOf(output));
    for (const [key, item] of Object.entries(output)) Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return result;
};
const runeValueOrder = (left: unknown, right: unknown): number => {
  if (typeof left === 'number' && typeof right === 'number' || typeof left === 'string' && typeof right === 'string' || typeof left === 'boolean' && typeof right === 'boolean') return left < right ? -1 : left > right ? 1 : 0;
  switch (Object.prototype.toString.call(left)) {
    case '[object Temporal.PlainDate]': return Temporal.PlainDate.compare(left as Temporal.PlainDate, right as Temporal.PlainDate);
    case '[object Temporal.PlainTime]': return Temporal.PlainTime.compare(left as Temporal.PlainTime, right as Temporal.PlainTime);
    case '[object Temporal.PlainDateTime]': return Temporal.PlainDateTime.compare(left as Temporal.PlainDateTime, right as Temporal.PlainDateTime);
    case '[object Temporal.ZonedDateTime]': return Temporal.ZonedDateTime.compare(left as Temporal.ZonedDateTime, right as Temporal.ZonedDateTime);
  }
  throw new TypeError('Rune ordering requires comparable values or a key selector');
};
${e}class RuneValue<T, Min extends number = 0, Max extends number | null = null, Model extends RuneValueType = RuneEmptyType> implements Iterable<T> {
  declare readonly $rune$cardinality?: readonly [T, Min, Max];
  private readonly $list: RuneList<T>;
  private $deep?: RuneDeepView<Model, Min, Max>;
  constructor(items: readonly T[], private readonly $type: (() => Model) | undefined, private readonly $min: Min, private readonly $max: Max) {
    this.$list = new RuneList(items);
    runeValueBounds(this.$list.count(), $min, $max, 'Rune value');
    const choice = $type?.().choice;
    if (choice) for (const item of this.$list) {
      const count = choice.filter(key => item != null && typeof item === 'object' && runeCount((item as Record<string, unknown>)[key]) > 0).length;
      if (count !== 1) throw new Error('Rune Choice: expected exactly one selected option');
    }
    return new Proxy(this, { get: (target, key) => {
      if (key in target || typeof key === 'symbol') {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      if (typeof key === 'string' && Object.hasOwn(target.$type?.().fields ?? {}, key)) return target.field(key as keyof Model['fields']);
      return undefined;
    }});
  }
  [Symbol.iterator]() { return this.$list[Symbol.iterator](); }
  [runeValueProtocol]() { return this.$list.toArray(); }
  count() { return this.$list.count(); }
  exists() { return this.count() > 0; }
  unwrap(): RunePayload<T, Min, Max> { const values = this.$list.toArray(); return (values.length === 0 ? undefined : values.length === 1 ? values[0] : values) as RunePayload<T, Min, Max>; }
  toArray(): 0 extends Min ? T[] : [T, ...T[]] { return this.$list.toArray() as 0 extends Min ? T[] : [T, ...T[]]; }
  toJSON() { return runeToFuncData(this.unwrap()); }
  first(): RuneView<T, RuneFirstMin<Min>, 1, Model> { const value = this.$list.first(); return new RuneValue<T, RuneFirstMin<Min>, 1, Model>(value == null ? [] : [value], this.$type, (this.$min > 0 ? 1 : 0) as RuneFirstMin<Min>, 1) as RuneView<T, RuneFirstMin<Min>, 1, Model>; }
  last(): RuneView<T, RuneFirstMin<Min>, 1, Model> { const value = this.$list.last(); return new RuneValue<T, RuneFirstMin<Min>, 1, Model>(value == null ? [] : [value], this.$type, (this.$min > 0 ? 1 : 0) as RuneFirstMin<Min>, 1) as RuneView<T, RuneFirstMin<Min>, 1, Model>; }
  onlyElement(): RuneView<T, 0, 1, Model> { const value = this.$list.onlyElement(); return new RuneValue(value == null ? [] : [value], this.$type, 0, 1) as RuneView<T, 0, 1, Model>; }
  map<U>(project: (item: T, index: number) => U): RuneView<NonNullable<U>, RuneMapMin<Min, U>, Max> { const values = this.$list.map(project).toArray(); return new RuneValue(values, undefined, values.length === this.count() ? this.$min : 0, this.$max) as RuneView<NonNullable<U>, RuneMapMin<Min, U>, Max>; }
  flatMap<U>(project: (item: T, index: number) => U | readonly U[] | null | undefined): RuneView<U, 0, null> { return new RuneValue(this.$list.flatMap(project).toArray(), undefined, 0, null) as RuneView<U, 0, null>; }
  flat<U>(this: RuneValue<U | readonly U[], Min, Max, Model>): RuneView<U, 0, null> { return new RuneValue(this.$list.flat<U>().toArray(), undefined, 0, null) as RuneView<U, 0, null>; }
  filter(predicate: (item: T, index: number) => boolean): RuneView<T, 0, Max, Model> { return new RuneValue(this.$list.filter(predicate).toArray(), this.$type, 0, this.$max) as RuneView<T, 0, Max, Model>; }
  reverse(): RuneView<T, Min, Max, Model> { return new RuneValue(this.$list.reverse().toArray(), this.$type, this.$min, this.$max) as RuneView<T, Min, Max, Model>; }
  distinct(): RuneView<T, 0, Max, Model> { return new RuneValue(this.$list.distinct().toArray(), this.$type, 0, this.$max) as RuneView<T, 0, Max, Model>; }
  sort<K = T>(key: (item: T) => K = item => item as unknown as K, compare?: (a: NonNullable<K>, b: NonNullable<K>) => number): RuneView<T, Min, Max, Model> { return new RuneValue(this.$list.sort(key, compare ?? runeValueOrder).toArray(), this.$type, this.$min, this.$max) as RuneView<T, Min, Max, Model>; }
  min<K = T>(key: (item: T) => K = item => item as unknown as K, compare?: (a: NonNullable<K>, b: NonNullable<K>) => number): RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model> { const value = this.$list.min(key, compare ?? runeValueOrder); return new RuneValue<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>(value == null ? [] : [value], this.$type, (value == null ? 0 : this.$min > 0 ? 1 : 0) as RuneFirstMin<RuneMapMin<Min, K>>, 1) as RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>; }
  max<K = T>(key: (item: T) => K = item => item as unknown as K, compare?: (a: NonNullable<K>, b: NonNullable<K>) => number): RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model> { const value = this.$list.max(key, compare ?? runeValueOrder); return new RuneValue<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>(value == null ? [] : [value], this.$type, (value == null ? 0 : this.$min > 0 ? 1 : 0) as RuneFirstMin<RuneMapMin<Min, K>>, 1) as RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>; }
  sum(this: RuneValue<number, Min, Max, Model>) { return this.$list.sum(); }
  every(predicate: (item: T, index: number) => boolean) { return this.exists() && this.$list.toArray().every(predicate); }
  some(predicate: (item: T, index: number) => boolean) { return this.$list.toArray().some(predicate); }
  reduce(reduce: (previous: T, current: T) => T) { return this.$list.reduce(reduce); }
  join(separator = '') { return this.$list.join(separator); }
  has(value: unknown) { const normalized = runeValueInput(value); return this.$list.has(normalized !== value && Array.isArray(normalized) && normalized.length === 1 ? normalized[0] : normalized); }
  isSupersetOf(values: unknown) { return this.$list.isSupersetOf(runeValueInput(values)); }
  isDisjointFrom(values: unknown) { return this.$list.isDisjointFrom(runeValueInput(values)); }
  field<K extends keyof Model['fields']>(name: K): RuneSelected<Model['fields'][K], Min, Max> { return this.$read(this.$type?.().fields[String(name)], String(name)) as unknown as RuneSelected<Model['fields'][K], Min, Max>; }
  select<K extends keyof Model['selections']>(identity: K): RuneSelected<Model['selections'][K], Min, Max> { return this.$read(this.$type?.().selections[String(identity)], String(identity)) as unknown as RuneSelected<Model['selections'][K], Min, Max>; }
  get _(): RuneDeepView<Model, Min, Max> {
    return this.$deep ??= new Proxy(Object.create(null) as RuneDeepView<Model, Min, Max>, { get: (_target, name) => typeof name === 'string' ? this.$read(this.$type?.().deep[name], name) : undefined });
  }
  private $read(selection: RuneValueSelection<unknown, number, number | null, unknown> | undefined, name: string): RuneValue<unknown, number, number | null, RuneValueType> {
    if (!selection || typeof selection !== 'object' || typeof selection.id !== 'string') throw new Error('Unknown or ambiguous Rune property: ' + name);
    const output: unknown[] = [];
    const paths = selection.paths ?? runeDeepPaths<RuneValueType, RuneValueSelection<unknown, number, number | null, unknown>>(
      this.$type?.(), type => Object.values(type.fields), field => runeValueType(field)?.(), field => field.id === selection.id, field => field.key
    );
    for (const path of paths) {
      let values: unknown[] = this.$list.toArray();
      for (const step of path) {
        const next: unknown[] = [];
        for (const parent of values) {
          const raw = step.read ? step.read(parent) : parent != null && typeof parent === 'object' && step.key in parent ? (parent as Record<string, unknown>)[step.key] : undefined;
          if (step.metadata) runeValueBounds(runeList(raw).filter(value => value != null).length, step.wireMin ?? 0, step.wireMax ?? step.max, step.key);
          const children = runeList(raw).flatMap(value => step.metadata ? runeList(value != null && typeof value === 'object' ? (value as Record<string, unknown>).value : undefined) : [value]).filter(value => value != null);
          runeValueBounds(children.length, step.min, step.max, step.key);
          for (const child of children) next.push(child);
        }
        values = next;
      }
      for (const value of values) output.push(value);
    }
    return new RuneValue(output, runeValueType(selection), this.$min * selection.min, runeValueProduct(this.$max, selection.max));
  }
}
${e}const runeValue = <Model extends RuneValueType>(input: unknown, type: () => Model): RuneView<NonNullable<Model['output']>, number, number | null, Model> => {
  const raw = typeof input === 'string' ? JSON.parse(input) as unknown : runeValueInput(input);
  const values = runeList(raw).map(value => runeValueMaterialize(value, type()));
  return new RuneValue(values, type, values.length, values.length) as unknown as RuneView<NonNullable<Model['output']>, number, number | null, Model>;
};`;
}
