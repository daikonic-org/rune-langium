// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { runeModelRuntimeSource } from './rune-model-runtime.js';

/** Shared model behavior; generated classes supply only their linked definition. */
export function runeObjectRuntimeSource(exported: boolean): string {
  const e = exported ? 'export ' : '';
  return `
${e}const runeObjectType = Symbol.for('rune-langium.object.definition');
${e}interface RuneModelOwner { readonly [key: symbol]: () => RuneValueType; }
${e}type RuneModel<C extends RuneModelOwner> = ReturnType<C[typeof runeObjectType]>;
${e}type RuneModelTag<P extends RuneModelOwner, M extends RuneValueType> = P[typeof runeObjectType] & (() => M);
type RuneObjectConstructor = RuneModelOwner & (new (...args: never[]) => RuneObject) & globalThis.Pick<typeof RuneObject, 'create'>;
${e}type RuneGuarded<I, C extends RuneObjectConstructor> = I & (I extends RuneObject ? InstanceType<C> : ConstructorParameters<C>[0]);
${e}type RuneTypeGuard<C extends RuneObjectConstructor> = <I>(value: I) => value is RuneGuarded<I, C>;
type RuneShapeChecks = WeakMap<object, Set<RuneValueType>>;
interface RuneSerializationSchema<S> { parse(value: unknown): S; encode(value: S): unknown; }
${e}interface RuneSerializationCodec { decode(value: unknown): unknown; encode(value: unknown, checked?: RuneShapeChecks): unknown; wire?(value: unknown): unknown; validate?(value: unknown, checked?: RuneShapeChecks): unknown; }
${e}class RuneChoice<M extends RuneValueType> {
  readonly [key: symbol]: () => M;
  constructor(model: M) { Object.defineProperty(this, runeObjectType, { value: () => runeRegisterValueType(model) }); }
  from<const I>(input: I & RuneFactoryInput<I, M['input'], NonNullable<M['output']>>): RunePayload<RuneProjected<NonNullable<M['output']>, M>, RuneFromMin<I>, RuneFromMax<I>> { return runeProjected<I, M>(input, () => runeModel(this)); }
  fromJSON<const I>(input: I, options: RuneJsonOptions = {}): RunePayload<RuneProjected<NonNullable<M['output']>, M>, RuneFromMin<I>, RuneFromMax<I>> { return runeProjectedJSON<I, M>(input, () => runeModel(this), options); }
  readonly is = <I>(value: I): value is I & NonNullable<M['shape']> => runeObjectShape(value, runeModel(this));
}
${e}function runeModel<C extends RuneModelOwner>(owner: C): RuneModel<C>;
${e}function runeModel(owner: RuneModelOwner): RuneValueType { return owner[runeObjectType]!(); }
const runeObjectDefinition = (value: unknown): value is RuneValueType => value != null && typeof value === 'object'
  && 'fields' in value && value.fields != null && typeof value.fields === 'object'
  && ['deep', 'selections'].every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof descriptor?.get === 'function' || descriptor?.value != null && typeof descriptor.value === 'object';
  });
const runeObjectInstanceModel = (value: unknown): RuneValueType | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  for (let prototype: object | null = Object.getPrototypeOf(value); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    if (typeof constructor !== 'function') continue;
    const getter: unknown = Object.getOwnPropertyDescriptor(constructor, runeObjectType)?.value;
    if (typeof getter !== 'function') continue;
    const model: unknown = Reflect.apply(getter, constructor, []);
    if (runeObjectDefinition(model)) return model;
  }
  return undefined;
};
${e}function is(value: unknown): value is RuneObject { return runeObjectInstanceModel(value) !== undefined; }
const runeObjectShape = (value: unknown, declared: RuneValueType, seen = new WeakMap<object, Set<RuneValueType>>()): boolean => {
  value = runeObjectRaw(value);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  let model: RuneValueType;
  try { model = runeValueConcreteType(value, declared); } catch { return false; }
  let models = seen.get(value);
  if (models?.has(model)) return true;
  if (!models) { models = new Set(); seen.set(value, models); }
  models.add(model);
  for (const field of Object.values(model.fields)) {
    const raw: unknown = Reflect.get(value, field.key);
    const min = field.metadata ? field.wireMin ?? field.min : field.min;
    const max = field.metadata ? field.wireMax ?? field.max : field.max;
    if (raw === undefined) { if (min > 0) return false; continue; }
    if (raw === null || (max !== null && max <= 1 && Array.isArray(raw))) return false;
    const items: unknown[] = Array.isArray(raw) ? raw : [raw];
    if (items.length < min || (max !== null && items.length > max)) return false;
    for (const item of items) {
      let payload = item;
      if (field.metadata) {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) return false;
        payload = 'value' in item ? item.value : undefined;
        if (payload == null) continue;
      }
      const child = runeValueType(field)?.();
      if (child && !child.native && !runeObjectShape(payload, child, seen)) return false;
      if (field.check && !field.check(payload)) return false;
    }
  }
  return !model.choice || model.choice.filter(key => Reflect.get(value, key) != null).length === 1;
};
const runeObjectMatches = (value: unknown, constructor: RuneObjectConstructor): boolean =>
  is(value) ? value instanceof constructor : runeObjectShape(value, runeModel(constructor));
const runeObjectStorage = Symbol.for('rune-langium.object.storage');
const runeObjectProxies = new WeakMap<object, object>();
const runeObjectConstruction = new WeakMap<object, RuneShapeChecks>();
function runeObjectRaw<T>(value: T): T;
function runeObjectRaw(value: unknown): unknown { return value != null && typeof value === 'object' && !Array.isArray(value) ? Reflect.get(value, runeObjectStorage) ?? value : value; }
function runeObjectProxy<T extends object>(target: T, definition: () => RuneValueType, construction?: object): T {
  const known = runeObjectProxies.get(target);
  const owns = (value: unknown): value is T => runeObjectRaw(value) === target;
  if (owns(known)) return known;
  let deep: object | undefined;
  const slots = new Map<PropertyKey, { raw: unknown; read: () => unknown }>();
  const view = () => new RuneValue([target], definition, 1, 1);
  const proxy = new Proxy(target, {
    get: (storage, key, receiver) => {
      if (key === runeObjectStorage) return storage;
      const model = definition();
      const field = typeof key === 'string' && Object.hasOwn(model.fields, key) ? model.fields[key] : undefined;
      if (field) {
        const raw: unknown = Reflect.get(storage, key, receiver);
        const cached = slots.get(key);
        if (cached && cached.raw === raw) return cached.read();
        const normalized = runeValueNormalizeField(raw, field, undefined, 'read');
        Reflect.set(storage, key, normalized, storage);
        if (field.metadata) { slots.set(key, { raw: normalized, read: () => normalized }); return normalized; }
        const slot = new RuneValue(runeList(normalized), runeValueType(field), field.min, field.max, field.check, items => {
          const raw = field.max !== null && field.max <= 1 ? items[0] : items;
          const cached = slots.get(key);
          if (!cached || cached.read !== read) return;
          Reflect.set(storage, key, raw, storage);
          runeJson.clearNumberText(storage, field.key);
          cached.raw = raw;
        });
        const canonical = field.max !== null && field.max <= 1 ? slot.$array()[0] : normalized == null ? undefined : slot.$array();
        Reflect.set(storage, key, canonical, storage);
        const read = () => runeProjectValue(slot);
        slots.set(key, { raw: canonical, read });
        return read();
      }
      if (key in storage) return Reflect.get(storage, key, receiver);
      if (key === 'toJSON') return (options?: RuneJsonOptions | string) => runeValueJSON(storage, definition, options);
      if (key === 'deep') return () => deep ??= runeProjectedDeep(view());
      if (key === '_') return deep ??= runeProjectedDeep(view());
      if (key === 'field' || key === 'select') return (name: string) => runeProjectValue(Reflect.apply(Reflect.get(view(), key), view(), [name]));
      return Reflect.get(storage, key, receiver);
    },
    set: (storage, key, value, receiver) => {
      const fields = definition().fields;
      const field = typeof key === 'string' && Object.hasOwn(fields, key) ? fields[key] : undefined;
      const normalized = field ? runeValueNormalizeField(value, field, undefined, 'validate', construction ? runeObjectConstruction.get(construction) : undefined) : value;
      const written = Reflect.set(storage, key, normalized, receiver);
      if (written) {
        slots.delete(key);
        if (field) runeJson.clearNumberText(storage, field.key);
      }
      return written;
    }
  });
  runeObjectProxies.set(target, proxy);
  return proxy;
}
${runeModelRuntimeSource(exported)}
${e}class RuneObject {
  declare readonly $runeObject: true;
  constructor(data?: unknown) { return runeObjectProxy(this, () => { const model = runeObjectInstanceModel(this); if (!model) throw new TypeError('Rune object definition is unavailable'); return model; }, data != null && typeof data === 'object' && runeObjectConstruction.has(data) ? data : undefined); }
  static readonly [key: symbol]: () => RuneValueType;
  static field(cardinality: Cardinality, check?: RuneFieldDefinition['check'], type?: RuneFieldDefinition['type'], wireCardinality?: Cardinality, read?: RuneFieldDefinition['read']) {
    const definition: RuneFieldDefinition = { cardinality, check, type, read, ...(wireCardinality ? { metadata: true, wireCardinality } : {}) };
    return (_value: undefined, context: ClassFieldDecoratorContext): void => {
      if (context.static || context.private || typeof context.name !== 'string' || !context.metadata) throw new TypeError('Rune fields must be public instance properties');
      let fields = runeDecoratedFields.get(context.metadata);
      if (!fields) { fields = new Map(); runeDecoratedFields.set(context.metadata, fields); }
      fields.set(context.name, definition);
    };
  }
  static model(options: RuneModelDefinition) {
    return <C extends RuneObjectConstructor>(constructor: C, context: ClassDecoratorContext<C>): void => {
      runeDecorateModel(constructor, options, context.metadata ? runeDecoratedFields.get(context.metadata) : undefined);
    };
  }
  static decorate<C extends RuneObjectConstructor>(constructor: C, options: RuneModelDefinition, fields: Readonly<Record<string, RuneFieldDefinition>>): void { runeDecorateModel(constructor, options, new Map(Object.entries(fields))); }
  static definition<M extends RuneValueType>(definition: RuneModelDefinition<M>): M { return runeDefineModel<M>(definition); }
  protected static define<M extends RuneValueType>(definition: M): void {
    const model = runeRegisterValueType(definition);
    Object.defineProperty(this, runeObjectType, { value: () => model });
  }
  static from<C extends RuneModelOwner, const I>(this: C, input: I & RuneFactoryInput<I, RuneModel<C>['input'], NonNullable<RuneModel<C>['output']>>): RunePayload<RuneProjected<NonNullable<RuneModel<C>['output']>, RuneModel<C>>, RuneFromMin<I>, RuneFromMax<I>> {
    return runeProjected<I, RuneModel<C>>(input, () => runeModel(this));
  }
  static fromJSON<C extends RuneModelOwner, const I>(this: C, input: I, options: RuneJsonOptions = {}): RunePayload<RuneProjected<NonNullable<RuneModel<C>['output']>, RuneModel<C>>, RuneFromMin<I>, RuneFromMax<I>> {
    return runeProjectedJSON<I, RuneModel<C>>(input, () => runeModel(this), options);
  }
  toJSON(options?: RuneJsonOptions | string): unknown {
    const model = runeObjectInstanceModel(this);
    if (!model) throw new TypeError('Rune object definition is unavailable');
    return runeValueJSON(this, () => model, options);
  }
  static is<C extends RuneObjectConstructor, I>(this: C, value: I): value is RuneGuarded<I, C> { return runeObjectMatches(value, this); }
  static guard<C extends RuneObjectConstructor>(constructor: C): RuneTypeGuard<C> {
    return <I>(value: I): value is RuneGuarded<I, C> => runeObjectMatches(value, constructor);
  }
  static choice<M extends RuneValueType>(definition: M): RuneChoice<M> { return new RuneChoice(definition); }
  static create<C extends RuneObjectConstructor>(constructor: C): (value: unknown, checked?: RuneShapeChecks) => InstanceType<C>;
  static create(constructor: RuneObjectConstructor): (value: unknown, checked?: RuneShapeChecks) => RuneObject {
    return (value, checked = new WeakMap()) => {
      if (value == null || typeof value !== 'object' || !runeObjectShape(value, runeModel(constructor), checked)) throw new TypeError('Invalid ' + runeModel(constructor).identity);
      const previous = runeObjectConstruction.get(value);
      runeObjectConstruction.set(value, checked);
      try {
        const instance: unknown = Reflect.construct(constructor, [value]);
        if (!is(instance)) throw new TypeError('Rune constructor did not produce a model instance');
        return instance;
      } finally {
        if (previous) runeObjectConstruction.set(value, previous);
        else runeObjectConstruction.delete(value);
      }
    };
  }
  static codec<S>(owner: RuneModelOwner, schema: RuneSerializationSchema<S> & { readonly node?: RuneSerializationSchema<S> }): RuneSerializationCodec {
    const local = schema.node ?? schema;
    const shape = (value: unknown, checked?: RuneShapeChecks): value is S => runeObjectShape(value, runeModel(owner), checked);
    return {
      decode: value => schema.parse(value),
      wire: value => { const native = local.parse(value); return schema.node ? native : value; },
      validate: (value, checked) => { if (!shape(value, checked)) throw new TypeError('Invalid Rune serialization shape'); local.encode(value); },
      encode: (value, checked) => { if (!shape(value, checked)) throw new TypeError('Invalid Rune serialization shape'); return local.encode(value); }
    };
  }
}`;
}
