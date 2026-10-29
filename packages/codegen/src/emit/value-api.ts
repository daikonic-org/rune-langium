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
  type RosettaRecordType,
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
import { fieldMetadataKind, metadataType } from '../expr/metadata-runtime.js';

type Model = Data | Choice | RosettaRecordType;
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
  private readonly inventories = new Map<string, string>();
  private readonly emittedRecords = new Set<RosettaRecordType>();
  constructor(
    private readonly names: (node: Model, name?: string) => string,
    private readonly primitive: (field: Feature) => string,
    private readonly record: (type: RosettaRecordType) => string,
    private readonly output: (node: Model) => string,
    private readonly create: (node: Model) => string,
    private readonly check: (field: Feature) => string | undefined
  ) {}

  name(node: Model, suffix: string): string {
    return this.names(node, suffix);
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
      ...(isData(target) || isChoice(target) || isRosettaRecordType(target) ? { model: target } : {})
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
    return [...new Set(this.reachable(node).flatMap((field) => (field.model ? [field.model] : [])))];
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
        ? this.name(field.model, 'Input')
        : this.output(field.model)
      : this.primitive(field.feature);
  }

  emit(node: Model): string {
    const records: string[] = [];
    for (const record of this.dependencies(node).filter(isRosettaRecordType)) {
      if (!this.emittedRecords.has(record)) {
        this.emittedRecords.add(record);
        records.push(this.emit(record));
      }
    }
    const own = this.own(node);
    const reachable = this.reachable(node);
    const byName = Map.groupBy(reachable, (field) => field.key);
    const modelName = this.name(node, 'Type');
    const inputName = this.name(node, 'Input');
    const objectKey = (key: string) => (key === '__proto__' ? `[${JSON.stringify(key)}]` : JSON.stringify(key));
    const selection = (field: Field, bounds: Bounds) =>
      `RuneValueSelection<${this.logical(field)}, ${bounds.min}, ${bounds.max}, ${field.model ? this.name(field.model, 'Type') : 'RuneEmptyType'}>`;
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
      return `{ id: ${JSON.stringify(field.id)}, key: ${JSON.stringify(field.key)}, min: ${bounds.min}, max: ${bounds.max}${direct ? `, paths: [[${pathStep}]]` : ''}${step.metadata ? `, metadata: true, wireMin: ${field.wireBounds.min}, wireMax: ${field.wireBounds.max}` : ''}${read}${check ? `, check: ${check}` : ''}${field.model ? `, type: () => ${this.name(field.model, 'Type')}` : ''} }`;
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
    const inventory = existingInventory ?? `${modelName}$Reachable`;
    this.inventories.set(inventoryKey, inventory);
    const baseDeep = [...byName]
      .filter(([, matches]) => matches.length === 1)
      .map(([key, matches]) => ({ key, field: matches[0]! }));
    const conservative = { min: 0, max: null };
    const deep = allDeep.filter(
      ({ key, bounds }) => own.some((field) => field.key === key) || bounds.min !== 0 || bounds.max !== null
    );
    const omit = deep.map(({ key }) => JSON.stringify(key)).join(' | ') || 'never';
    return [
      ...records,
      ...(!existingInventory
        ? [
            `type ${inventory}$Selections = { ${reachable.map((field) => `${JSON.stringify(field.id)}: ${selection(field, conservative)}`).join('; ')} };`,
            `const ${inventory}$Selections: ${inventory}$Selections = { ${reachable.map((field) => `${JSON.stringify(field.id)}: ${descriptor(field, conservative)}`).join(', ')} };`,
            `type ${inventory}$Deep = { ${baseDeep.map(({ key, field }) => `${JSON.stringify(key)}: ${selection(field, conservative)}`).join('; ')} };`,
            `const ${inventory}$Deep: ${inventory}$Deep = { ${baseDeep.map(({ key, field }) => `${objectKey(key)}: ${inventory}$Selections[${JSON.stringify(field.id)}]`).join(', ')} };`
          ]
        : []),
      ...(isRosettaRecordType(node)
        ? [`export type ${inputName} = ${this.record(node)};`]
        : own.some((field) => isChoiceOption(field.feature))
          ? [
              `export type ${inputName} = {`,
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
          : [`export interface ${inputName} {`, ...fields, '}']),
      `export interface ${modelName} extends RuneValueType<${inputName}, ${this.output(node)}> {`,
      `  fields: { ${own.map((field) => `${JSON.stringify(field.key)}: ${selection(field, field.bounds)}`).join('; ')} };`,
      `  deep: Omit<${inventory}$Deep, ${omit}> & { ${deep.map(({ key, field, bounds }) => `${JSON.stringify(key)}: ${selection(field, bounds)}`).join('; ')} };`,
      `  selections: ${inventory}$Selections;`,
      '}',
      `export const ${modelName}: ${modelName} = {`,
      ...(isRosettaRecordType(node) ? ['  native: true,'] : []),
      `  create: ${this.create(node)},`,
      ...(own.some((field) => isChoiceOption(field.feature))
        ? [
            `  choice: ${JSON.stringify(own.filter((field) => isChoiceOption(field.feature)).map((field) => field.key))},`
          ]
        : []),
      `  fields: { ${own.map((field) => `${objectKey(field.key)}: ${descriptor(field, field.bounds, true)}`).join(', ')} },`,
      `  deep: Object.assign(Object.create(${inventory}$Deep), { ${deep.map(({ key, field, bounds }) => `${objectKey(key)}: ${descriptor(field, bounds)}`).join(', ')} }),`,
      `  selections: ${inventory}$Selections`,
      '};',
      this.factory(node)
    ].join('\n');
  }

  factory(node: Model): string {
    if (isRosettaRecordType(node)) return '';
    const input = this.name(node, 'Input');
    const schema = this.name(node, 'Type');
    const output = this.output(node);
    const body = `{ from<const I>(input: I & RuneFactoryInput<I, ${input}, ${output}>): RuneView<${output}, RuneFromMin<I>, RuneFromMax<I>, ${schema}> { return runeValue(input, () => ${schema}) as unknown as RuneView<${output}, RuneFromMin<I>, RuneFromMax<I>, ${schema}>; } }`;
    return isData(node)
      ? `export const ${output} = Object.assign(${this.name(node, 'Data')}, ${body});`
      : `export const ${output} = ${body};`;
  }
}
