// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils } from 'langium';
import {
  getEnumValues,
  getOperationArgument,
  getNodeSourceRegion,
  isAttribute,
  isChoice,
  isChoiceOption,
  isRosettaEnumValue,
  isRosettaFunction,
  isRosettaRecordType,
  isRosettaType,
  type RosettaExpression
} from '@rune-langium/core';
import { expressionIsMany, expressionType, featureName, typeFeatures } from '../expr/navigation.js';
import { expressionMetadataKind } from '../expr/metadata-type.js';
import { fieldMetadataKind, metadataPropertyPath } from '../expr/metadata-runtime.js';
import {
  nativeEqualityOperands,
  nativeScalarOperands,
  nativeTemporalOperands,
  requiredScalarKind
} from '../expr/scalar-operators.js';
import { TEMPORAL_CONVERSION_PATTERNS } from '../expr/temporal-conversions.js';
import { functionInputs, functionOutput } from '../types/func.js';
import type { PythonProjectionContext } from './context.js';
import type { GeneratedProjection } from './types.js';
import {
  pythonArgument,
  pythonBind,
  pythonDeclarationValue,
  pythonComparison,
  pythonFresh,
  pythonHelperDependencies,
  pythonInline,
  pythonNormalize,
  pythonRead,
  pythonReadField,
  pythonRootFields,
  pythonUnwrap,
  pyBool,
  pyString,
  type PythonRenderContext
} from './python-operations.js';
import { pythonCalendarField, pythonNavigation, pythonOnlyExists, pythonTypeSelection } from './python-navigation.js';

/** Forward generation is independent of the deliberately narrower inverse Python lens. */
export function projectPythonExpression(
  expression: RosettaExpression,
  context: PythonProjectionContext
): GeneratedProjection {
  const locals = new Map(context.locals);
  const owner = AstUtils.getContainerOfType(expression, isRosettaFunction);
  if (owner)
    for (const input of functionInputs(owner))
      if (!locals.has(input)) locals.set(input, pythonRead(context.self, [input.name]));
  const code = renderPythonExpression(expression, { ...context, locals, state: { next: 0 } });
  let sourceLine = 1,
    sourceChar = context.subject.region.from + 1;
  try {
    const document = AstUtils.getDocument(expression);
    const position = document.textDocument.positionAt(getNodeSourceRegion(expression).from);
    sourceLine = position.line + 1;
    sourceChar = position.character + 1;
  } catch {
    /* Standalone parser expressions have no owning document. */
  }
  return {
    language: 'python',
    subject: context.subject,
    code,
    requiredHelpers: pythonHelperDependencies(code),
    sourceMap: [{ outputLine: 0, sourceUri: context.subject.uri, sourceLine, sourceChar }]
  };
}

