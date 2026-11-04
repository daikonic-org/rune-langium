// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getElementNamespace,
  isAttribute,
  isChoice,
  isChoiceOption,
  isData,
  isRosettaRecordType,
  isRosettaRecordFeature,
  type Choice,
  type Data
} from '@rune-langium/core';
import {
  featureName,
  resolveType,
  typeFeatures,
  renderCalendarField,
  type Feature,
  type ExpressionType
} from '../expr/navigation.js';
import { fieldMetadataKind, metadataType, hasTypeMetadata } from '../expr/metadata-runtime.js';
import { isTypeScriptNativeType, type TypeScriptNativeType } from './native-types.js';

type Model = Data | Choice | TypeScriptNativeType;
export const MODEL_NAMESPACE_MEMBERS: ReadonlySet<string> = new Set(['Shape', 'Input', 'Type', 'Selections', 'Deep']);
export interface ValueApiEmission {
  prelude: string;
  types: string;
  members: string;
}
type Bounds = { min: number; max: number | null };
type Field = {
  feature: Feature;
  key: string;
  id: string;
  bounds: Bounds;
  wireBounds: Bounds;
  metadata?: ReturnType<typeof fieldMetadataKind>;
  model?: Model;
};

/** Generated types and runtime descriptors share this linked field inventory. */
export class ValueApiEmitter {
  private readonly fieldCache = new WeakMap<Model, Field[]>();
  private readonly reachableCache = new WeakMap<Model, Field[]>();
  private readonly cyclic = new WeakSet<Model>();
  private readonly boundsCache = new WeakMap<Model, Map<string, Bounds | undefined>>();
  private readonly inventories = new Map<string, Model>();
  private readonly emissions = new WeakMap<Model, ValueApiEmission>();
  private readonly emittedRecords = new Set<TypeScriptNativeType>();
  constructor(
    private readonly names: (node: Model, name?: string) => string,
    private readonly primitive: (field: Feature) => string,
    private readonly record: (type: TypeScriptNativeType) => string,
    private readonly output: (node: Model) => string,
    private readonly create: (node: Model) => string,
    private readonly check: (field: Feature) => string | undefined,
    private readonly namespaceOutput: (node: Model) => string,
    private readonly codec: (node: Model) => string | undefined = () => undefined
  ) {}

  name(node: Model, suffix: string): string {
    return this.names(node, suffix);
  }

  runtime(node: Model): string {
    return isTypeScriptNativeType(node) ? this.name(node, 'Type') : `runeModel(${this.output(node)})`;
  }

  private field(feature: Feature): Field {
    const key = featureName(feature);
    const target = resolveType(feature.typeCall);
    const wireBounds = isAttribute(feature)
      ? { min: feature.card.inf, max: feature.card.unbounded ? null : (feature.card.sup ?? 1) }
      : { min: isChoiceOption(feature) ? 0 : 1, max: 1 };
    const metadata = (isAttribute(feature) || isChoiceOption(feature)) && fieldMetadataKind(feature);
    const bounds = metadata ? { ...wireBounds, min: 0 } : wireBounds;
    const owner = feature.$container;
    return {
      feature,
      key,
      id: `${getElementNamespace(owner)}.${owner.name}#${key}`,
      bounds,
      wireBounds,
      metadata: metadata || undefined,
      ...(isData(target) || isChoice(target) || isTypeScriptNativeType(target) ? { model: target } : {})
    };
  }

  private reachable(node: Model): Field[] {
    const cached = this.reachableCache.get(node);
    if (cached) return cached;
    const seen = new Set<ExpressionType>();
    const active = new Set<ExpressionType>();
    const fields = new Map<string, Field>();
    const visit = (type: ExpressionType) => {
      if (active.has(type)) {
        this.cyclic.add(node);
        return;
      }
      if (seen.has(type)) return;
      seen.add(type);
      active.add(type);
      for (const field of this.own(type as Model)) {
        fields.set(field.id, field);
        if (field.model) visit(field.model);
      }
      active.delete(type);
    };
    visit(node);
    const result = [...fields.values()];
    this.reachableCache.set(node, result);
    return result;
  }

  private own(node: Model): Field[] {
    let fields = this.fieldCache.get(node);
    if (!fields) {
      fields = typeFeatures(node).map((feature) => this.field(feature));
      this.fieldCache.set(node, fields);
    }
    return fields;
  }

