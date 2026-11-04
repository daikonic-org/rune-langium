// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { DEEP_RUNTIME_SOURCE } from './generated/deep-runtime-source.js';
import { RUNE_JSON_RUNTIME_SOURCE } from './generated/rune-json-runtime-source.js';
import { runeObjectRuntimeSource } from './rune-object-runtime.js';

export const RUNE_VALUE_IMPORTS = [
  'RuneObject',
  'is',
  'runeModel',
  'type RuneModel',
  'type RuneModelTag',
  'type RuneGuarded',
  'runeValue',
  'runeValueJSON',
  'runeValueFromJSON',
  'runeRegisterValueType',
  'type RuneJsonOptions',
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
  'runeObjectType',
  'RuneModelOwner',
  'RuneObjectConstructor',
  'RuneTypeGuard',
  'RuneSerializationCodec',
  'RuneChoice',
  'runeObjectDefinition',
  'runeObjectInstanceModel',
  'runeObjectShape',
  'runeObjectMatches',
  '__descriptor',
  '__selections',
  '__deep',
  'globalThis',
  'Reflect',
  'Proxy',
  'RuneValue',
  'RuneKeyArguments',
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
  'runeValueConcreteType',
  'runeValueMatchingType',
  'runeJson',
  ...RUNE_VALUE_IMPORTS.map((name) => name.replace(/^type /, ''))
];

