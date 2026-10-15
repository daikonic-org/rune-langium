// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getOperationArgument,
  resolveTypeAliases,
  isChoice,
  isData,
  isRosettaEnumValue,
  isRosettaType,
  isSwitchOperation,
  type RosettaExpression,
  type RosettaEnumValue,
  type AsOperation,
  type RosettaType,
  type SwitchOperation
} from '@rune-langium/core';
import { normalizeMetadataExpression, unwrapMetadata } from './metadata-runtime.js';
import { choiceSelection } from './metadata-type.js';
import { dataSelectionFacts } from './type-selection.js';
import {
  expressionType,
  expressionIsMany,
  featureName,
  renderFeaturePath,
  typeMatches,
  typeFeatures,
  type ExpressionType
} from './navigation.js';

export interface SwitchExpressionRenderOptions {
  /** Display resolved enum cases using the same member renderer as comparisons. */
  enumValue?: (value: RosettaEnumValue) => string;
  /** Fuse a projection's narrowing and presence test without extracting the selected value. */
  presence?: 'present' | 'absent';
  returnStatement?: boolean;
  /** Shape statement returns using the surrounding assignment's cardinality. */
  returnValue?: (value: string, expression?: RosettaExpression) => string;
  selectorName?: string;
  /** Projection-only narrowing for purpose-built Rune objects, not raw JSON validation. */
  objectGuard?: (target: RosettaType) => string;
  /** Render an expression, optionally rebinding the implicit `item`. */
  renderExpression: (
    expression: RosettaExpression,
    options?: { selfName?: string; projected?: boolean; target?: RosettaType }
  ) => string;
  /** Compare an unwrapped payload while retaining the original selector for branch binding. */
  selector?: { name: string; unwrap: (selector: string) => string };
  /** Report an unsupported or unresolved switch case. */
  report?: (message: string) => void;
  /** Give checked data selections a target-language type predicate. */
  typeGuard?: (value: string, type: RosettaType, guard: string, wrapped: boolean) => string;
  /** Rendering scope used when a switch omits its explicit argument. */
  selfName?: string;
}

function typeName(type: ExpressionType | undefined): string {
  return type?.name ?? '?';
}

function referenceName(reference: { $refText?: string; ref?: { name?: string } } | undefined): string | undefined {
  return reference?.ref?.name ?? reference?.$refText;
}

function isObject(value: string): string {
  return `${value} != null && typeof ${value} === 'object' && !Array.isArray(${value})`;
}

function dataGuard(value: string, data: RosettaType, inputType: RosettaType): string {
  const facts = dataSelectionFacts(data, inputType);
  const required = facts.required.map((name) => JSON.stringify(name));
  const checks = [isObject(value), ...required.map((key) => `${key} in ${value}`)];
  if (!facts.matches) {
    const distinguishing = facts.distinguishing;
    checks.push(
      distinguishing.length === 0
        ? 'false'
        : `(${distinguishing
            .map((name) => {
              const key = JSON.stringify(name);
              return `(${key} in ${value} && ${value}[${key}] != null)`;
            })
            .join(' || ')})`
    );
  }
  return checks.join(' && ');
}

function choiceGuard(value: string, choice: RosettaType): string {
  const keys = typeFeatures(choice).map((feature) => JSON.stringify(featureName(feature)));
  if (keys.length === 0) return 'false';
  return `${isObject(value)} && [${keys.map((key) => `${key} in ${value}`).join(', ')}].filter(Boolean).length === 1`;
}

