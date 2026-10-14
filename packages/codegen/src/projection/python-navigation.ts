// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  isAttribute,
  isChoice,
  isChoiceOption,
  isData,
  isRosettaEnumValue,
  isRosettaRecordFeature,
  isRosettaRecordType,
  resolveTypeAliases,
  type RosettaExpression,
  type RosettaType
} from '@rune-langium/core';
import {
  deepFeaturePaths,
  expressionIsMany,
  expressionType,
  featureName,
  typeFeatures,
  typeMatches
} from '../expr/navigation.js';
import { isMetadataFeature, metadataPropertyPath } from '../expr/metadata-runtime.js';
import { expressionMetadataKind, choiceSelection } from '../expr/metadata-type.js';
import { dataSelectionFacts } from '../expr/type-selection.js';
import { onlyExistsSelection } from '../expr/only-exists.js';
import {
  pythonBind,
  pythonFresh,
  pythonRead,
  pythonReadField,
  pythonRootFields,
  pythonUnwrap,
  pythonNormalize,
  pythonCollection,
  pythonCoalesce,
  pythonPresence,
  pyBool,
  pyString,
  type PythonRenderContext,
  type PythonRender
} from './python-operations.js';

export function pythonCalendarField(feature: unknown, receiver: string, many = false): string | undefined {
  if (
    !isRosettaRecordFeature(feature) ||
    !isRosettaRecordType(feature.$container) ||
    !['date', 'dateTime', 'zonedDateTime'].includes(feature.$container.name)
  )
    return undefined;
  const read = (value: string) =>
    `rune.dateField(${value}, ${pyString(feature.$container.name)}, ${pyString(feature.name)})`;
  return many
    ? `[child for value in ${pythonCollection(receiver)} for child in [${read('value')}] if child is not None]`
    : read(receiver);
}
export function pythonNavigation(
  expression: RosettaExpression,
  context: PythonRenderContext,
  render: PythonRender
): string | undefined {
  if (expression.$type !== 'RosettaFeatureCall' && expression.$type !== 'RosettaDeepFeatureCall') return undefined;
  const feature = expression.feature?.ref;
  if (isRosettaEnumValue(feature)) return pyString(feature.name);
  if (!feature) throw new Error(`Unresolved navigation '${expression.feature?.$refText ?? '?'}'`);
  const calendar = pythonCalendarField(
    feature,
    render(expression.receiver, { ...context, preserveMetadata: false }),
    expressionIsMany(expression.receiver)
  );
  if (calendar) return calendar;
  if (isMetadataFeature(feature))
    return pythonRead(
      render(expression.receiver, { ...context, preserveMetadata: true }),
      metadataPropertyPath('name' in feature ? String(feature.name) : (expression.feature?.$refText ?? '?')),
      expressionIsMany(expression.receiver)
    );
  const name = isChoiceOption(feature)
    ? featureName(feature)
    : 'name' in feature
      ? String(feature.name)
      : (expression.feature?.$refText ?? '?');
  const receiver = render(expression.receiver, { ...context, preserveMetadata: false });
  let result: string;
  if (expression.$type === 'RosettaDeepFeatureCall') {
    const paths = deepFeaturePaths(
      expressionType(expression.receiver),
      name,
      new Set(),
      isAttribute(feature) || isChoiceOption(feature) || isRosettaRecordFeature(feature) ? feature : undefined
    );
    if (!paths.length) throw new Error(`Unresolved deep navigation '${name}'`);
    const root = pythonFresh(context, 'root'),
      many = expressionIsMany(expression);
    const values = paths.map((path) => pythonRead(root, path.map(featureName), many));
    result = pythonBind(
      receiver,
      root,
      many ? `[item for branch in [${values.join(', ')}] for item in branch]` : pythonCoalesce(values)
    );
  } else result = pythonRead(receiver, [name], expressionIsMany(expression.receiver));
  return context.preserveMetadata
    ? result
    : pythonUnwrap(result, expressionMetadataKind(expression), expressionIsMany(expression));
}

export function pythonTypeSelection(value: string, input: RosettaType, target: RosettaType, exact = false) {
  const resolved = resolveTypeAliases(target) ?? target;
  if (isChoice(input)) {
    const selection = choiceSelection(input, resolved, exact);
    if (!selection.paths.length) throw new Error(`Unresolved Choice path from '${input.name}' to '${target.name}'`);
    const branches = selection.paths.map((path) => {
      let result = value;
      path.forEach((step, index) => {
        result = pythonRead(result, [step.name]);
        if (index < path.length - 1) result = pythonUnwrap(result, step.metadataKind);
      });
      return pythonNormalize(result, path[path.length - 1]?.metadataKind, selection.metadataKind);
    });
    const selected = pythonCoalesce(branches);
    return { selected, guard: `(${selected} is not None)`, metadata: selection.metadataKind, projected: true };
  }
  if (exact && isData(input) && (!isData(resolved) || !typeMatches(resolved, input)))
    throw new Error(`Unresolved exact narrowing from '${input.name}' to '${target.name}'`);
  const required = isData(resolved) ? dataSelectionFacts(resolved, input) : undefined;
  const checks = [`isinstance(${value}, dict)`];
  if (required) {
    checks.push(...required.required.map((name) => `${pyString(name)} in ${value}`));
    if (!required.matches)
      checks.push(
        `(${required.distinguishing.map((name) => `${value}.get(${pyString(name)}) is not None`).join(' or ') || 'False'})`
      );
  } else if (isChoice(resolved)) {
    checks.push(
      `any(${value}.get(key) is not None for key in [${typeFeatures(resolved)
        .map((feature) => pyString(featureName(feature)))
        .join(', ')}])`
    );
  } else throw new Error(`Unresolved object narrowing to '${target.name}'`);
  return { selected: value, guard: `(${checks.join(' and ')})`, metadata: undefined, projected: false };
}

export function pythonOnlyExists(
  expression: RosettaExpression,
  context: PythonRenderContext,
  render: PythonRender
): string | undefined {
  if (expression.$type !== 'RosettaOnlyExistsExpression') return undefined;
  const rootFields = pythonRootFields(context);
  const selected = onlyExistsSelection(expression, rootFields.map(featureName), (node) => render(node, context));
  if (!selected || !selected.attributes.length) throw new Error('only-exists requires a linked common parent');
  if (!selected.parent) {
    const fields = new Map(rootFields.map((field) => [featureName(field), field]));
    return (
      selected.forbidden
        .map((name) => {
          const field = fields.get(name)!;
          return pythonPresence(pythonReadField(context.self, field, context.locals.get(field)), undefined, true);
        })
        .join(' and ') || pyBool(true)
    );
  }
  const value = selected.parentText ?? context.self;
  const bound = pythonFresh(context, 'parent');
  return pythonBind(
    value,
    bound,
    selected.forbidden
      .map((name) => pythonPresence(pythonReadField(bound, selected.features!.get(name)!), undefined, true))
      .join(' and ') || pyBool(true)
  );
}