/** One descriptor-driven value runtime for generated public TypeScript views. */
export function runeValueRuntimeSource(exported = false): string {
  const e = exported ? 'export ' : '';
  return `${DEEP_RUNTIME_SOURCE}
const runeJson = (() => { ${RUNE_JSON_RUNTIME_SOURCE}
return { decode: decodeRuneJson, encode: encodeRuneJson, context: withRuneJsonEncoding, normalizeChoiceWrapper: normalizeRuneJsonChoiceWrapper, projectChoice: projectRuneJsonChoice, pattern: serializeRunePattern, assignable: isRuneJsonAssignableType, acceptsChoice: acceptsRuneJsonChoice, selectChoice: selectRuneJsonChoiceCandidates }; })();
${e}type RuneJsonOptions = { format?: 'JSON' | 'RUNE_JSON' };
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
  readonly identity?: string;
  readonly kind?: 'choice';
  readonly metadata?: boolean;
  readonly input?: T;
  readonly output?: Output;
  readonly shape?: unknown;
  readonly codec?: () => RuneSerializationCodec;
  readonly create?: (value: unknown) => Output;
  readonly native?: boolean;
  readonly prototype?: object;
  readonly parent?: () => RuneValueType;
  readonly derived?: Map<string, RuneValueType>;
  readonly choice?: readonly string[];
  readonly fields: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
  readonly deep: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
  readonly selections: Readonly<Record<string, RuneValueSelection<unknown, number, number | null, unknown>>>;
}
${e}interface RuneEmptyType extends RuneValueType { fields: {}; deep: {}; selections: {}; }
${e}const runeRegisterValueType = <T extends RuneValueType>(type: T): T => {
  const seen = new Set<RuneValueType>();
  for (let parent = type.parent?.(); parent && !seen.has(parent); parent = parent.parent?.()) {
    seen.add(parent);
    if (type.identity) {
      const existing = parent.derived?.get(type.identity);
      if (existing && existing !== type) throw new TypeError('Ambiguous Rune type: ' + type.identity);
      parent.derived?.set(type.identity, type);
    }
  }
  return type;
};
const runeValueMatchingType = (identity: unknown, model: RuneValueType): RuneValueType | undefined => {
  const actual = identity === model.identity ? model : typeof identity === 'string' ? model.derived?.get(identity) : undefined;
  return actual && runeJson.assignable(actual, model, type => type.parent?.()) ? actual : undefined;
};
const runeValueConcreteType = (value: unknown, model: RuneValueType): RuneValueType => {
  if (model.native || model.kind === 'choice' || !value || typeof value !== 'object') return model;
  if (!('@type' in value) || value['@type'] === undefined) {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === model.prototype) return model;
    return [...(model.derived?.values() ?? [])].find(type => type.prototype === prototype) ?? model;
  }
  const actual = runeValueMatchingType(value['@type'], model);
  if (!actual) throw new TypeError('Rune JSON type is not assignable to ' + model.identity);
  return actual;
};
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
  model = runeValueConcreteType(value, model);
  if (model.native) return model.create ? model.create(value) : value;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a Rune model object');
  let models = seen.get(value);
  if (models?.has(model)) return models.get(model);
  if (!models) { models = new Map(); seen.set(value, models); }
  const result: Record<string, unknown> = Object.create(null);
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
  if (left instanceof Temporal.PlainDate && right instanceof Temporal.PlainDate) return Temporal.PlainDate.compare(left, right);
  if (left instanceof Temporal.PlainTime && right instanceof Temporal.PlainTime) return Temporal.PlainTime.compare(left, right);
  if (left instanceof Temporal.PlainDateTime && right instanceof Temporal.PlainDateTime) return Temporal.PlainDateTime.compare(left, right);
  if (left instanceof Temporal.ZonedDateTime && right instanceof Temporal.ZonedDateTime) return Temporal.ZonedDateTime.compare(left, right);
  if (Object.prototype.toString.call(left) === '[object Temporal.PlainDate]' && Object.prototype.toString.call(right) === '[object Temporal.PlainDate]') return Temporal.PlainDate.compare(Temporal.PlainDate.from(String(left)), Temporal.PlainDate.from(String(right)));
  if (Object.prototype.toString.call(left) === '[object Temporal.PlainTime]' && Object.prototype.toString.call(right) === '[object Temporal.PlainTime]') return Temporal.PlainTime.compare(Temporal.PlainTime.from(String(left)), Temporal.PlainTime.from(String(right)));
  if (Object.prototype.toString.call(left) === '[object Temporal.PlainDateTime]' && Object.prototype.toString.call(right) === '[object Temporal.PlainDateTime]') return Temporal.PlainDateTime.compare(Temporal.PlainDateTime.from(String(left)), Temporal.PlainDateTime.from(String(right)));
  if (Object.prototype.toString.call(left) === '[object Temporal.ZonedDateTime]' && Object.prototype.toString.call(right) === '[object Temporal.ZonedDateTime]') return Temporal.ZonedDateTime.compare(Temporal.ZonedDateTime.from(String(left)), Temporal.ZonedDateTime.from(String(right)));
  throw new TypeError('Rune ordering requires comparable values or a key selector');
};
${e}class RuneValue<T, Min extends number = 0, Max extends number | null = null, Model extends RuneValueType = RuneEmptyType> implements Iterable<T> {
  declare readonly $rune$cardinality?: readonly [T, Min, Max];
  private readonly $list: RuneList<T>;
  private readonly $type: (() => Model) | undefined;
  private readonly $min: Min;
  private readonly $max: Max;
  private $deep?: RuneDeepView<Model, Min, Max>;
  constructor(items: readonly T[], $type: (() => Model) | undefined, $min: Min, $max: Max) {
    this.$type = $type;
    this.$min = $min;
    this.$max = $max;
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
  toJSON(options?: RuneJsonOptions | string): unknown { return this.$type ? runeValueJSON(this.unwrap(), this.$type, options) : runeToFuncData(this.unwrap()); }
  first(): RuneView<T, RuneFirstMin<Min>, 1, Model> { const value = this.$list.first(); return new RuneValue<T, RuneFirstMin<Min>, 1, Model>(value == null ? [] : [value], this.$type, (this.$min > 0 ? 1 : 0) as RuneFirstMin<Min>, 1) as RuneView<T, RuneFirstMin<Min>, 1, Model>; }
  last(): RuneView<T, RuneFirstMin<Min>, 1, Model> { const value = this.$list.last(); return new RuneValue<T, RuneFirstMin<Min>, 1, Model>(value == null ? [] : [value], this.$type, (this.$min > 0 ? 1 : 0) as RuneFirstMin<Min>, 1) as RuneView<T, RuneFirstMin<Min>, 1, Model>; }
  onlyElement(): RuneView<T, 0, 1, Model> { const value = this.$list.onlyElement(); return new RuneValue(value == null ? [] : [value], this.$type, 0, 1) as RuneView<T, 0, 1, Model>; }
  map<U>(project: (item: T, index: number) => U): RuneView<NonNullable<U>, RuneMapMin<Min, U>, Max> { const values = this.$list.map(project).toArray(); return new RuneValue(values, undefined, values.length === this.count() ? this.$min : 0, this.$max) as RuneView<NonNullable<U>, RuneMapMin<Min, U>, Max>; }
  flatMap<U>(project: (item: T, index: number) => U | readonly U[] | null | undefined): RuneView<U, 0, null> { return new RuneValue(this.$list.flatMap(project).toArray(), undefined, 0, null) as RuneView<U, 0, null>; }
  flat<U>(this: RuneValue<U | readonly U[], Min, Max, Model>): RuneView<U, 0, null> { return new RuneValue(this.$list.flat<U>().toArray(), undefined, 0, null) as RuneView<U, 0, null>; }
  filter(predicate: (item: T, index: number) => boolean): RuneView<T, 0, Max, Model> { return new RuneValue(this.$list.filter(predicate).toArray(), this.$type, 0, this.$max) as RuneView<T, 0, Max, Model>; }
  reverse(): RuneView<T, Min, Max, Model> { return new RuneValue(this.$list.reverse().toArray(), this.$type, this.$min, this.$max) as RuneView<T, Min, Max, Model>; }
  distinct(): RuneView<T, 0, Max, Model> { return new RuneValue(this.$list.distinct().toArray(), this.$type, 0, this.$max) as RuneView<T, 0, Max, Model>; }
  sort<K = T>(...args: RuneKeyArguments<T, K>): RuneView<T, Min, Max, Model> { return new RuneValue(this.$list.sort(...(args[0] === undefined ? [undefined, args[1] ?? runeValueOrder] : [args[0], args[1] ?? runeValueOrder])).toArray(), this.$type, this.$min, this.$max) as RuneView<T, Min, Max, Model>; }
  min<K = T>(...args: RuneKeyArguments<T, K>): RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model> { const value = this.$list.min(...(args[0] === undefined ? [undefined, args[1] ?? runeValueOrder] : [args[0], args[1] ?? runeValueOrder])); return new RuneValue<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>(value == null ? [] : [value], this.$type, (value == null ? 0 : this.$min > 0 ? 1 : 0) as RuneFirstMin<RuneMapMin<Min, K>>, 1) as RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>; }
  max<K = T>(...args: RuneKeyArguments<T, K>): RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model> { const value = this.$list.max(...(args[0] === undefined ? [undefined, args[1] ?? runeValueOrder] : [args[0], args[1] ?? runeValueOrder])); return new RuneValue<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>(value == null ? [] : [value], this.$type, (value == null ? 0 : this.$min > 0 ? 1 : 0) as RuneFirstMin<RuneMapMin<Min, K>>, 1) as RuneView<T, RuneFirstMin<RuneMapMin<Min, K>>, 1, Model>; }
  sum(this: RuneValue<number, Min, Max, Model>) { return this.$list.sum(); }
  every(predicate: (item: T, index: number) => boolean) { return this.exists() && this.$list.toArray().every(predicate); }
  some(predicate: (item: T, index: number) => boolean) { return this.$list.toArray().some(predicate); }
  reduce(reduce: (previous: T, current: T) => T) { return this.$list.reduce(reduce); }
  join(separator = '') { return this.$list.join(separator); }
  has(value: unknown) { const normalized = runeValueInput(value); return this.$list.has(normalized !== value && Array.isArray(normalized) && normalized.length === 1 ? normalized[0] : normalized); }
  isSupersetOf(values: unknown) { return this.$list.isSupersetOf(runeValueInput(values)); }
  isDisjointFrom(values: unknown) { return this.$list.isDisjointFrom(runeValueInput(values)); }
  field<K extends keyof Model['fields']>(name: K): RuneSelected<Model['fields'][K], Min, Max> {
    const model = this.$type?.();
    if (!model) throw new Error('Rune value has no model descriptor');
    const selections: Model['fields'] = model.fields;
    return this.$read(selections[name], String(name));
  }
  select<K extends keyof Model['selections']>(identity: K): RuneSelected<Model['selections'][K], Min, Max> {
    const model = this.$type?.();
    if (!model) throw new Error('Rune value has no model descriptor');
    const selections: Model['selections'] = model.selections;
    return this.$read(selections[identity], String(identity));
  }
  get _(): RuneDeepView<Model, Min, Max> {
    return this.$deep ??= new Proxy(Object.create(null) as RuneDeepView<Model, Min, Max>, { get: (_target, name) => typeof name === 'string' ? this.$read(this.$type?.().deep[name], name) : undefined });
  }
  private $matches<S extends RuneValueSelection<unknown, number, number | null, unknown>>(value: unknown, selection: S): value is RuneSelected<S, Min, Max> {
    return value instanceof RuneValue
      && value.$min === this.$min * selection.min
      && value.$max === runeValueProduct(this.$max, selection.max)
      && value.$type?.() === runeValueType(selection)?.();
  }
  private $read<S extends RuneValueSelection<unknown, number, number | null, unknown>>(selection: S | undefined, name: string): RuneSelected<S, Min, Max> {
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
      for (const value of values) {
      if (selection.check && !selection.check(value)) throw new TypeError('Invalid Rune value for ' + name);
      output.push(value);
    }
    }
    const value = new RuneValue(output, runeValueType(selection), this.$min * selection.min, runeValueProduct(this.$max, selection.max));
    if (!this.$matches(value, selection)) throw new TypeError('Rune selection does not match its descriptor: ' + name);
    return value;
  }
}
${e}function runeValue<I, Model extends RuneValueType>(input: I, type: () => Model): RuneView<NonNullable<Model['output']>, RuneFromMin<I>, RuneFromMax<I>, Model>;
${e}function runeValue(input: unknown, type: () => RuneValueType): RuneValue<unknown, number, number | null, RuneValueType> {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : runeValueInput(input);
  const values = runeList(raw).map(value => runeValueMaterialize(value, type()));
  return new RuneValue(values, type, values.length, values.length);
}
${e}const runeValueJSON = (input: unknown, type: () => RuneValueType, options?: RuneJsonOptions | string): unknown => {
  const runeFormat = typeof options === 'object' && options?.format === 'RUNE_JSON';
  const active = new WeakSet<object>();
  let codecProjection = false;
  const visit = (value: unknown, declaredModel?: RuneValueType): unknown => {
    if (value == null || typeof value !== 'object') return value;
    if (value instanceof RegExp) return codecProjection ? value : runeJson.pattern(value);
    if (/^\\[object Temporal\\./.test(Object.prototype.toString.call(value))) return runeFormat && !codecProjection ? String(value) : value;
    if (active.has(value)) throw new TypeError('Cannot serialize a cyclic Rune value');
    const model = declaredModel && runeValueConcreteType(value, declaredModel);
    active.add(value);
    try {
      if (Array.isArray(value)) return value.map(item => visit(item, model));
      const result = Object.fromEntries(Object.entries(value).filter(([key, item]) => typeof item !== 'function' && !Object.hasOwn(model?.fields ?? {}, key)).map(([key, item]) => [key, visit(item)]));
      for (const field of Object.values(model?.fields ?? {})) {
        const raw = (value as Record<string, unknown>)[field.key];
        const item = (child: unknown): unknown => {
          if (!field.metadata || child == null) return visit(child, runeValueType(field)?.());
          if (typeof child !== 'object' || Array.isArray(child)) throw new TypeError('Expected a Rune metadata envelope');
          const envelope = Object.fromEntries(Object.entries(child));
          if (Object.hasOwn(envelope, 'value')) envelope.value = visit(envelope.value, runeValueType(field)?.());
          return runeJson.context(envelope, 'envelope');
        };
        if (Object.hasOwn(value, field.key)) result[field.key] = Array.isArray(raw) ? raw.map(item) : item(raw);
      }
      if (model?.kind === 'choice' && model.choice) {
        if (codecProjection) return result;
        return runeJson.projectChoice(result, model.identity, model.choice, (_arm, value) => value);
      }
      if (!model) return result;
      result['@type'] = model.identity;
      return runeJson.context(result, model.metadata ? 'data-metadata' : 'data');
    } finally { active.delete(value); }
  };
  const encode = (value: unknown): unknown => {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(encode);
    const model = runeValueConcreteType(value, type());
    const codec = model.codec?.();
    if (!codec) return value;
    codecProjection = true;
    try { return codec.encode(runeFormat ? visit(value, model) : value); }
    finally { codecProjection = false; }
  };
  const encoded = encode(input);
  return runeFormat ? runeJson.encode(visit(encoded, type())) : visit(encoded);
};
${e}const runeValueFromJSON = (input: unknown, type: () => RuneValueType, options: RuneJsonOptions = {}): unknown => {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  const decode = (value: unknown): unknown => {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(decode);
    return runeValueConcreteType(value, type()).codec?.().decode(value) ?? value;
  };
  if (options.format !== 'RUNE_JSON') return decode(parsed);
  const visit = (value: unknown, declaredModel?: RuneValueType): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item, declaredModel));
    if (!value || typeof value !== 'object' || !declaredModel) return value;
    const model = runeValueConcreteType(value, declaredModel);
    const record = value as Record<string, unknown>;
    if (model.kind === 'choice' && model.choice) {
      const wrapped = runeJson.normalizeChoiceWrapper(value, model.identity, payload => visit(payload, model));
      if (wrapped) return wrapped;
    }
    if (model.kind === 'choice' && model.choice && typeof record['@type'] === 'string') {
      const candidates = model.choice.filter(key => {
        const option = runeValueType(model.fields[key]!)?.();
        return option && runeJson.acceptsChoice(option,
          type => runeValueMatchingType(record['@type'], type) !== undefined,
          type => type.kind === 'choice' ? (type.choice ?? []).flatMap(key => {
            const target = type.fields[key] && runeValueType(type.fields[key])?.();
            return target ? [target] : [];
          }) : undefined);
      });
      const selected = runeJson.selectChoice(candidates,
        key => runeValueType(model.fields[key]!)?.().identity === record['@type'],
        key => runeValueType(model.fields[key]!)?.().kind !== 'choice');
      if (selected.length !== 1) throw new TypeError('Rune JSON type does not select exactly one Choice option');
      return { [selected[0]!]: visit(value, runeValueType(model.fields[selected[0]!]!)?.()) };
    }
    const result = Object.fromEntries(Object.entries(record));
    for (const field of Object.values(model.fields)) {
      const item = (child: unknown): unknown => field.metadata && child && typeof child === 'object' && !Array.isArray(child)
        ? { ...child, value: visit((child as Record<string, unknown>).value, runeValueType(field)?.()) }
        : visit(child, runeValueType(field)?.());
      if (Object.hasOwn(result, field.key)) result[field.key] = Array.isArray(result[field.key]) ? (result[field.key] as unknown[]).map(item) : item(result[field.key]);
    }
    return result;
  };
  return decode(visit(runeJson.decode(parsed), type()));
};
${runeObjectRuntimeSource(exported)}`;
}