export function renderPythonExpression(expression: RosettaExpression, context: PythonRenderContext): string {
  const render = renderPythonExpression;
  const valueContext = { ...context, preserveMetadata: false };
  const arg = getOperationArgument(expression);
  const argument = (preserve = context.preserveMetadata) =>
    arg
      ? render(arg, { ...context, preserveMetadata: preserve })
      : pythonUnwrap(context.self, preserve ? undefined : context.implicit?.metadata, context.implicit?.many);
  const branch = (
    child: RosettaExpression,
    target = context.preserveMetadata ? expressionMetadataKind(expression) : undefined
  ) => {
    const text = render(child, { ...context, preserveMetadata: !!target });
    if (child.$type === 'ListLiteral' && !child.elements.length && !expressionIsMany(expression)) return 'None';
    return target ? pythonNormalize(text, expressionMetadataKind(child), target) : text;
  };
  switch (expression.$type) {
    case 'RosettaBooleanLiteral':
      return pyBool(expression.value);
    case 'RosettaIntLiteral':
    case 'RosettaNumberLiteral': {
      const value = Number(expression.value);
      if (!Number.isFinite(value)) return value < 0 ? '-math.inf' : 'math.inf';
      if (Object.is(value, -0)) return '-0.0';
      const text = String(value);
      return Number.isInteger(value) && !text.includes('e') ? `${text}.0` : text;
    }
    case 'RosettaStringLiteral':
      return pyString(expression.value);
    case 'RosettaImplicitVariable':
      return pythonUnwrap(
        context.self,
        context.preserveMetadata ? undefined : context.implicit?.metadata,
        context.implicit?.many
      );
    case 'RosettaSymbolReference': {
      const target = expression.symbol.ref;
      if (!target) throw new Error(`Unresolved symbol '${expression.symbol.$refText}'`);
      const local = context.locals.get(target);
      if (local !== undefined) return pythonDeclarationValue(local, context, expression);
      if (isRosettaFunction(target)) {
        const inputs = functionInputs(target);
        let args: Array<RosettaExpression | undefined>;
        if (expression.explicitArguments) args = expression.rawArgs;
        else if (inputs.length === 1) args = [undefined];
        else if (!inputs.length) args = [];
        else throw new Error(`Function '${target.name}' requires a linked argument list`);
        if (args.length !== inputs.length)
          throw new Error(`Function '${target.name}' requires a linked argument list of ${inputs.length} inputs`);
        const values = inputs.map((parameter, index) => {
          const source = args[index];
          const text = source ? render(source, { ...context, preserveMetadata: true }) : context.self;
          return `${pyString(parameter.name)}: ${pythonArgument(text, parameter, source, context)}`;
        });
        return pythonUnwrap(
          `${context.name(target)}({${values.join(', ')}})`,
          context.preserveMetadata ? undefined : fieldMetadataKind(functionOutput(target)),
          expressionIsMany(expression)
        );
      }
      if (target.$type === 'RosettaExternalFunction' || target.$type === 'RosettaRule') {
        const parameters =
          target.$type === 'RosettaRule' ? (target.input ? [{ isArray: false }] : []) : target.parameters;
        const args = expression.explicitArguments ? expression.rawArgs : parameters.length === 1 ? [undefined] : [];
        if (args.length !== parameters.length)
          throw new Error(`Function '${target.name}' requires a linked argument list of ${parameters.length} inputs`);
        const values = args.map((item, index) => {
          const text = item ? render(item, valueContext) : argument(false);
          return parameters[index]!.isArray ? `rune.list(${text})` : `rune.single(${text})`;
        });
        return `${context.name(target)}(${values.join(', ')})`;
      }
      if (isRosettaEnumValue(target)) return pyString(target.name);
      if (isRosettaType(target)) return context.name(target);
      const self = pythonUnwrap(context.self, context.implicit?.metadata, context.implicit?.many);
      const calendar = pythonCalendarField(target, self, context.implicit?.many);
      if (calendar) return calendar;
      const name = isChoiceOption(target) ? featureName(target) : expression.symbol.$refText;
      return pythonDeclarationValue(pythonRead(self, [name], context.implicit?.many), context, expression);
    }
    case 'RosettaFeatureCall':
    case 'RosettaDeepFeatureCall':
      return pythonNavigation(expression, context, render)!;
    case 'ArithmeticOperation': {
      const left = expression.left ? render(expression.left, valueContext) : argument(false),
        right = render(expression.right, valueContext);
      const leftType = expressionType(expression.left)?.name,
        rightType = expressionType(expression.right)?.name;
      const operation =
        leftType === 'date' && rightType === 'date' && expression.operator === '-'
          ? '(rune.dateDays(a) - rune.dateDays(b))'
          : leftType === 'date' && rightType === 'time' && expression.operator === '+'
            ? 'rune.dateJoin(a, b)'
            : expression.operator === '/'
              ? 'rune.divide(a, b)'
              : `(a ${expression.operator} b)`;
      const scalar = nativeScalarOperands(expression.left, expression.right);
      if (scalar === 'number' || (scalar === 'string' && expression.operator === '+'))
        return expression.operator === '/'
          ? `rune.divide(${left}, ${right})`
          : `(${left} ${expression.operator} ${right})`;
      if (requiredScalarKind(expression.left) === 'date') {
        const rightKind = requiredScalarKind(expression.right);
        if (rightKind === 'date' && expression.operator === '-')
          return `(rune.dateDays(${left}) - rune.dateDays(${right}))`;
        if (rightKind === 'time' && expression.operator === '+') return `rune.dateJoin(${left}, ${right})`;
      }
      return `rune.binary(${left}, ${right}, lambda a, b: ${operation})`;
    }
    case 'EqualityOperation': {
      const left = expression.left ? render(expression.left, valueContext) : argument(false),
        right = render(expression.right, valueContext);
      const many = expressionIsMany(expression.left) || expressionIsMany(expression.right);
      const optional = [expression.left, expression.right].some(
        (item) =>
          item?.$type === 'RosettaSymbolReference' && isAttribute(item.symbol.ref) && item.symbol.ref.card.inf === 0
      );
      if (!expression.cardMod && !many && !optional) {
        if (nativeEqualityOperands(expression.left, expression.right))
          return pythonComparison(left, right, expression.operator === '=' ? '==' : '!=');
        return `${expression.operator === '<>' ? 'not ' : ''}rune.equals(${left}, ${right})`;
      }
      return `rune.equals(${left}, ${right}, ${pyString(expression.cardMod ?? (expression.operator === '<>' ? 'any' : 'all'))}${expression.operator === '<>' ? ', True' : ''})`;
    }
    case 'ComparisonOperation': {
      const left = expression.left ? render(expression.left, valueContext) : argument(false),
        right = render(expression.right, valueContext);
      const scalar = nativeScalarOperands(expression.left, expression.right);
      if (!expression.cardMod && (scalar === 'number' || scalar === 'string'))
        return pythonComparison(left, right, expression.operator, scalar === 'string');
      const requiredTemporal = nativeTemporalOperands(expression.left, expression.right);
      if (!expression.cardMod && requiredTemporal)
        return pythonComparison(
          `rune.temporalKey(${left}, ${pyString(requiredTemporal)})`,
          `rune.temporalKey(${right}, ${pyString(requiredTemporal)})`,
          expression.operator
        );
      const type = expressionType(expression.left ?? arg)?.name;
      const temporal = type && ['date', 'time', 'dateTime', 'zonedDateTime'].includes(type);
      const compare = pythonComparison(
        temporal ? `rune.temporalKey(a, ${pyString(type)})` : 'a',
        temporal ? `rune.temporalKey(b, ${pyString(type)})` : 'b',
        expression.operator,
        type === 'string'
      );
      return `rune.compare(${left}, ${right}, lambda a, b: ${compare}, ${pyString(expression.cardMod ?? 'all')})`;
    }
    case 'LogicalOperation':
      return `(${expression.left ? render(expression.left, valueContext) : argument(false)} ${expression.operator} ${render(expression.right, valueContext)})`;
    case 'RosettaContainsExpression':
    case 'RosettaDisjointExpression':
      return `rune.${expression.$type === 'RosettaContainsExpression' ? 'contains' : 'disjoint'}(${expression.left ? render(expression.left, valueContext) : argument(false)}, ${render(expression.right, valueContext)})`;
    case 'RosettaExistsExpression': {
      const value = argument(false);
      if (!expression.modifier) return `rune.exists(${value})`;
      return `(len(rune.list(${value})) ${expression.modifier === 'single' ? '== 1' : '> 1'})`;
    }
    case 'RosettaAbsentExpression':
      return `(not rune.exists(${argument(false)}))`;
    case 'RosettaCountOperation':
      return `len(rune.list(${argument(false)}))`;
    case 'RosettaOnlyElement':
      return `rune.only(${argument()})`;
    case 'FirstOperation':
    case 'LastOperation':
      return `rune.edge(${argument()}, ${pyBool(expression.$type === 'LastOperation')})`;
    case 'SumOperation':
      return `sum(rune.list(${argument(false)}))`;
    case 'FlattenOperation': {
      const item = pythonFresh(context, 'item'),
        child = pythonFresh(context, 'child');
      return `[${child} for ${item} in rune.list(${argument()}) for ${child} in rune.list(${item})]`;
    }
    case 'ReverseOperation':
      return `list(reversed(rune.list(${argument()})))`;
    case 'DistinctOperation':
      return `rune.distinct(${argument()}, ${pyBool(!!context.preserveMetadata && !!expressionMetadataKind(arg))})`;
    case 'FilterOperation':
    case 'MapOperation': {
      const item = pythonFresh(context, 'item');
      const preserve = !!context.preserveMetadata || !!expressionMetadataKind(arg);
      const child = pythonInline(expression.function, context, [item], arg);
      const body = expression.function
        ? render(expression.function.body, {
            ...child,
            preserveMetadata: expression.$type === 'FilterOperation' ? false : context.preserveMetadata
          })
        : pythonUnwrap(item, context.preserveMetadata ? undefined : expressionMetadataKind(arg));
      const input = argument(preserve);
      const mapped = pythonFresh(context, 'mapped');
      const result =
        expression.$type === 'FilterOperation'
          ? `[${item} for ${item} in rune.list(${input}) if ${body}]`
          : `[${mapped} for ${item} in rune.list(${input}) for ${mapped} in rune.list(${body})]`;
      return expression.$type === 'FilterOperation' && !context.preserveMetadata
        ? pythonUnwrap(result, expressionMetadataKind(arg), true)
        : result;
    }
    case 'SortOperation':
    case 'MinOperation':
    case 'MaxOperation': {
      const item = pythonFresh(context, 'item'),
        kind = expressionMetadataKind(arg);
      const child = pythonInline(expression.function, valueContext, [item], arg);
      const key = expression.function ? render(expression.function.body, child) : pythonUnwrap(item, kind);
      const result = `rune.ordered(${argument(!!kind || context.preserveMetadata)}, lambda ${item}: ${key}, ${pyString(expression.operator)})`;
      return context.preserveMetadata ? result : pythonUnwrap(result, kind, expression.$type === 'SortOperation');
    }
    case 'ReduceOperation': {
      const accumulator = pythonFresh(context, 'acc'),
        item = pythonFresh(context, 'item');
      const inputKind = expressionMetadataKind(arg),
        resultKind = expressionMetadataKind(expression.function?.body);
      const child = pythonInline(expression.function, context, [accumulator, item], arg);
      const localMetadata = new Map(child.localMetadata);
      const parameter = expression.function?.parameters[0];
      if (parameter) localMetadata.set(parameter, resultKind);
      const result = expression.function
        ? render(expression.function.body, {
            ...child,
            localMetadata,
            preserveMetadata: !!resultKind,
            implicit: { ...child.implicit!, metadata: resultKind }
          })
        : item;
      const first = pythonNormalize(item, inputKind, resultKind);
      const input =
        inputKind === 'reference' && !resultKind
          ? `[${item} for ${item} in rune.list(${argument(true)}) if rune.unwrap(${item}) is not None]`
          : argument(true);
      const reduced = `rune.reduce(${input}, lambda ${accumulator}, ${item}: ${result}, lambda ${item}: ${first})`;
      return pythonUnwrap(reduced, context.preserveMetadata ? undefined : resultKind);
    }
    case 'ThenOperation': {
      const item = pythonFresh(context, 'then');
      const child = pythonInline(expression.function, context, [item], arg, expressionIsMany(arg));
      return pythonBind(
        argument(true),
        item,
        expression.function
          ? render(expression.function.body, child)
          : pythonUnwrap(
              item,
              context.preserveMetadata ? undefined : expressionMetadataKind(arg),
              expressionIsMany(arg)
            )
      );
    }
    case 'RosettaConditionalExpression':
      if (!expression.if || !expression.ifthen) throw new Error('Conditional requires a linked predicate and branch');
      return `(${branch(expression.ifthen)} if ${render(expression.if, valueContext)} else ${expression.elsethen ? branch(expression.elsethen) : context.resultMode === 'condition' ? 'True' : 'None'})`;
    case 'ListLiteral': {
      const target = context.preserveMetadata ? expressionMetadataKind(expression) : undefined;
      const values = expression.elements.map((item) =>
        target
          ? pythonNormalize(render(item, { ...context, preserveMetadata: true }), expressionMetadataKind(item), target)
          : render(item, context)
      );
      const item = pythonFresh(context, 'item'),
        branch = pythonFresh(context, 'branch');
      return `[${item} for ${branch} in [${values.join(', ')}] for ${item} in rune.list(${branch})${target ? ` if ${item} is not None` : ''}]`;
    }
    case 'RosettaConstructorExpression': {
      const target = expression.typeRef.$type === 'RosettaSymbolReference' ? expression.typeRef.symbol.ref : undefined;
      if (!isRosettaType(target)) throw new Error('Constructor requires a linked type');
      const values = expression.values.map((pair) => {
        const feature = pair.key.ref;
        if (!feature) throw new Error(`Unresolved constructor field '${pair.key.$refText}'`);
        let value = render(pair.value, { ...context, preserveMetadata: true });
        if (isAttribute(feature)) value = pythonArgument(value, feature, pair.value, context);
        else
          value = pythonNormalize(
            value,
            expressionMetadataKind(pair.value),
            'annotations' in feature ? fieldMetadataKind(feature) : undefined
          );
        return `${pyString(isChoiceOption(feature) ? featureName(feature) : pair.key.$refText)}: ${value}`;
      });
      const object = `{${values.join(', ')}}`;
      if (isRosettaRecordType(target) && ['date', 'dateTime', 'zonedDateTime'].includes(target.name))
        return `rune.dateConstruct(${pyString(target.name)}, ${object})`;
      return isChoice(target) && !values.length ? 'None' : object;
    }
    case 'DefaultOperation': {
      const left = expression.left ? branch(expression.left) : argument(),
        right = branch(expression.right);
      return `rune.default(${left}, lambda: ${right})`;
    }
    case 'JoinOperation': {
      const separator = expression.right ? render(expression.right, valueContext) : '""';
      const item = pythonFresh(context, 'item');
      const boundSeparator = pythonFresh(context, 'separator');
      return pythonBind(
        separator,
        boundSeparator,
        `("," if ${boundSeparator} is None else rune.string(${boundSeparator})).join("" if ${item} is None else rune.string(${item}) for ${item} in rune.list(${expression.left ? render(expression.left, valueContext) : argument(false)}))`
      );
    }
    case 'ToStringOperation':
      return `rune.toString(${argument(false)})`;
    case 'ToNumberOperation':
    case 'ToIntOperation':
      return `rune.number(${argument(false)}, ${pyBool(expression.$type === 'ToIntOperation')})`;
    case 'ToEnumOperation': {
      const enumeration = expression.enumeration.ref;
      if (!enumeration) throw new Error(`Unresolved enum '${expression.enumeration.$refText}'`);
      const value = pythonFresh(context, 'enum');
      return pythonBind(
        argument(false),
        value,
        `${value} if ${value} in [${getEnumValues(enumeration)
          .map((item) => pyString(item.name))
          .join(', ')}] else None`
      );
    }
    case 'ToDateOperation':
    case 'ToTimeOperation':
    case 'ToDateTimeOperation':
    case 'ToZonedDateTimeOperation': {
      const kinds = {
        ToDateOperation: 'date',
        ToTimeOperation: 'time',
        ToDateTimeOperation: 'dateTime',
        ToZonedDateTimeOperation: 'zonedDateTime'
      };
      const kind = kinds[expression.$type] as keyof typeof TEMPORAL_CONVERSION_PATTERNS;
      return `rune.convertTemporal(${argument(false)}, ${pyString(TEMPORAL_CONVERSION_PATTERNS[kind])})`;
    }
    case 'AsKeyOperation': {
      const value = `rune.asKey(${argument(true)}, ${pyString(expressionMetadataKind(arg) ?? 'value')})`;
      return context.preserveMetadata ? value : pythonUnwrap(value, 'reference', expressionIsMany(expression));
    }
    case 'WithMetaOperation': {
      const source = arg?.$type === 'ListLiteral' && !arg.elements.length ? 'None' : argument(true);
      const entries = expression.entries.map((entry) => {
        const name = entry.key.$refText;
        const property = ['key', 'template', 'address', 'reference'].includes(name)
          ? name
          : metadataPropertyPath(name).slice(-1)[0]!;
        return `${pyString(property)}: ${render(entry.value, valueContext)}`;
      });
      const value = `rune.withMeta(${source}, {${entries.join(', ')}}, ${pyString(expressionMetadataKind(arg) ?? 'value')})`;
      return context.preserveMetadata
        ? value
        : pythonUnwrap(value, expressionMetadataKind(expression), expressionIsMany(expression));
    }
    case 'OneOfOperation':
    case 'ChoiceOperation': {
      const root = pythonFresh(context, 'choice'),
        type = arg ? expressionType(arg) : context.implicit?.type;
      const fields = arg ? typeFeatures(type) : pythonRootFields(context);
      const bindings = new Map(fields.map((field) => [featureName(field), field]));
      const names =
        expression.$type === 'ChoiceOperation'
          ? expression.attributes.map((ref) => (isChoiceOption(ref.ref) ? featureName(ref.ref) : ref.$refText))
          : fields.map(featureName);
      const values =
        names.length || !arg
          ? `[${names
              .map((name) => {
                const field = bindings.get(name);
                return !arg && field
                  ? pythonReadField(root, field, context.locals.get(field))
                  : pythonRead(root, [name]);
              })
              .join(', ')}]`
          : `rune.list(${root})`;
      const value = pythonFresh(context, 'value');
      const count = `sum(1 for ${value} in ${values} if rune.exists(${value}))`;
      const predicate = `${count} ${expression.$type === 'ChoiceOperation' && expression.necessity === 'optional' ? '<= 1' : '== 1'}`;
      return pythonBind(
        argument(false),
        root,
        expression.$type === 'ChoiceOperation' && expression.argument
          ? `${root} is not None and (${predicate})`
          : predicate
      );
    }
    case 'RosettaOnlyExistsExpression':
      return pythonOnlyExists(expression, context, render)!;
    case 'AsOperation': {
      const input = expressionType(arg),
        target = expression.type.ref;
      if (!isRosettaType(input) || !target) throw new Error('Narrowing requires a linked source and target type');
      const name = pythonFresh(context, 'as'),
        kind = expressionMetadataKind(arg);
      const selected = pythonTypeSelection(pythonUnwrap(name, kind), input, target, true);
      const value = selected.projected ? selected.selected : name;
      const single = `${value} if ${selected.guard} else None`;
      const mapped = pythonFresh(context, 'selected');
      const result = expressionIsMany(expression)
        ? `[${mapped} for ${name} in rune.list(${argument(true)}) for ${mapped} in rune.list(${single})]`
        : pythonBind(argument(true), name, single);
      return context.preserveMetadata
        ? result
        : pythonUnwrap(result, expressionMetadataKind(expression), expressionIsMany(expression));
    }
    case 'SwitchOperation': {
      const name = pythonFresh(context, 'switch'),
        input = expressionType(arg),
        kind = expressionMetadataKind(arg);
      const selector = pythonUnwrap(name, kind),
        fallback = expression.cases.find((item) => !item.guard);
      const childContext = {
        ...context,
        self: name,
        implicit: { expression: arg, name, metadata: kind, ...(input ? { type: input } : {}) }
      };
      const switchBranch = (child: RosettaExpression, ctx: PythonRenderContext) => {
        const target = context.preserveMetadata ? expressionMetadataKind(expression) : undefined;
        const text = render(child, { ...ctx, preserveMetadata: !!target });
        return target ? pythonNormalize(text, expressionMetadataKind(child), target) : text;
      };
      const fallbackValue = fallback ? switchBranch(fallback.expression, childContext) : 'None';
      const branches: string[] = [];
      for (const current of expression.cases) {
        if (!current.guard) continue;
        const target = current.guard.referenceGuard?.ref;
        if (input && (isChoice(input) || input.$type === 'Data')) {
          if (!isRosettaType(target)) throw new Error('Switch requires a linked type guard');
          const selection = pythonTypeSelection(selector, input, target);
          const item = pythonFresh(context, 'selected');
          const value = selection.projected ? selection.selected : name;
          const child = {
            ...childContext,
            self: item,
            implicit: { name: item, type: target, metadata: selection.projected ? selection.metadata : kind }
          };
          branches.push(
            `(lambda: ${selection.guard}, lambda: ${pythonBind(value, item, switchBranch(current.expression, child))})`
          );
        } else {
          const guard = current.guard.literalGuard
            ? render(current.guard.literalGuard, valueContext)
            : isRosettaEnumValue(target)
              ? pyString(target.name)
              : undefined;
          if (!guard) throw new Error('Unresolved switch guard');
          branches.push(
            `(lambda: rune.equals(${selector}, ${guard}), lambda: ${switchBranch(current.expression, childContext)})`
          );
        }
      }
      const guard = pythonFresh(context, 'guard'),
        body = pythonFresh(context, 'branch');
      return pythonBind(
        argument(true),
        name,
        `next((${body} for ${guard}, ${body} in [${branches.join(', ')}] if ${guard}()), lambda: ${fallbackValue})()`
      );
    }
    case 'RosettaSuperCall': {
      const parent = context.superFunction;
      if (!parent) throw new Error('super() requires a parent function binding');
      const inputs = functionInputs(parent);
      if (expression.explicitArguments && expression.rawArgs.length !== inputs.length)
        throw new Error('super() requires a linked argument list');
      const values = inputs.map((parameter, index) => {
        const source = expression.rawArgs[index];
        const value =
          expression.explicitArguments && source
            ? render(source, { ...context, preserveMetadata: true })
            : (context.locals.get(parameter) ?? pythonRead(context.self, [parameter.name]));
        return `${pyString(parameter.name)}: ${pythonArgument(value, parameter, source, context)}`;
      });
      return pythonUnwrap(
        `${context.name(parent)}({${values.join(', ')}})`,
        context.preserveMetadata ? undefined : fieldMetadataKind(functionOutput(parent)),
        expressionIsMany(expression)
      );
    }
    default:
      throw new Error(`Unknown Python expression kind: ${(expression as RosettaExpression).$type}`);
  }
}
