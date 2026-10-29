// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import {
  getFunctionInputs,
  getNodeSourceRegion,
  getOperationArgument,
  isAttribute,
  isChoiceOption,
  isInlineFunction,
  isRosettaImplicitVariable,
  isRosettaEnumValue,
  isRosettaSymbolReference,
  isRosettaRecordFeature,
  isRosettaType,
  type InlineFunction,
  type RosettaExpression,
  type RosettaFunction,
  type SwitchOperation
} from '@rune-langium/core';
import { AstUtils, type AstNode } from 'langium';
import {
  expressionIsMany,
  expressionType,
  featureIsMany,
  featureName,
  renderCalendarField,
  typeFeatures,
  type ExpressionType
} from '../expr/navigation.js';
import { expressionIsPresent } from '../expr/scalar-operators.js';
import type { ProjectionOrigin } from './types.js';
import { renderExpression } from '../emit/rosetta/render-expression.js';
import { onlyExistsSelection } from '../expr/only-exists.js';

export interface SourceTypeScriptOptions {
  owner?: RosettaFunction;
  trackOrigins?: boolean;
}

export interface SourceTypeScriptExpression {
  code: string;
  /** Statements belong to the expression's evaluation scope, never a function-wide hoist. */
  statements: string[];
  origin: ProjectionOrigin;
}

interface Value {
  code: string;
  precedence: number;
}

interface Scope {
  self?: Value;
  type?: ExpressionType;
  bindings: ReadonlyMap<AstNode, Value>;
  names?: ReadonlySet<string>;
}

const atom = (code: string): Value => ({ code, precedence: 11 });
const parenthesize = (value: Value, precedence: number, right = false) =>
  value.precedence < precedence || (right && value.precedence === precedence) ? `(${value.code})` : value.code;
const referenceName = (reference: { $refText?: string; ref?: AstNode } | undefined): string => {
  if (reference?.$refText) return reference.$refText;
  const target = reference?.ref;
  if (isAttribute(target) || isChoiceOption(target) || isRosettaRecordFeature(target)) return featureName(target);
  return target && 'name' in target && typeof target.name === 'string' ? target.name : '?';
};

/** A syntax backend over canonical linked facts; this text is not executable export code. */
export function renderSourceTypeScriptExpression(
  expression: RosettaExpression,
  options: SourceTypeScriptOptions = {}
): SourceTypeScriptExpression {
  return new SourceExpressionRenderer(options).render(expression);
}

export class SourceExpressionRenderer {
  private readonly names = new Set<string>();
  private readonly authoredNames = new Set<string>();
  private statements: string[] = [];
  private scope?: Scope;
  private fragments: { node: RosettaExpression; code: string }[] = [];

  constructor(private readonly options: SourceTypeScriptOptions) {
    if (options.owner) {
      for (const input of getFunctionInputs(options.owner)) this.names.add(input.name);
      if (options.owner.output) this.names.add(options.owner.output.name);
      for (const alias of options.owner.shortcuts) this.names.add(alias.name);
    }
    for (const name of this.names) this.authoredNames.add(name);
  }

  render(expression: RosettaExpression): SourceTypeScriptExpression {
    this.fragments = [];
    if (!this.options.owner)
      for (const node of AstUtils.streamAst(expression)) {
        if (isRosettaSymbolReference(node)) {
          const name = referenceName(node.symbol);
          this.names.add(name);
          this.authoredNames.add(name);
        }
      }
    const frame = this.capture(() => this.value(expression, { bindings: new Map() }));
    let root: ReturnType<typeof getNodeSourceRegion> | undefined;
    try {
      root = getNodeSourceRegion(expression);
    } catch {
      /* Older serialized bundles have no source coordinates. */
    }
    const rune = expression.$cstNode?.text ?? renderExpression(expression);
    const fragments = this.fragments.flatMap(({ node, code }) => {
      if (!root || !expression.$cstNode) return [];
      try {
        const region = getNodeSourceRegion(node);
        const from = region.from - root.from,
          to = region.to - root.from;
        return from >= 0 && to <= rune.length && to > from ? [{ code, from, to, kind: node.$type }] : [];
      } catch {
        return [];
      }
    });
    return {
      code: frame.value.code,
      statements: frame.statements,
      origin: { code: [...frame.statements, frame.value.code].join('\n'), rune, fragments }
    };
  }