/** Select declared choice arms or narrow a data value using the shared runtime guards. */
function typeSelection(value: string, inputType: RosettaType, target: RosettaType, exactChoice = false) {
  const { paths, metadataKind } = isChoice(inputType)
    ? choiceSelection(inputType, target, exactChoice)
    : { paths: [], metadataKind: undefined };
  if (isChoice(inputType) && paths.length === 0) return undefined;
  const narrowedType = resolveTypeAliases(target) ?? target;
  if (exactChoice && isData(inputType) && (!isData(narrowedType) || !typeMatches(narrowedType, inputType)))
    return undefined;
  const selected =
    paths.length > 0
      ? paths
          .map((path) => {
            let result = value;
            path.forEach((step, index) => {
              result = renderFeaturePath(result, [step.name]);
              if (index < path.length - 1 && step.metadataKind) result = unwrapMetadata(result, false);
            });
            return normalizeMetadataExpression(result, path[path.length - 1]?.metadataKind, metadataKind);
          })
          .join(' ?? ')
      : value;
  return {
    selected,
    guard:
      paths.length > 0
        ? `(${selected}) != null`
        : isData(narrowedType)
          ? dataGuard(value, narrowedType, inputType)
          : choiceGuard(value, narrowedType),
    projected: paths.length > 0 && paths.every((path) => path.length > 0)
  };
}

export function renderAsExpression(
  expression: AsOperation,
  options: SwitchExpressionRenderOptions
): string | undefined {
  const input = getOperationArgument(expression);
  const inputType = expressionType(input);
  const target = expression.type.ref;
  const selected = isRosettaType(inputType) && target ? typeSelection('__as', inputType, target, true) : undefined;
  if (!selected) {
    options.report?.(`Cannot narrow '${typeName(inputType)}' to '${target?.name ?? expression.type.$refText}'`);
    return undefined;
  }
  const argument = expression.argument
    ? options.renderExpression(expression.argument)
    : (options.selfName ?? 'undefined');
  if (target && options.objectGuard) {
    const guard = options.objectGuard(target);
    if (options.presence) {
      const predicate = expressionIsMany(expression) ? `(${argument} ?? []).some(${guard})` : `${guard}(${argument})`;
      return options.presence === 'absent' ? `!${predicate}` : predicate;
    }
    return expressionIsMany(expression)
      ? `(${argument} ?? []).filter(${guard})`
      : `((value) => ${guard}(value) ? value : undefined)(${argument})`;
  }
  const value = options.selector ? options.selector.unwrap('__source') : '__source';
  const guard =
    isData(inputType) && target && options.typeGuard
      ? options.typeGuard(options.selector ? '__source' : '__as', target, selected.guard, !!options.selector)
      : selected.guard;
  const selectedValue = selected.projected || !options.selector ? selected.selected : '__source';
  const single = `((__as) => ${guard} ? ${selectedValue} : undefined)(${value})`;
  return expressionIsMany(expression)
    ? `((__values) => (__values ?? []).flatMap((__source) => { const __result = ${single}; return __result == null ? [] : [__result]; }))(${argument})`
    : `((__source) => ${single})(${argument})`;
}

function primitiveSwitch(
  operation: SwitchOperation,
  argument: string,
  options: SwitchExpressionRenderOptions,
  inputType: ExpressionType | undefined
): string {
  let fallback = options.returnStatement ? (options.returnValue?.('undefined') ?? 'undefined') : 'undefined';
  const cases: { value: string; branch: string }[] = [];
  const selector =
    options.returnStatement && /^[A-Za-z_$][\w$]*$/.test(argument) ? argument : (options.selectorName ?? '__sw');
  for (const currentCase of operation.cases) {
    const value = options.renderExpression(currentCase.expression, { selfName: options.selector?.name ?? selector });
    const branch = options.returnStatement ? (options.returnValue?.(value, currentCase.expression) ?? value) : value;
    if (!currentCase.guard) {
      fallback = branch;
      continue;
    }
    if (currentCase.guard.literalGuard) {
      cases.push({ value: options.renderExpression(currentCase.guard.literalGuard), branch });
      continue;
    }
    const target = currentCase.guard.referenceGuard?.ref;
    if (isRosettaEnumValue(target)) {
      cases.push({ value: options.enumValue?.(target) ?? JSON.stringify(target.name), branch });
      continue;
    }
    const targetName = referenceName(currentCase.guard.referenceGuard);
    // Keep unresolved cross-namespace references executable using the same
    // name comparison as the legacy renderer. Once linking supplies a Data or
    // Choice target, objectSwitch above takes the structural path instead.
    if (targetName !== undefined) {
      cases.push({ value: JSON.stringify(targetName), branch });
    } else {
      options.report?.(`Unsupported ${typeName(inputType)} switch guard`);
    }
  }
  if (options.returnStatement) {
    return [
      ...(selector !== argument ? [`const ${selector} = ${argument};`] : []),
      `switch (${selector}) {`,
      ...cases.flatMap(({ value, branch }) => [`  case ${value}:`, `    return ${branch};`]),
      '  default:',
      `    return ${fallback};`,
      '}'
    ].join('\n');
  }
  const chain = cases.reduceRight(
    (acc, currentCase) => `(${selector} === ${currentCase.value}) ? ${currentCase.branch} : ${acc}`,
    fallback
  );
  return `((${selector}) => (${chain}))(${argument})`;
}