  dependencies(node: Model): Model[] {
    const parent = isData(node) && isData(node.superType?.ref) ? node.superType.ref : undefined;
    return [
      ...new Set([
        ...this.reachable(node).flatMap((field) => (field.model ? [field.model] : [])),
        ...(parent ? [parent] : [])
      ])
    ];
  }

  features(node: Model): Feature[] {
    return this.reachable(node).map((field) => field.feature);
  }

  /** Cycles conservatively widen static bounds; runtime traversal uses exact canonical paths. */
  private bounds(node: Model, target: string, seen = new Set<Model>()): Bounds | undefined {
    if (seen.has(node)) return { min: 0, max: null };
    const fields = this.own(node);
    const direct = fields.filter((field) => field.id === target);
    if (direct.length) return direct[0]!.bounds;
    this.reachable(node);
    if (this.cyclic.has(node)) return { min: 0, max: null };
    let memo = this.boundsCache.get(node);
    if (!memo) {
      memo = new Map();
      this.boundsCache.set(node, memo);
    }
    if (memo.has(target)) return memo.get(target);
    const next = new Set(seen).add(node);
    const paths = fields.flatMap((field) => {
      const child = field.model && this.bounds(field.model, target, next);
      if (!child) return [];
      return [
        {
          min: field.bounds.min * child.min,
          max:
            field.bounds.max === 0 || child.max === 0
              ? 0
              : field.bounds.max === null || child.max === null
                ? null
                : field.bounds.max * child.max
        }
      ];
    });
    const result = paths.length
      ? {
          min: paths.reduce((sum, path) => sum + path.min, 0),
          max: paths.some((path) => path.max === null) ? null : paths.reduce((sum, path) => sum + path.max!, 0)
        }
      : undefined;
    memo.set(target, result);
    return result;
  }

  private logical(field: Field, input = false): string {
    return field.model
      ? input
        ? this.scopedType(field.model, 'Input')
        : MODEL_NAMESPACE_MEMBERS.has(this.output(field.model))
          ? this.namespaceOutput(field.model)
          : this.output(field.model)
      : this.primitive(field.feature);
  }

  private scopedType(node: Model, member: 'Input' | 'Type'): string {
    if (!MODEL_NAMESPACE_MEMBERS.has(this.output(node))) return this.name(node, member);
    const descriptor = `RuneModel<typeof ${this.output(node)}>`;
    return member === 'Type' ? descriptor : `NonNullable<(${descriptor})['input']>`;
  }