  switchStatements(expression: SwitchOperation, target?: string): string[] {
    const frame = this.capture(() => {
      this.emitSwitch(expression, { bindings: new Map() }, target);
      return atom('');
    });
    return frame.statements;
  }

  private capture(render: () => Value): { value: Value; statements: string[] } {
    const parent = this.statements;
    this.statements = [];
    try {
      const value = render();
      return { value, statements: this.statements };
    } finally {
      this.statements = parent;
    }
  }

  private parameter(scope: Scope, preferred = 'item'): string {
    let name = preferred;
    let index = 1;
    while (this.names.has(name) || scope.names?.has(name)) name = `${preferred}${index++}`;
    return name;
  }

  private fresh(preferred = 'item'): string {
    let name = preferred;
    let index = 1;
    while (this.names.has(name) || this.scope?.names?.has(name)) name = `${preferred}${index++}`;
    this.names.add(name);
    return name;
  }

  private intrinsic(name: string, args: string[]): Value {
    const shadowed = this.authoredNames.has(name) || this.scope?.names?.has(name);
    const runeShadowed = this.authoredNames.has('rune') || this.scope?.names?.has('rune');
    const qualifier = shadowed ? (runeShadowed ? '$rune.' : 'rune.') : '';
    return atom(`${qualifier}${name}(${args.join(', ')})`);
  }

  private argument(expression: RosettaExpression): RosettaExpression | undefined {
    return getOperationArgument(expression);
  }

  private receiver(expression: RosettaExpression, scope: Scope): Value {
    const argument = this.argument(expression);
    return argument ? this.value(argument, scope) : (scope.self ?? atom('item'));
  }

  private inlineScope(fn: InlineFunction, argument: RosettaExpression | undefined, value: Value, scope: Scope): Scope {
    const bindings = new Map(scope.bindings);
    for (const parameter of fn.parameters) bindings.set(parameter, value);
    return { self: value, type: expressionType(argument), bindings };
  }

  private lambda(fn: InlineFunction | undefined, argument: RosettaExpression | undefined, scope: Scope): string {
    if (!fn) throw new Error('An inline function body is required for this projection.');
    const parameters = fn.parameters.length
      ? fn.parameters.map((parameter) => parameter.name)
      : [this.parameter(scope)];
    const bindings = new Map(scope.bindings);
    fn.parameters.forEach((parameter, index) => bindings.set(parameter, atom(parameters[index]!)));
    const childScope = {
      self: atom(parameters[0]!),
      type: expressionType(argument),
      bindings,
      names: new Set([...(scope.names ?? []), ...parameters])
    };
    const body = this.capture(() => this.value(fn.body, childScope));
    const names = parameters.length === 1 ? parameters[0]! : `(${parameters.join(', ')})`;
    return `${names} => ${
      body.statements.length
        ? `{\n${[...body.statements, `return ${body.value.code};`].map((line) => `  ${line}`).join('\n')}\n}`
        : body.value.code
    }`;
  }

  private method(receiver: Value, name: string, args: string[] = []): Value {
    return atom(`${parenthesize(receiver, 10)}.${name}(${args.join(', ')})`);
  }

  private literal(expression: RosettaExpression | undefined): boolean {
    return (
      !!expression &&
      ['RosettaBooleanLiteral', 'RosettaIntLiteral', 'RosettaNumberLiteral', 'RosettaStringLiteral'].includes(
        expression.$type
      )
    );
  }

  private simple(expression: RosettaExpression | undefined): boolean {
    return (
      this.literal(expression) ||
      (isRosettaSymbolReference(expression) &&
        !expression.explicitArguments &&
        !['RosettaFunction', 'RosettaExternalFunction', 'RosettaRule'].includes(expression.symbol.ref?.$type ?? ''))
    );
  }

