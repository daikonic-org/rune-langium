// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Standard decorators collect local fields; shared lazy definitions own traversal metadata. */
export function runeModelRuntimeSource(exported: boolean): string {
  const e = exported ? 'export ' : '';
  return `
if (!Symbol.metadata) Object.defineProperty(Symbol, 'metadata', { value: Symbol.for('Symbol.metadata') });
${e}type RuneFieldDefinition = Omit<RuneValueSelection<unknown, number, number | null, unknown>, 'id' | 'key' | 'paths'>;
${e}type RuneModelDefinition<Model extends RuneValueType = RuneValueType> = Pick<RuneValueType, 'identity' | 'kind' | 'native' | 'metadata' | 'codec' | 'create' | 'prototype' | 'parent' | 'choice'> & {
  readonly fields?: Model['fields'];
  readonly base?: () => RuneValueType;
  readonly deepBounds?: Readonly<Record<string, { readonly min: number; readonly max: number | null }>>;
};
const runeDecoratedFields = new WeakMap<object, Map<string, RuneFieldDefinition>>();
type RuneModelInventory = { selections: Record<string, RuneValueSelection<unknown, number, number | null, unknown>>; deep: Record<string, RuneValueSelection<unknown, number, number | null, unknown>> };
const runeModelInventories = new Map<string, RuneModelInventory>();
const runeModelInventory = (model: RuneValueType): RuneModelInventory => {
  const seen = new Set<RuneValueType>();
  const reachable = new Map<string, RuneValueSelection<unknown, number, number | null, unknown>>();
  const visit = (type: RuneValueType): void => {
    if (seen.has(type)) return;
    seen.add(type);
    for (const field of Object.values(type.fields)) {
      reachable.set(field.id, field);
      const child = runeValueType(field)?.();
      if (child) visit(child);
    }
  };
  visit(model);
  const key = JSON.stringify([...reachable.keys()].sort());
  const cached = runeModelInventories.get(key);
  if (cached) return cached;
  const selections = Object.fromEntries([...reachable].map(([id, field]) => [id, { ...field, min: 0, max: null, paths: undefined }]));
  const deep = Object.fromEntries([...Map.groupBy(Object.values(selections), field => field.key)].flatMap(([name, fields]) => fields.length === 1 ? [[name, fields[0]!]] : []));
  const inventory = { selections, deep };
  runeModelInventories.set(key, inventory);
  return inventory;
};
const runeDecorateModel = (constructor: RuneObjectConstructor, options: RuneModelDefinition, fields?: ReadonlyMap<string, RuneFieldDefinition>): void => {
  const definition = runeDefineModel({ ...options, prototype: constructor.prototype, create: RuneObject.create(constructor) }, fields);
  Object.defineProperty(constructor, runeObjectType, { value: () => definition });
};
function runeDefineModel<Model extends RuneValueType>(options: RuneModelDefinition<Model>, decorated?: ReadonlyMap<string, RuneFieldDefinition>): Model;
function runeDefineModel(options: RuneModelDefinition, decorated: ReadonlyMap<string, RuneFieldDefinition> = new Map()): RuneValueType {
  let fields: RuneValueType['fields'] | undefined;
  let inventory: RuneModelInventory | undefined;
  let deep: RuneValueType['deep'] | undefined;
  const model = {
    ...options,
    derived: options.prototype ? new Map<string, RuneValueType>() : undefined,
    get fields(): RuneValueType['fields'] {
      if (!fields) {
        const inherited = (options.base ?? options.parent)?.().fields;
        const own = Object.fromEntries([...decorated].map(([key, field]) => [key, { ...field, id: options.identity + '#' + key, key }]));
        const merged: RuneValueType['fields'] = { ...inherited, ...options.fields, ...own };
        fields = Object.fromEntries(Object.entries(merged).map(([key, field]) => [key, { ...field, paths: field.paths ?? [[{ key: field.key, min: field.min, max: field.max, metadata: field.metadata, wireMin: field.wireMin, wireMax: field.wireMax, read: field.read }]] }]));
      }
      return fields;
    },
    get inventory(): RuneModelInventory { return inventory ??= runeModelInventory(model); },
    get selections(): RuneValueType['selections'] { return this.inventory.selections; },
    get deep(): RuneValueType['deep'] {
      if (!deep) {
        const selected = Object.fromEntries(Object.entries(options.deepBounds ?? {}).map(([key, bounds]) => {
          const field = this.inventory.deep[key];
          if (!field) throw new TypeError('Unknown or ambiguous Rune property: ' + key);
          return [key, { ...field, ...bounds }];
        }));
        const complete: RuneValueType['deep'] = { ...selected, ...this.fields };
        Object.setPrototypeOf(complete, this.inventory.deep);
        deep = complete;
      }
      return deep;
    }
  };
  return runeRegisterValueType(model);
}`;
}