  emit(node: Model): ValueApiEmission {
    const cached = this.emissions.get(node);
    if (cached) return cached;
    const records: string[] = [];
    for (const record of this.dependencies(node).filter(isTypeScriptNativeType)) {
      if (!this.emittedRecords.has(record)) {
        this.emittedRecords.add(record);
        records.push(this.emit(record).prelude);
      }
    }
    const own = this.own(node);
    const reachable = this.reachable(node);
    const byName = Map.groupBy(reachable, (field) => field.key);
    const modelName = this.name(node, 'Type');
    const inputName = this.name(node, 'Input');
    const objectKey = (key: string) => (key === '__proto__' ? `[${JSON.stringify(key)}]` : JSON.stringify(key));
    const selection = (field: Field, bounds: Bounds) =>
      `RuneValueSelection<${this.logical(field)}, ${bounds.min}, ${bounds.max}, ${field.model ? this.scopedType(field.model, 'Type') : 'RuneEmptyType'}>`;
    const descriptor = (field: Field, bounds: Bounds, direct = false) => {
      const step = {
        key: field.key,
        ...field.bounds,
        ...((isAttribute(field.feature) || isChoiceOption(field.feature)) && fieldMetadataKind(field.feature)
          ? { metadata: true, wireMin: field.wireBounds.min, wireMax: field.wireBounds.max }
          : {})
      };
      const record =
        isRosettaRecordFeature(field.feature) && isRosettaRecordType(field.feature.$container)
          ? field.feature.$container
          : undefined;
      const calendar = record
        ? renderCalendarField(
            field.feature,
            () => `(value as ${this.record(record)})`,
            false,
            true,
            true,
            undefined,
            true
          )
        : undefined;
      const check = this.check(field.feature);
      const read = calendar ? `, read: (value: unknown) => ${calendar}` : '';
      const pathStep = `${JSON.stringify(step).slice(0, -1)}${read}}`;
      return `{ id: ${JSON.stringify(field.id)}, key: ${JSON.stringify(field.key)}, min: ${bounds.min}, max: ${bounds.max}${direct ? `, paths: [[${pathStep}]]` : ''}${step.metadata ? `, metadata: true, wireMin: ${field.wireBounds.min}, wireMax: ${field.wireBounds.max}` : ''}${read}${check ? `, check: ${check}` : ''}${field.model ? `, type: () => ${this.runtime(field.model)}` : ''} }`;
    };
    const fields = own.map((field) => {
      const type = metadataType(
        this.logical(field, true),
        isAttribute(field.feature) || isChoiceOption(field.feature) ? fieldMetadataKind(field.feature) : undefined
      );
      return `  ${JSON.stringify(field.key)}${field.wireBounds.min === 0 ? '?' : ''}: RuneInputPayload<${type}, ${field.wireBounds.min}, ${field.wireBounds.max}>;`;
    });
    const allDeep = [...byName].flatMap(([key, matches]) => {
      const direct = own.find((field) => field.key === key);
      const field = direct ?? (matches.length === 1 ? matches[0] : undefined);
      return field ? [{ key, field, bounds: this.bounds(node, field.id) ?? { min: 0, max: null } }] : [];
    });
    const inventoryKey = reachable
      .map((field) => field.id)
      .sort()
      .join('\u0000');
    const existingInventory = this.inventories.get(inventoryKey);
    const inventoryOwner = existingInventory ?? node;
    this.inventories.set(inventoryKey, inventoryOwner);
    const native = isTypeScriptNativeType(node);
    const data = isData(node);
    const ownerType = this.name(inventoryOwner, 'Type');
    const ownerRuntime = this.runtime(inventoryOwner);
    const selectionsType = existingInventory
      ? isTypeScriptNativeType(inventoryOwner)
        ? `${ownerType}$Selections`
        : MODEL_NAMESPACE_MEMBERS.has(this.output(inventoryOwner))
          ? `RuneModel<typeof ${this.output(inventoryOwner)}>['selections']`
          : this.name(inventoryOwner, 'Selections')
      : native
        ? `${modelName}$Selections`
        : 'Selections';
    const deepType = existingInventory
      ? isTypeScriptNativeType(inventoryOwner)
        ? `${ownerType}$Deep`
        : MODEL_NAMESPACE_MEMBERS.has(this.output(inventoryOwner))
          ? `RuneModel<typeof ${this.output(inventoryOwner)}>['inventory']['deep']`
          : this.name(inventoryOwner, 'Deep')
      : native
        ? `${modelName}$Deep`
        : 'Deep';
    const selectionsValue = existingInventory
      ? `${ownerRuntime}.selections`
      : native
        ? `${modelName}$Selections`
        : '__selections';
    const deepValue = existingInventory ? `${ownerRuntime}.inventory.deep` : native ? `${modelName}$Deep` : '__deep';
    const inventoryValue = existingInventory
      ? `${ownerRuntime}.inventory`
      : `{ selections: ${selectionsValue}, deep: ${deepValue} }`;
    const baseDeep = [...byName]
      .filter(([, matches]) => matches.length === 1)
      .map(([key, matches]) => ({ key, field: matches[0]! }));
    const conservative = { min: 0, max: null };
    const deep = allDeep.filter(
      ({ key, bounds }) => own.some((field) => field.key === key) || bounds.min !== 0 || bounds.max !== null
    );
    const omit = deep.map(({ key }) => JSON.stringify(key)).join(' | ') || 'never';
    const types = [
      ...(!existingInventory
        ? [
            `${native ? '' : 'export '}type ${selectionsType} = { ${reachable.map((field) => `${JSON.stringify(field.id)}: ${selection(field, conservative)}`).join('; ')} };`,
            `${native ? '' : 'export '}type ${deepType} = { ${baseDeep.map(({ key, field }) => `${JSON.stringify(key)}: ${selection(field, conservative)}`).join('; ')} };`
          ]
        : []),
      ...(isTypeScriptNativeType(node)
        ? [`type ${inputName} = ${this.record(node)};`]
        : own.some((field) => isChoiceOption(field.feature))
          ? [
              `export type Input = {`,
              ...fields.filter((_, i) => !isChoiceOption(own[i]!.feature)),
              `} & (${own
                .filter((field) => isChoiceOption(field.feature))
                .map(
                  (selected) =>
                    `{ ${own
                      .filter((field) => isChoiceOption(field.feature))
                      .map(
                        (field) =>
                          `${JSON.stringify(field.key)}${field === selected ? '' : '?'}: ${field === selected ? metadataType(this.logical(field, true), field.metadata) : 'never'}`
                      )
                      .join('; ')} }`
                )
                .join(' | ')});`
            ]
          : [`export interface Input {`, ...fields, '}']),
      `${native ? '' : 'export '}interface ${native ? modelName : 'Type'} extends RuneValueType<${native ? inputName : 'Input'}, ${MODEL_NAMESPACE_MEMBERS.has(this.output(node)) ? this.namespaceOutput(node) : this.output(node)}> {`,
      ...(!native ? ['  readonly shape?: Shape;'] : []),
      `  fields: { ${own.map((field) => `${JSON.stringify(field.key)}: ${selection(field, field.bounds)}`).join('; ')} };`,
      `  deep: Omit<${deepType}, ${omit}> & { ${deep.map(({ key, field, bounds }) => `${JSON.stringify(key)}: ${selection(field, bounds)}`).join('; ')} };`,
      `  selections: ${selectionsType};`,
      `  readonly inventory: { readonly selections: ${selectionsType}; readonly deep: ${deepType} };`,
      '}'
    ].join('\n');
    const inventoryMembers = !existingInventory
      ? [
          `const ${selectionsValue}: ${data || !native ? this.name(node, 'Selections') : selectionsType} = { ${reachable.map((field) => `${JSON.stringify(field.id)}: ${descriptor(field, conservative)}`).join(', ')} };`,
          `const ${deepValue}: ${data || !native ? this.name(node, 'Deep') : deepType} = { ${baseDeep.map(({ key, field }) => `${objectKey(key)}: ${selectionsValue}[${JSON.stringify(field.id)}]`).join(', ')} };`
        ]
      : [];
    const members = [
      ...inventoryMembers,
      `${data ? `this.define<${modelName}>({` : `const ${native ? modelName : '__descriptor'}: ${modelName} = runeRegisterValueType<${modelName}>({`}`,
      `  identity: ${JSON.stringify(`${getElementNamespace(node)}.${node.name}`)},`,
      `  inventory: ${inventoryValue},`,
      ...(isData(node) ? ['  derived: new globalThis.Map<string, RuneValueType>(),'] : []),
      ...(isData(node) ? [`  prototype: ${this.output(node)}.prototype,`] : []),
      ...(isData(node) && isData(node.superType?.ref) ? [`  parent: () => ${this.runtime(node.superType.ref)},`] : []),
      ...(isChoice(node) ? [`  kind: 'choice',`] : []),
      ...(isData(node) && hasTypeMetadata(node) ? ['  metadata: true,'] : []),
      ...(isTypeScriptNativeType(node) ? ['  native: true,'] : []),
      ...(!isChoice(node) ? [`  create: ${this.create(node)},`] : []),
      ...(this.codec(node) ? [`  codec: () => ${this.codec(node)},`] : []),
      ...(own.some((field) => isChoiceOption(field.feature))
        ? [
            `  choice: ${JSON.stringify(own.filter((field) => isChoiceOption(field.feature)).map((field) => field.key))},`
          ]
        : []),
      `  fields: { ${own.map((field) => `${objectKey(field.key)}: ${descriptor(field, field.bounds, true)}`).join(', ')} },`,
      `  deep: Object.assign(Object.create(${deepValue}), { ${deep.map(({ key, field, bounds }) => `${objectKey(key)}: ${descriptor(field, bounds)}`).join(', ')} }),`,
      `  selections: ${selectionsValue}`,
      '});'
    ].join('\n');
    const result = {
      prelude: [...records, ...(native ? [types, members] : [])].join('\n'),
      types: native ? '' : types,
      members: native ? '' : members
    };
    this.emissions.set(node, result);
    return result;
  }
}
