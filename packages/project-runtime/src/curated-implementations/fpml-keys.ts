// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getElementNamespace,
  isData,
  isRosettaEnumeration,
  isRosettaTypeAlias,
  type Data,
  type RosettaModel,
  type RosettaType
} from '@rune-langium/core';
import { sha256Hex } from '@rune-langium/codegen/instances';

export const fpmlKeyRecipes = {
  CreateAssetKey: {
    parameter: 'fpmlAsset',
    type: 'fpml.consolidated.asset.Asset',
    missing: 2,
    modulus: 10000,
    includePrefix: false,
    includeId: false,
    output: 'keyValue',
    required: 1
  },
  CreateKey: {
    parameter: 'fpmlLeg',
    type: 'fpml.consolidated.shared.Leg',
    missing: 4,
    modulus: 10000,
    includePrefix: true,
    includeId: true,
    output: 'keyValueWithIndex',
    required: 0
  },
  CreateKeyForQuotedCurrencyPair: {
    parameter: 'fpmlQuotedCurrencyPair',
    type: 'fpml.consolidated.shared.QuotedCurrencyPair',
    missing: 3,
    modulus: 1000,
    includePrefix: true,
    includeId: false,
    output: 'keyValueWithIndex',
    required: 0
  }
} as const;

export type FpmlKeyRecipe = (typeof fpmlKeyRecipes)[keyof typeof fpmlKeyRecipes];
type Field = readonly [name: string, type: string, flags: number];
export type FpmlHashLayout = Readonly<Record<string, readonly [base: string | null, fields: readonly Field[]]>>;

const pinnedCommits = {
  cdm: '0f1f99aef829c23910476981bb91256544cb8569',
  fpml: 'ffda7dffda7cec97f9648123a1ba3cb8aad4e568',
  'rune-dsl': 'c0251abb7ed07b1f2d2fe248f0b7f3aa9df7c5f6'
};
// Fingerprint of the Java 3.13.0 immutable model hash fields, in declaration order.
const pinnedLayoutSha256 = '34d5345d4f6d9120fab1b2f1085719128d3bcaeb39ffc15e2d578ae2fce8ed3b';
const javaTypes = new Map([
  ['string', 'java.lang.String'],
  ['boolean', 'java.lang.Boolean'],
  ['int', 'java.lang.Integer'],
  ['number', 'java.math.BigDecimal'],
  ['time', 'java.time.LocalTime'],
  ['zonedDateTime', 'java.time.ZonedDateTime']
]);
const identity = (node: RosettaType) => getElementNamespace(node) + '.' + node.name;

function fieldType(target: RosettaType): string {
  const primitive = getElementNamespace(target) === 'com.rosetta.model' ? javaTypes.get(target.name) : undefined;
  if (primitive) return primitive;
  if (isRosettaTypeAlias(target) && target.typeCall.type.ref) return fieldType(target.typeCall.type.ref);
  if (isData(target) || isRosettaEnumeration(target)) return identity(target);
  throw new Error('Unsupported FpML key field type: ' + identity(target));
}

/** Derive the fields once from the linked pinned model, including possible concrete subtypes. */
export function fpmlHashLayout(models: Iterable<RosettaModel>): FpmlHashLayout {
  const types = new Map<string, Data>();
  const subtypes = new Map<Data, Data[]>();
  for (const model of models)
    for (const node of model.elements) {
      if (!isData(node)) continue;
      types.set(identity(node), node);
      const parent = node.superType?.ref;
      if (isData(parent)) {
        const children = subtypes.get(parent);
        if (children) children.push(node);
        else subtypes.set(parent, [node]);
      }
    }
  const pending = Object.values(fpmlKeyRecipes).map(({ type }) => {
    const root = types.get(type);
    if (!root) throw new Error('Missing FpML key type: ' + type);
    return root;
  });
  const layout = new Map<string, FpmlHashLayout[string]>();
  for (const node of pending) {
    const name = identity(node);
    if (layout.has(name)) continue;
    const parent = node.superType?.ref;
    if (parent) {
      if (!isData(parent)) throw new Error('Unsupported FpML key parent: ' + identity(parent));
      pending.push(parent);
    }
    pending.push(...(subtypes.get(node) ?? []));
    const fields = node.attributes.map((attribute): Field => {
      const target = attribute.typeCall.type.ref;
      if (!target) throw new Error('Unlinked FpML key field: ' + name + '.' + attribute.name);
      if (isData(target)) pending.push(target);
      const many = attribute.card.unbounded || (attribute.card.sup ?? 1) > 1;
      return [attribute.name, fieldType(target), Number(many) + 2 * Number(isRosettaEnumeration(target))];
    });
    layout.set(name, [parent ? identity(parent) : null, fields]);
  }
  return Object.fromEntries([...layout].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

/** Do not attach a hash recipe to unaudited Java or model releases. */
export async function prepareFpmlHashLayout(
  sources: readonly { model: string; commit: string }[],
  models: Iterable<RosettaModel>
): Promise<FpmlHashLayout | undefined> {
  if (
    !Object.entries(pinnedCommits).every(([model, commit]) =>
      sources.some((source) => source.model === model && source.commit === commit)
    )
  )
    return undefined;
  const layout = fpmlHashLayout(models);
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify(layout)));
  if (digest !== pinnedLayoutSha256)
    throw new Error('Linked FpML key layout differs from the pinned Java hash layout.');
  return layout;
}
