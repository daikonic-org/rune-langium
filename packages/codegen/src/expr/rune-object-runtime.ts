// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Shared model behavior; generated classes supply only their linked definition. */
export function runeObjectRuntimeSource(exported: boolean): string {
  const e = exported ? 'export ' : '';
  return `
${e}const runeObjectType = Symbol.for('rune-langium.object.definition');
${e}interface RuneModelOwner { readonly [key: symbol]: () => RuneValueType; }
${e}type RuneModel<C extends RuneModelOwner> = ReturnType<C[typeof runeObjectType]>;
${e}type RuneModelTag<P extends RuneModelOwner, M extends RuneValueType> = P[typeof runeObjectType] & (() => M);
type RuneObjectConstructor = RuneModelOwner & (new (...args: never[]) => RuneObject);
${e}type RuneGuarded<I, C extends RuneObjectConstructor> = I & (I extends RuneObject ? InstanceType<C> : ConstructorParameters<C>[0]);
${e}type RuneTypeGuard<C extends RuneObjectConstructor> = <I>(value: I) => value is RuneGuarded<I, C>;
${e}interface RuneSerializationCodec { decode(value: unknown): unknown; encode(value: unknown): unknown; }
${e}class RuneChoice<M extends RuneValueType> {
  readonly [key: symbol]: () => M;
  constructor(model: M) { Object.defineProperty(this, runeObjectType, { value: () => runeRegisterValueType(model) }); }
  from<const I>(input: I & RuneFactoryInput<I, M['input'], NonNullable<M['output']>>): RuneView<NonNullable<M['output']>, RuneFromMin<I>, RuneFromMax<I>, M> { return runeValue<I, M>(input, () => runeModel(this)); }
  fromJSON(input: unknown, options: RuneJsonOptions = {}): RuneView<NonNullable<M['output']>, 0, null, M> { return runeValue<unknown, M>(runeValueFromJSON(input, () => runeModel(this), options), () => runeModel(this)); }
  readonly is = <I>(value: I): value is I & NonNullable<M['shape']> => runeObjectShape(value, runeModel(this));
}
${e}function runeModel<C extends RuneModelOwner>(owner: C): RuneModel<C>;
${e}function runeModel(owner: RuneModelOwner): RuneValueType { return owner[runeObjectType]!(); }
const runeObjectDefinition = (value: unknown): value is RuneValueType => value != null && typeof value === 'object'
  && 'fields' in value && value.fields != null && typeof value.fields === 'object'
  && 'deep' in value && value.deep != null && typeof value.deep === 'object'
  && 'selections' in value && value.selections != null && typeof value.selections === 'object';
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
    if (raw === null || (max !== null && max <= 1 ? Array.isArray(raw) : !Array.isArray(raw))) return false;
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
${e}class RuneObject {
  declare readonly $runeObject: true;
  static readonly [key: symbol]: () => RuneValueType;
  protected static define<M extends RuneValueType>(definition: M): void {
    const model = runeRegisterValueType(definition);
    Object.defineProperty(this, runeObjectType, { value: () => model });
  }
  static from<C extends RuneModelOwner, const I>(this: C, input: I & RuneFactoryInput<I, RuneModel<C>['input'], NonNullable<RuneModel<C>['output']>>): RuneView<NonNullable<RuneModel<C>['output']>, RuneFromMin<I>, RuneFromMax<I>, RuneModel<C>> {
    return runeValue<I, RuneModel<C>>(input, () => runeModel(this));
  }
  static fromJSON<C extends RuneModelOwner>(this: C, input: unknown, options: RuneJsonOptions = {}): RuneView<NonNullable<RuneModel<C>['output']>, 0, null, RuneModel<C>> {
    return runeValue<unknown, RuneModel<C>>(runeValueFromJSON(input, () => runeModel(this), options), () => runeModel(this));
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
  static create<C extends RuneObjectConstructor>(constructor: C): (value: unknown) => InstanceType<C>;
  static create(constructor: RuneObjectConstructor): (value: unknown) => RuneObject {
    return value => {
      if (!runeObjectShape(value, runeModel(constructor))) throw new TypeError('Invalid ' + runeModel(constructor).identity);
      const instance: unknown = Reflect.construct(constructor, [value]);
      if (!is(instance)) throw new TypeError('Rune constructor did not produce a model instance');
      return instance;
    };
  }
  static codec<S>(owner: RuneModelOwner, schema: { parse(value: unknown): S; encode(value: S): unknown }): RuneSerializationCodec {
    const shape = (value: unknown): value is S => runeObjectShape(value, runeModel(owner));
    return {
      decode: value => schema.parse(value),
      encode: value => { if (!shape(value)) throw new TypeError('Invalid Rune serialization shape'); return schema.encode(value); }
    };
  }
}`;
}