  private freeze(value: Value, preferred = 'item'): Value {
    const name = this.fresh(preferred);
    this.statements.push(`const ${name} = ${value.code};`);
    return atom(name);
  }

  private ordered(
    expressions: readonly (RosettaExpression | undefined)[],
    scope: Scope,
    preferred: readonly string[] = []
  ): Value[] {
    const frames = expressions.map((expression, index) =>
      this.capture(() => (expression ? this.value(expression, scope, preferred[index]) : (scope.self ?? atom('item'))))
    );
    return frames.map((frame, index) => {
      this.statements.push(...frame.statements);
      return frames.slice(index + 1).some((next) => next.statements.length) && !this.literal(expressions[index])
        ? this.freeze(frame.value, preferred[index] ?? 'argument')
        : frame.value;
    });
  }

  private inlineUses(fn: InlineFunction): number {
    return [...AstUtils.streamAst(fn.body)].filter((node) => {
      if (isRosettaSymbolReference(node))
        return !!node.symbol.ref && fn.parameters.some((parameter) => parameter === node.symbol.ref);
      if (!isRosettaImplicitVariable(node)) return false;
      let owner: AstNode | undefined = node.$container;
      while (owner && !isInlineFunction(owner)) owner = owner.$container;
      return owner === fn;
    }).length;
  }

  private emitSwitch(expression: SwitchOperation, scope: Scope, target?: string): void {
    const argument = this.argument(expression);
    const receiver = this.receiver(expression, scope);
    const usesItem = expression.cases.some((branch) =>
      [...AstUtils.streamAst(branch.expression)].some((node) => {
        if (!isRosettaImplicitVariable(node)) return false;
        let owner: AstNode | undefined = node.$container;
        while (owner && owner !== expression && !isInlineFunction(owner)) owner = owner.$container;
        return owner === expression;
      })
    );
    const needsBinding = usesItem || !isRosettaSymbolReference(argument) || argument.explicitArguments;
    const selector = needsBinding ? this.fresh() : receiver.code;
    if (needsBinding) this.statements.push(`const ${selector} = ${receiver.code};`);
    this.statements.push(`switch (${selector}) {`);
    for (const branch of expression.cases) {
      const guard = branch.guard;
      const reference = guard?.referenceGuard?.ref;
      const label = guard?.literalGuard
        ? this.value(guard.literalGuard, scope).code
        : isRosettaEnumValue(reference)
          ? `${reference.$container.name}.${reference.name}`
          : guard?.referenceGuard
            ? referenceName(guard.referenceGuard)
            : undefined;
      this.statements.push(label === undefined ? '  default:' : `  case ${label}:`);
      const child: Scope = {
        ...scope,
        self: atom(selector),
        type: isRosettaType(reference) ? reference : expressionType(argument)
      };
      const frame = this.capture(() => this.value(branch.expression, child));
      this.statements.push(
        ...frame.statements.map((line) => `    ${line}`),
        target ? `    ${target} = ${frame.value.code};` : `    return ${frame.value.code};`
      );
      if (target) this.statements.push('    break;');
    }
    this.statements.push('}');
  }

  private value(expression: RosettaExpression | undefined, scope: Scope, preferred?: string): Value {
    const parent = this.scope;
    this.scope = scope;
    try {
      const value = this.valueImpl(expression, scope, preferred);
      if (expression && this.options.trackOrigins !== false)
        this.fragments.push({ node: expression, code: value.code });
      return value;
    } finally {
      this.scope = parent;
    }
  }