function objectSwitch(
  operation: SwitchOperation,
  argument: string,
  inputType: RosettaType,
  options: SwitchExpressionRenderOptions
): string {
  const lines = [`((__sw) => {`, `  if (__sw == null) return undefined;`];
  for (const currentCase of operation.cases) {
    if (!currentCase.guard) continue;
    const target = currentCase.guard.referenceGuard?.ref;
    if (!isRosettaType(target)) {
      options.report?.(
        `Unsupported ${typeName(inputType)} switch guard '${referenceName(currentCase.guard.referenceGuard)}'`
      );
      continue;
    }
    const selection = typeSelection('__sw', inputType, target);
    if (!selection) {
      options.report?.(`No declared Choice option path from '${inputType.name}' to '${typeName(target)}'`);
      continue;
    }
    const { selected, guard, projected } = selection;
    const branch = options.renderExpression(currentCase.expression, { selfName: '__item', projected, target });
    let selectedValue = selected;
    let typedGuard =
      isData(inputType) && options.typeGuard
        ? options.typeGuard(options.selector?.name ?? '__sw', target, guard, !!options.selector)
        : guard;
    if (projected) {
      selectedValue = `__selected${operation.cases.indexOf(currentCase)}`;
      lines.push(`  const ${selectedValue} = ${selected};`);
      typedGuard = `${selectedValue} != null`;
    }
    lines.push(`  if (${typedGuard}) {`);
    lines.push(`    const __item = ${!projected && options.selector?.name ? options.selector.name : selectedValue};`);
    lines.push(`    return ${branch};`);
    lines.push('  }');
  }
  const fallbackCase = operation.cases.find((currentCase) => !currentCase.guard);
  lines.push(
    `  return ${fallbackCase ? options.renderExpression(fallbackCase.expression, { selfName: options.selector?.name ?? '__sw' }) : 'undefined'};`
  );
  lines.push(`})(${argument})`);
  return lines.join('\n');
}

/**
 * Render a linked Rune `switch` expression.
 *
 * Choice cases follow declared option paths and bind the selected value to
 * the callback's implicit-variable name. Data cases check required Shape keys
 * and distinguishing subtype fields on plain objects as well as instances.
 * Enum and literal cases retain the compact equality semantics used by the
 * existing expression renderer.
 */
export function renderSwitchExpression(
  expression: RosettaExpression,
  options: SwitchExpressionRenderOptions
): string | undefined {
  if (!isSwitchOperation(expression)) return undefined;
  const argument = expression.argument
    ? options.renderExpression(expression.argument)
    : (options.selfName ?? 'undefined');
  const inputType = expressionType(getOperationArgument(expression));
  if (options.returnStatement && inputType && (isChoice(inputType) || isData(inputType))) return undefined;
  const selector = options.selector ? options.selector.unwrap(options.selector.name) : argument;
  const result =
    inputType && (isChoice(inputType) || isData(inputType))
      ? objectSwitch(expression, selector, inputType, options)
      : primitiveSwitch(expression, selector, options, inputType);
  if (!options.selector) return result;
  return options.returnStatement
    ? `const ${options.selector.name} = ${argument};\n${result}`
    : `((${options.selector.name}) => (${result}))(${argument})`;
}