  private valueImpl(expression: RosettaExpression | undefined, scope: Scope, preferred?: string): Value {
    if (!expression) throw new Error('A source expression is required for this projection.');
    switch (expression.$type) {
      case 'RosettaBooleanLiteral':
        return atom(String(expression.value));
      case 'RosettaIntLiteral':
      case 'RosettaNumberLiteral':
        return atom(String(expression.value));
      case 'RosettaStringLiteral':
        return atom(JSON.stringify(expression.value));
      case 'RosettaImplicitVariable':
        return scope.self ?? atom('item');
      case 'RosettaSymbolReference': {
        const target = expression.symbol.ref;
        const bound = target && scope.bindings.get(target);
        if (bound) return bound;
        const name = referenceName(expression.symbol);
        if (isRosettaEnumValue(target)) return atom(`${target.$container.name}.${target.name}`);
        if (
          (isAttribute(target) || isChoiceOption(target) || isRosettaRecordFeature(target)) &&
          scope.self &&
          typeFeatures(scope.type).includes(target)
        )
          return featureName(target) === '_'
            ? this.method(scope.self, 'field', [JSON.stringify('_')])
            : atom(`${parenthesize(scope.self, 10)}.${featureName(target)}`);
        if (expression.explicitArguments)
          return atom(
            `${name}(${this.ordered(expression.rawArgs, scope)
              .map((argument) => argument.code)
              .join(', ')})`
          );
        return atom(name);
      }
      case 'RosettaFeatureCall':
      case 'RosettaDeepFeatureCall': {
        const receiver = this.value(expression.receiver, scope);
        const feature = expression.feature?.ref;
        const name = referenceName(expression.feature);
        if (isRosettaEnumValue(feature)) return atom(`${receiver.code}.${feature.name}`);
        if (expression.$type === 'RosettaDeepFeatureCall') {
          return atom(`${parenthesize(receiver, 10)}._.${name}`);
        }
        if (expressionIsMany(expression.receiver)) {
          const item = this.parameter(scope);
          const calendar = renderCalendarField(feature, () => item, false, true, true, undefined, true);
          const many =
            isAttribute(feature) || isChoiceOption(feature) || isRosettaRecordFeature(feature)
              ? featureIsMany(feature)
              : false;
          return this.method(receiver, many ? 'flatMap' : 'map', [
            `${item} => ${calendar ?? (name === '_' ? `${item}.field("_")` : `${item}.${name}`)}`
          ]);
        }
        if (name === '_') return this.method(receiver, 'field', [JSON.stringify(name)]);
        const present = expressionIsPresent(expression.receiver);
        const calendar = renderCalendarField(feature, () => receiver.code, false, true, present, undefined, true);
        return atom(calendar ?? `${parenthesize(receiver, 10)}${present ? '.' : '?.'}${name}`);
      }
      case 'ArithmeticOperation':
      case 'ComparisonOperation':
      case 'EqualityOperation':
      case 'LogicalOperation': {
        let left = expression.left ? this.value(expression.left, scope) : (scope.self ?? atom('item'));
        const rightFrame = this.capture(() => this.value(expression.right, scope));
        let right = rightFrame.value;
        const operator =
          expression.operator === '='
            ? '=='
            : expression.operator === '<>'
              ? '!='
              : expression.operator === 'and'
                ? '&&'
                : expression.operator === 'or'
                  ? '||'
                  : expression.operator;
        const precedence =
          operator === '||'
            ? 3
            : operator === '&&'
              ? 4
              : operator === '==' || operator === '!='
                ? 5
                : ['<', '<=', '>', '>='].includes(operator)
                  ? 6
                  : operator === '+' || operator === '-'
                    ? 7
                    : 8;
        if ((operator === '&&' || operator === '||') && rightFrame.statements.length) {
          if (!this.simple(expression.left)) left = this.freeze(left, 'left');
          const name = this.fresh('logical');
          this.statements.push(
            `let ${name};`,
            `if (${operator === '&&' ? left.code : `!(${left.code})`}) {`,
            ...rightFrame.statements.map((line) => `  ${line}`),
            `  ${name} = ${right.code};`,
            '} else {',
            `  ${name} = ${left.code};`,
            '}'
          );
          return atom(name);
        }
        if (rightFrame.statements.length && !this.literal(expression.left)) left = this.freeze(left, 'left');
        this.statements.push(...rightFrame.statements);
        if ('cardMod' in expression && expression.cardMod) {
          if (!this.simple(expression.right)) {
            if (!this.simple(expression.left)) left = this.freeze(left, 'left');
            right = this.freeze(right, 'right');
          }
          const method = expression.cardMod === 'all' ? 'every' : 'some';
          const item = this.parameter(scope);
          if (expressionIsMany(expression.right)) {
            if (expression.$type === 'EqualityOperation') {
              const index = this.parameter({ ...scope, names: new Set([...(scope.names ?? []), item]) }, 'index');
              return this.method(left, method, [
                `(${item}, ${index}) => ${item} ${operator} ${parenthesize(right, 10)}[${index}]`
              ]);
            }
            const other = this.parameter({ ...scope, names: new Set([...(scope.names ?? []), item]) });
            return this.method(left, method, [
              `${item} => ${this.method(right, method, [`${other} => ${item} ${operator} ${other}`]).code}`
            ]);
          }
          return this.method(left, method, [`${item} => ${item} ${operator} ${right.code}`]);
        }
        return {
          code: `${parenthesize(left, precedence)} ${operator} ${parenthesize(right, precedence, true)}`,
          precedence
        };
      }
      case 'MapOperation':
      case 'FilterOperation': {
        const argument = this.argument(expression);
        let receiver = this.receiver(expression, scope);
        const fn = expression.function;
        if (!fn) return receiver;
        if (!expressionIsMany(argument)) {
          const uses = this.inlineUses(fn);
          if (
            argument &&
            expressionIsPresent(argument) &&
            !this.simple(argument) &&
            (expression.$type === 'FilterOperation' || uses > 1)
          )
            receiver = this.freeze(receiver);
          if (expression.$type === 'MapOperation' && argument && expressionIsPresent(argument) && uses > 0)
            return this.value(fn.body, this.inlineScope(fn, argument, receiver, scope));
          if (expression.$type === 'FilterOperation' && argument && expressionIsPresent(argument)) {
            const predicate = this.value(fn.body, this.inlineScope(fn, argument, receiver, scope));
            return { code: `${parenthesize(predicate, 2)} ? ${receiver.code} : null`, precedence: 1 };
          }
          return this.intrinsic(expression.$type === 'MapOperation' ? 'extract' : 'filter', [
            receiver.code,
            this.lambda(fn, argument, scope)
          ]);
        }
        return this.method(receiver, expression.$type === 'MapOperation' ? 'map' : 'filter', [
          this.lambda(fn, argument, scope)
        ]);
      }
      case 'SortOperation':
      case 'MinOperation':
      case 'MaxOperation': {
        const method =
          expression.$type === 'SortOperation' ? 'sort' : expression.$type === 'MinOperation' ? 'min' : 'max';
        return this.method(
          this.receiver(expression, scope),
          method,
          expression.function ? [this.lambda(expression.function, this.argument(expression), scope)] : []
        );
      }
      case 'FirstOperation':
      case 'LastOperation':
      case 'SumOperation':
      case 'RosettaCountOperation':
      case 'DistinctOperation':
      case 'ReverseOperation':
      case 'FlattenOperation':
      case 'RosettaOnlyElement': {
        const names = {
          FirstOperation: 'first',
          LastOperation: 'last',
          SumOperation: 'sum',
          RosettaCountOperation: 'count',
          DistinctOperation: 'distinct',
          ReverseOperation: 'reverse',
          FlattenOperation: 'flat',
          RosettaOnlyElement: 'onlyElement'
        };
        return this.method(this.receiver(expression, scope), names[expression.$type]);
      }
      case 'RosettaExistsExpression': {
        const selection = this.argument(expression);
        if (!expression.modifier && selection?.$type === 'AsOperation') {
          const source = this.argument(selection);
          const receiver = this.receiver(selection, scope);
          const type = referenceName(selection.type);
          if (expressionIsMany(source)) {
            const item = this.parameter(scope);
            return this.method(receiver, 'some', [`${item} => ${item} instanceof ${type}`]);
          }
          return { code: `${parenthesize(receiver, 6)} instanceof ${type}`, precedence: 6 };
        }
        return this.intrinsic(
          expression.modifier === 'single'
            ? 'singleExists'
            : expression.modifier === 'multiple'
              ? 'multipleExists'
              : 'exists',
          [this.receiver(expression, scope).code]
        );
      }
      case 'RosettaAbsentExpression':
        return { code: `!${this.intrinsic('exists', [this.receiver(expression, scope).code]).code}`, precedence: 9 };
      case 'RosettaContainsExpression':
      case 'RosettaDisjointExpression':
        return this.method(
          expression.left ? this.value(expression.left, scope) : (scope.self ?? atom('item')),
          expression.$type === 'RosettaDisjointExpression'
            ? 'isDisjointFrom'
            : expressionIsMany(expression.right)
              ? 'isSupersetOf'
              : 'has',
          [this.value(expression.right, scope).code]
        );
      case 'ListLiteral': {
        const values = this.ordered(expression.elements, scope);
        return expression.elements.length
          ? atom(
              `[${expression.elements
                .map((element, index) => `${expressionIsMany(element) ? '...' : ''}${values[index]!.code}`)
                .join(', ')}]`
            )
          : atom('null');
      }
      case 'RosettaConstructorExpression': {
        const type = this.value(expression.typeRef, scope).code;
        const typeArguments = expression.constructorTypeArgs.map(
          (argument) => `${referenceName(argument.parameter)}: ${this.value(argument.value, scope).code}`
        );
        const typeOptions = typeArguments.length ? `, { ${typeArguments.join(', ')} }` : '';
        const values = this.ordered(
          expression.values.map((pair) => pair.value),
          scope,
          expression.values.map((pair) => referenceName(pair.key))
        );
        const fields = expression.values.map((pair, index) => {
          const name = referenceName(pair.key);
          const value = values[index]!.code;
          return name === value ? name : `${name}: ${value}`;
        });
        const object = fields.length ? `{ ${fields.join(', ')} }` : '{}';
        return expression.implicitEmpty
          ? this.intrinsic('partial', [
              type,
              object,
              ...(typeArguments.length ? [`{ ${typeArguments.join(', ')} }`] : [])
            ])
          : atom(`${type}(${object}${typeOptions})`);
      }
      case 'ToStringOperation':
      case 'ToNumberOperation':
      case 'ToIntOperation':
      case 'ToDateOperation':
      case 'ToTimeOperation':
      case 'ToDateTimeOperation':
      case 'ToZonedDateTimeOperation': {
        const names = {
          ToStringOperation: 'String',
          ToNumberOperation: 'Number',
          ToIntOperation: 'int',
          ToDateOperation: 'date',
          ToTimeOperation: 'time',
          ToDateTimeOperation: 'dateTime',
          ToZonedDateTimeOperation: 'zonedDateTime'
        };
        return this.intrinsic(names[expression.$type], [this.receiver(expression, scope).code]);
      }
      case 'ToEnumOperation':
        return atom(`${referenceName(expression.enumeration)}[${this.receiver(expression, scope).code}]`);
      case 'DefaultOperation': {
        const left = expression.left ? this.value(expression.left, scope) : (scope.self ?? atom('item'));
        const frame = this.capture(() => this.value(expression.right, scope));
        const right = frame.value;
        if (frame.statements.length) {
          const name = this.fresh('defaultValue');
          this.statements.push(
            `let ${name} = ${left.code};`,
            `if (!${this.intrinsic('exists', [name]).code}) {`,
            ...frame.statements.map((line) => `  ${line}`),
            `  ${name} = ${right.code};`,
            '}'
          );
          return atom(name);
        }
        const operand = (value: Value) =>
          value.precedence === 3 || value.precedence === 4 ? `(${value.code})` : parenthesize(value, 2);
        return { code: `${operand(left)} ?? ${operand(right)}`, precedence: 2 };
      }
      case 'RosettaConditionalExpression': {
        const condition = this.value(expression.if, scope);
        const yes = this.capture(() => this.value(expression.ifthen, scope));
        const no = this.capture(() => (expression.elsethen ? this.value(expression.elsethen, scope) : atom('null')));
        if (!yes.statements.length && !no.statements.length)
          return { code: `${parenthesize(condition, 2)} ? ${yes.value.code} : ${no.value.code}`, precedence: 1 };
        const name = this.fresh('conditional');
        this.statements.push(
          `let ${name};`,
          `if (${condition.code}) {`,
          ...yes.statements.map((line) => `  ${line}`),
          `  ${name} = ${yes.value.code};`,
          '} else {',
          ...no.statements.map((line) => `  ${line}`),
          `  ${name} = ${no.value.code};`,
          '}'
        );
        return atom(name);
      }
      case 'ThenOperation':
        return expression.function
          ? this.intrinsic('then', [
              this.receiver(expression, scope).code,
              this.lambda(expression.function, this.argument(expression), scope)
            ])
          : this.receiver(expression, scope);
      case 'AsOperation':
        return {
          code: `${parenthesize(this.receiver(expression, scope), 6)} as ${referenceName(expression.type)}`,
          precedence: 6
        };
      case 'AsKeyOperation':
        return this.intrinsic('asKey', [this.receiver(expression, scope).code]);
      case 'WithMetaOperation': {
        const values = this.ordered(
          [this.argument(expression), ...expression.entries.map((entry) => entry.value)],
          scope
        );
        const receiver = values[0]!;
        const entries = expression.entries.map((entry, index) => {
          const name = referenceName(entry.key);
          const value = values[index + 1]!.code;
          return name === value ? name : `${name}: ${value}`;
        });
        return this.intrinsic('withMeta', [receiver.code, `{ ${entries.join(', ')} }`]);
      }
      case 'OneOfOperation':
        return this.intrinsic('oneOf', [this.receiver(expression, scope).code]);
      case 'ChoiceOperation': {
        const item = this.parameter(scope);
        return this.intrinsic('choice', [
          this.receiver(expression, scope).code,
          `${item} => [${expression.attributes.map((attribute) => `${item}.${referenceName(attribute)}`).join(', ')}]`,
          JSON.stringify(expression.necessity)
        ]);
      }
      case 'RosettaOnlyExistsExpression': {
        const selection = onlyExistsSelection(
          expression,
          typeFeatures(scope.type).map(featureName),
          (node) => this.value(node, scope).code
        );
        if (!selection) throw new Error('Only-exists requires fields with a common parent.');
        const item = this.parameter(scope);
        return this.intrinsic('onlyExists', [
          selection.parentText ?? scope.self?.code ?? 'item',
          `${item} => [${selection.selected.map((name) => `${item}.${name}`).join(', ')}]`
        ]);
      }
      case 'SwitchOperation': {
        const name = this.fresh(preferred ?? 'switchValue');
        this.statements.push(`let ${name};`);
        this.emitSwitch(expression, scope, name);
        return atom(name);
      }
      case 'RosettaSuperCall':
        return atom(
          `super(${
            expression.explicitArguments
              ? this.ordered(expression.rawArgs, scope)
                  .map((arg) => arg.code)
                  .join(', ')
              : ''
          })`
        );
      case 'ReduceOperation':
        return expression.function
          ? this.method(this.receiver(expression, scope), 'reduce', [
              this.lambda(expression.function, this.argument(expression), scope)
            ])
          : this.receiver(expression, scope);
      case 'JoinOperation':
        return this.method(
          this.receiver(expression, scope),
          'join',
          expression.right ? [this.value(expression.right, scope).code] : []
        );
      default:
        return this.unsupported(expression);
    }
  }

  private unsupported(expression: AstNode): never {
    throw new Error(`Source projection does not support ${expression.$type}.`);
  }
}
