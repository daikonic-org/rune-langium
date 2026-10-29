// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { parseExpression, type RosettaExpression } from '@rune-langium/core';
import type { Node } from 'web-tree-sitter';
import {
  renderSourceTypeScriptExpression,
  type SourceTypeScriptOptions
} from '../../projection/source-typescript-expression.js';
import type { ProjectionOrigin } from '../../projection/types.js';
import type { LensResult } from '../language-lens.js';
import { OutOfSubset, field, refusal } from '../parse-helpers.js';
import { createTsParser, type WasmSource } from './ts-grammar-loader.js';
import { isRuneValidId } from '../valid-id.js';

/** Statement lifting remains a generated view; expression edits use this shared syntax backend. */
export function renderSourceTs(expression: RosettaExpression, options?: SourceTypeScriptOptions): string | null {
  try {
    const projection = renderSourceTypeScriptExpression(expression, options);
    return projection.statements.length ? null : projection.code;
  } catch {
    return null;
  }
}

function strip(node: Node): Node {
  return node.type === 'parenthesized_expression' ? strip(node.namedChildren[0]!) : node;
}
function fingerprint(node: Node): string {
  node = strip(node);
  if (node.type === 'arrow_function') {
    const parameter = node.childForFieldName('parameter');
    const parameters = parameter
      ? [parameter]
      : field(node, 'parameters').namedChildren.map((part) => part.namedChildren[0] ?? part);
    return `arrow(${parameters.map(fingerprint).join(',')};${fingerprint(field(node, 'body'))})`;
  }
  if (node.type === 'string') return `string:${JSON.stringify(stringValue(node))}`;
  return node.children.length
    ? `${node.type}(${node.children
        .filter((child) => child.type !== 'comment')
        .map(fingerprint)
        .join(',')})`
    : `${node.type}:${node.text}`;
}
function stringValue(node: Node): string {
  // Decode string tokens without evaluating any user code.
  const text = node.text.slice(1, -1);
  return text.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
    (_, point: string, unicode: string, hex: string, escaped: string) => {
      if (point || unicode || hex) return String.fromCodePoint(parseInt(point || unicode || hex, 16));
      return (
        (
          { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r': '' } as Record<
            string,
            string
          >
        )[escaped] ?? escaped
      );
    }
  );
}
function id(node: Node): string {
  if (!isRuneValidId(node.text)) throw new OutOfSubset('Expected a Rune identifier.', node);
  return node.text;
}
function qualified(node: Node): string {
  if (!node.text.split('.').every(isRuneValidId)) throw new OutOfSubset('Expected a qualified Rune name.', node);
  return node.text;
}
function expressionNode(root: Node): Node {
  const children = root.namedChildren.filter((node) => node.type !== 'comment');
  if (children.length !== 1 || children[0]?.type !== 'expression_statement')
    throw new OutOfSubset('Expected one source-facing expression; edit statements in Rune source.', root);
  return strip(children[0]!.namedChildren[0]!);
}

const zeroMethods: Record<string, string> = {
  first: 'first',
  last: 'last',
  count: 'count',
  sum: 'sum',
  distinct: 'distinct',
  reverse: 'reverse',
  flat: 'flatten',
  onlyElement: 'only-element'
};
const conversions: Record<string, string> = {
  String: 'to-string',
  Number: 'to-number',
  int: 'to-int',
  date: 'to-date',
  time: 'to-time',
  dateTime: 'to-date-time',
  zonedDateTime: 'to-zoned-date-time'
};
interface Scope {
  parameters: ReadonlySet<string>;
  // null retains a lexical binding that has no faithful Rune name in this scope.
  aliases?: ReadonlyMap<string, string | null>;
}
const emptyScope: Scope = { parameters: new Set() };

class SourceReader {
  private fail(node: Node, message = `Unsupported projection syntax '${node.type}'.`): never {
    throw new OutOfSubset(message, node);
  }
  private lambda(node: Node, scope: Scope): { names: string[]; body: Node; scope: Scope } {
    if (node.type !== 'arrow_function') return this.fail(node, 'Expected a field selector or Rune inline function.');
    const parameter = node.childForFieldName('parameter');
    const parameters = node.childForFieldName('parameters');
    const names = parameter
      ? [id(parameter)]
      : (parameters?.namedChildren.map((part) => id(part.namedChildren[0] ?? part)) ?? []);
    if (!names.length || new Set(names).size !== names.length)
      return this.fail(node, 'Inline function parameters must be distinct Rune names.');
    const body = field(node, 'body');
    if (body.type === 'statement_block') return this.fail(body, 'Edit a statement-shaped callback in Rune source.');
    const aliases = new Map(scope.aliases);
    // A new Rune callback rebinds implicit item; it cannot capture the outer one.
    for (const [name, alias] of aliases) if (alias === 'item') aliases.set(name, null);
    for (const name of names) {
      aliases.delete(name);
      if (name === 'item') aliases.set(name, 'item');
    }
    return { names, body, scope: { parameters: new Set([...scope.parameters, ...names]), aliases } };
  }
  private inline(node: Node, scope: Scope): string {
    const fn = this.lambda(node, scope);
    return `${fn.names.length === 1 && fn.names[0] === 'item' ? '' : fn.names.join(', ') + ' '}[${this.read(fn.body, fn.scope)}]`;
  }
  private reference(node: Node, scope: Scope): string {
    const name = id(node);
    const alias = scope.aliases?.get(name);
    if (alias === null)
      return this.fail(
        node,
        `Rune cannot retain the captured callback binding '${name}' here; edit this expression in Rune source.`
      );
    return alias ?? name;
  }
  private fields(node: Node, scope: Scope): string {
    if (node.type !== 'object') return this.fail(node, 'Expected named constructor fields.');
    return node.namedChildren
      .map((pair) => {
        if (pair.type === 'shorthand_property_identifier') return `${id(pair)}: ${this.reference(pair, scope)}`;
        if (pair.type !== 'pair') return this.fail(pair, 'Only named Rune fields can be constructed.');
        return `${id(field(pair, 'key'))}: ${this.read(field(pair, 'value'), scope)}`;
      })
      .join(', ');
  }
  private selectorFields(node: Node, scope: Scope): string[] {
    const fn = this.lambda(node, scope);
    if (fn.names.length !== 1 || fn.body.type !== 'array')
      return this.fail(node, 'Expected a selector returning sibling fields.');
    return fn.body.namedChildren.map((member) => {
      if (member.type !== 'member_expression' || field(member, 'object').text !== fn.names[0])
        return this.fail(member, 'Only direct sibling fields are allowed.');
      return id(field(member, 'property'));
    });
  }
  private comparison(node: Node, receiver: Node, method: string, args: Node[], scope: Scope): string {
    if (args.length !== 1) return this.fail(node, 'Expected one comparison callback.');
    const fn = this.lambda(args[0]!, scope);
    const outsideAliases = new Map(scope.aliases);
    for (const name of fn.names) outsideAliases.set(name, null);
    const outsideScope = { ...scope, aliases: outsideAliases };
    const body = strip(fn.body);
    if (body.type === 'call_expression') {
      const call = field(body, 'function');
      const nestedArgs = field(body, 'arguments').namedChildren;
      if (call.type !== 'member_expression' || field(call, 'property').text !== method || nestedArgs.length !== 1)
        return this.fail(body);
      const inner = this.lambda(nestedArgs[0]!, fn.scope);
      const comparison = strip(inner.body);
      if (comparison.type !== 'binary_expression') return this.fail(comparison);
      const operator = comparison.children[1]!.text;
      if (
        inner.names.some((name) => fn.names.includes(name)) ||
        !['<', '<=', '>', '>='].includes(operator) ||
        field(comparison, 'left').text !== fn.names[0] ||
        field(comparison, 'right').text !== inner.names[0]
      )
        return this.fail(comparison);
      return `(${this.read(receiver, scope)}) ${method === 'every' ? 'all' : 'any'} ${operator} (${this.read(field(call, 'object'), outsideScope)})`;
    }
    if (body.type !== 'binary_expression') return this.fail(body, 'Only Rune quantified comparisons use every/some.');
    const operator = body.children[1]!.text;
    if (
      method === 'some' &&
      fn.names.length === 1 &&
      operator === 'instanceof' &&
      field(body, 'left').text === fn.names[0]
    )
      return `(${this.read(receiver, scope)}) as ${qualified(field(body, 'right'))} exists`;
    if (!['==', '!=', '<', '<=', '>', '>='].includes(operator) || field(body, 'left').text !== fn.names[0])
      return this.fail(body);
    let right = field(body, 'right');
    if (fn.names.length === 2) {
      if (
        right.type !== 'subscript_expression' ||
        field(right, 'index').text !== fn.names[1] ||
        !['==', '!='].includes(operator)
      )
        return this.fail(right, 'Indexed callbacks represent positional equality only.');
      right = field(right, 'object');
    } else if (fn.names.length !== 1) return this.fail(body);
    return `(${this.read(receiver, scope)}) ${method === 'every' ? 'all' : 'any'} ${operator === '==' ? '=' : operator === '!=' ? '<>' : operator} (${this.read(right, outsideScope)})`;
  }
  read(node: Node, scope: Scope = emptyScope): string {
    node = strip(node);
    const read = (part: Node) => this.read(part, scope);
    switch (node.type) {
      case 'identifier':
        return this.reference(node, scope);
      case 'null':
        return 'empty';
      case 'true':
        return 'True';
      case 'false':
        return 'False';
      case 'number':
        if (!/^(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?$|^\.\d+(?:[eE][+-]?\d+)?$/.test(node.text))
          return this.fail(node, 'Only Rune decimal literals are supported.');
        return node.text;
      case 'string':
        return JSON.stringify(stringValue(node));
      case 'unary_expression': {
        const operator = field(node, 'operator').text;
        const argument = field(node, 'argument');
        if (operator === '-' && argument.type === 'number') return `-${read(argument)}`;
        if (
          operator === '!' &&
          argument.type === 'call_expression' &&
          field(argument, 'function').text.replace(/^(?:rune|\$rune)\./, '') === 'exists'
        )
          return `(${read(field(argument, 'arguments').namedChildren[0]!)}) is absent`;
        return this.fail(node, 'Only authored absence and negative numeric literals have a Rune inverse.');
      }
      case 'binary_expression': {
        const operator = node.children[1]!.text;
        if (operator === 'instanceof')
          return `(${read(field(node, 'left'))}) as ${qualified(field(node, 'right'))} exists`;
        const mapping: Record<string, string> = {
          '==': '=',
          '!=': '<>',
          '<': '<',
          '<=': '<=',
          '>': '>',
          '>=': '>=',
          '+': '+',
          '-': '-',
          '*': '*',
          '/': '/',
          '&&': 'and',
          '||': 'or',
          '??': 'default'
        };
        if (!mapping[operator]) return this.fail(node, `Operator ${operator} has no agreed Rune projection.`);
        return `(${read(field(node, 'left'))}) ${mapping[operator]} (${read(field(node, 'right'))})`;
      }
      case 'ternary_expression':
        return `if (${read(field(node, 'condition'))}) then (${read(field(node, 'consequence'))}) else (${read(field(node, 'alternative'))})`;
      case 'member_expression': {
        const receiver = strip(field(node, 'object'));
        const property = id(field(node, 'property'));
        if (receiver.type === 'member_expression' && field(receiver, 'property').text === '_')
          return `(${read(field(receiver, 'object'))}) ->> ${property}`;
        if (property === '_')
          return this.fail(node, 'Select a deep property after ._, or use field("_") for the actual field.');
        return `(${read(receiver)}) -> ${property}`;
      }
      case 'subscript_expression':
        return `(${read(field(node, 'index'))}) to-enum ${qualified(field(node, 'object'))}`;
      case 'as_expression':
        return `(${read(node.namedChildren[0]!)}) as ${qualified(node.namedChildren[1]!)}`;
      case 'array':
        return node.namedChildren.length
          ? `[${node.namedChildren.map((element) => read(element.type === 'spread_element' ? element.namedChildren[0]! : element)).join(', ')}]`
          : 'empty';
      case 'call_expression': {
        const callee = field(node, 'function');
        const args = field(node, 'arguments').namedChildren;
        const qualifiedIntrinsic = /^(?:rune|\$rune)\./.test(callee.text);
        const name = callee.text.replace(/^(?:rune|\$rune)\./, '');
        if (callee.type === 'member_expression' && !qualifiedIntrinsic) {
          const receiver = field(callee, 'object'),
            method = field(callee, 'property').text;
          const base = `(${read(receiver)})`;
          if (method in zeroMethods && !args.length) return `${base} ${zeroMethods[method]}`;
          if (['toPlainDate', 'toPlainTime'].includes(method) && !args.length)
            return `${base} -> ${method === 'toPlainDate' ? 'date' : 'time'}`;
          if (['has', 'isSupersetOf', 'isDisjointFrom'].includes(method) && args.length === 1)
            return `${base} ${method === 'isDisjointFrom' ? 'disjoint' : 'contains'} (${read(args[0]!)})`;
          if (['every', 'some'].includes(method)) return this.comparison(node, receiver, method, args, scope);
          if (['sort', 'min', 'max', 'join'].includes(method)) {
            if (args.length > 1) return this.fail(node);
            if (!args.length) return `${base} ${method}`;
            return `${base} ${method} ${method === 'join' ? `(${read(args[0]!)})` : this.inline(args[0]!, scope)}`;
          }
          if (['map', 'filter', 'flatMap', 'reduce'].includes(method) && args.length === 1) {
            const operation = `${base} ${method === 'filter' ? 'filter' : method === 'reduce' ? 'reduce' : 'extract'} ${this.inline(args[0]!, scope)}`;
            return method === 'flatMap' ? `(${operation}) flatten` : operation;
          }
          if (method === 'field' && args.length === 1 && args[0]!.type === 'string') {
            const name = stringValue(args[0]!);
            if (!isRuneValidId(name)) return this.fail(args[0]!, 'Expected a Rune field name.');
            return `${base} -> ${name}`;
          }
          if (method === 'prop' && args.length === 1) {
            const fn = this.lambda(args[0]!, scope),
              member = strip(fn.body);
            if (
              fn.names.length !== 1 ||
              member.type !== 'member_expression' ||
              field(member, 'object').text !== fn.names[0]
            )
              return this.fail(member);
            return `${base} ->> ${id(field(member, 'property'))}`;
          }
          // Authored qualified calls preserve their spelling; unfamiliar methods are refused.
          if (!/^[A-Z]/.test(method)) return this.fail(node, `Method ${method} has no agreed Rune inverse.`);
        }
        if (name in conversions && args.length === 1 && args[0]!.type !== 'object')
          return `(${read(args[0]!)}) ${conversions[name]}`;
        if (['exists', 'singleExists', 'multipleExists', 'oneOf', 'asKey'].includes(name) && args.length === 1)
          return `(${read(args[0]!)}) ${{ exists: 'exists', singleExists: 'single exists', multipleExists: 'multiple exists', oneOf: 'one-of', asKey: 'as-key' }[name]}`;
        if (['extract', 'filter', 'then'].includes(name) && args.length === 2) {
          const fn = this.lambda(args[1]!, scope);
          if (name === 'then') {
            if (fn.names.length !== 1) return this.fail(args[1]!);
            const aliases = new Map(fn.scope.aliases);
            aliases.set(fn.names[0]!, 'item');
            return `(${read(args[0]!)}) then (${this.read(fn.body, { ...fn.scope, aliases })})`;
          }
          return `(${read(args[0]!)}) ${name} ${this.inline(args[1]!, scope)}`;
        }
        if (name === 'onlyExists' && args.length === 2)
          return `(${this.selectorFields(args[1]!, scope)
            .map((name) => `(${read(args[0]!)}) -> ${name}`)
            .join(', ')}) only exists`;
        if (name === 'choice' && args.length === 3 && args[2]!.type === 'string') {
          const mode = stringValue(args[2]!);
          if (mode !== 'optional' && mode !== 'required') return this.fail(args[2]!);
          return `(${read(args[0]!)}) ${mode} choice ${this.selectorFields(args[1]!, scope).join(', ')}`;
        }
        if (name === 'withMeta' && args.length === 2)
          return `(${read(args[0]!)}) with-meta { ${this.fields(args[1]!, scope)} }`;
        if (name === 'partial' && (args.length === 2 || args.length === 3))
          return `${qualified(args[0]!)}${args[2] ? `(${this.fields(args[2], scope)})` : ''} { ${this.fields(args[1]!, scope)}, ... }`;
        if ((args.length === 1 || args.length === 2) && args[0]!.type === 'object')
          return `${callee.text}${args[1] ? `(${this.fields(args[1], scope)})` : ''} { ${this.fields(args[0]!, scope)} }`;
        if (callee.type === 'super') return args.length ? `super(${args.map(read).join(', ')})` : 'super';
        if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(callee.text)) return this.fail(callee);
        if (qualifiedIntrinsic) return this.fail(node, 'Unknown qualified Rune intrinsic.');
        return `${callee.text}(${args.map(read).join(', ')})`;
      }
      default:
        return this.fail(node);
    }
  }
}

/** Parse familiar syntax back through Rune's own parser, never through native JS evaluation. */
export async function parseSourceTs(
  text: string,
  wasmSource?: WasmSource,
  origin?: ProjectionOrigin
): Promise<LensResult> {
  const parser = await createTsParser(wasmSource);
  const tree = parser.parse(text);
  if (!tree || tree.rootNode.hasError) {
    tree?.delete();
    parser.delete();
    return refusal('syntax-error', 'Invalid source-facing TypeScript syntax.', 0, text.length);
  }
  const trees = [tree];
  const reader = new SourceReader();
  try {
    const expression = expressionNode(tree.rootNode);
    const parse = (rune: string): LensResult => {
      const result = parseExpression(rune);
      return result.hasErrors
        ? refusal(
            'out-of-subset',
            'This edit cannot be represented faithfully in Rune. Edit its Rune source.',
            0,
            text.length
          )
        : { ok: true, node: result.value };
    };
    if (origin) {
      const baseline = parser.parse(origin.code);
      if (!baseline || baseline.rootNode.hasError)
        throw new OutOfSubset('The projection origin is no longer valid. Reopen the draft.', expression);
      trees.push(baseline);
      const before = expressionNode(baseline.rootNode);
      if (fingerprint(before) === fingerprint(expression)) return parse(origin.rune);
      const differences: { before: Node; after: Node }[] = [];
      const diff = (a: Node, b: Node) => {
        a = strip(a);
        b = strip(b);
        if (fingerprint(a) === fingerprint(b)) return;
        if (
          a.type === b.type &&
          a.namedChildCount &&
          a.namedChildCount === b.namedChildCount &&
          a.children
            .filter((child) => !child.isNamed)
            .map((child) => child.text)
            .join('|') ===
            b.children
              .filter((child) => !child.isNamed)
              .map((child) => child.text)
              .join('|')
        ) {
          a.namedChildren.forEach((child, index) => diff(child, b.namedChildren[index]!));
        } else differences.push({ before: a, after: b });
      };
      diff(before, expression);
      const replacements: { from: number; to: number; text: string }[] = [];
      for (const change of differences) {
        let before = change.before,
          after = change.after;
        let match: ProjectionOrigin['fragments'][number] | undefined;
        while (!match) {
          const matching = new Map<string, ProjectionOrigin['fragments'][number]>();
          for (const fragment of origin.fragments) {
            const fragmentTree = parser.parse(fragment.code);
            if (!fragmentTree) continue;
            try {
              if (
                !fragmentTree.rootNode.hasError &&
                fingerprint(expressionNode(fragmentTree.rootNode)) === fingerprint(before)
              )
                matching.set(`${fragment.from}:${fragment.to}`, fragment);
            } catch {
              /* Statement fragments have no expression inverse. */
            } finally {
              fragmentTree.delete();
            }
          }
          if (matching.size > 1)
            throw new OutOfSubset(
              'This edit has ambiguous Rune origins. Edit the Rune source to change its operation or binding.',
              after
            );
          match = [...matching.values()][0];
          if (!match) {
            if (!before.parent || !after.parent || before.parent.type === 'expression_statement')
              throw new OutOfSubset('This edit has no reversible Rune origin. Edit its Rune source.', after);
            before = before.parent;
            after = after.parent;
          }
        }
        if (match.aliases === undefined) {
          for (let ancestor: Node | null = before.parent; ancestor; ancestor = ancestor.parent)
            if (ancestor.type === 'arrow_function')
              throw new OutOfSubset('This callback origin has no binding information. Reopen the draft.', after);
        }
        if (
          match.aliases === null &&
          !['number', 'string', 'true', 'false', 'null', 'undefined'].includes(strip(after).type)
        )
          throw new OutOfSubset(
            'This substituted callback binding cannot be restored safely. Edit its Rune source.',
            after
          );
        const aliases = new Map(match.aliases ?? []);
        const scope: Scope = { parameters: new Set(aliases.keys()), aliases };
        let replacement = reader.read(after, scope);
        if (match.kind === 'RosettaFeatureCall' && after.type === 'call_expression') {
          const callee = field(after, 'function'),
            args = field(after, 'arguments').namedChildren;
          const callback = args[0];
          if (
            callee.type !== 'member_expression' ||
            !['map', 'flatMap'].includes(field(callee, 'property').text) ||
            args.length !== 1 ||
            callback?.type !== 'arrow_function'
          )
            throw new OutOfSubset('Change the navigation operation in Rune source.', after);
          const member = strip(field(callback, 'body'));
          const parameter = callback.childForFieldName('parameter');
          if (member.type !== 'member_expression' || !parameter || field(member, 'object').text !== parameter.text)
            throw new OutOfSubset('A navigation edit must still select one field.', after);
          replacement = `(${reader.read(field(callee, 'object'), scope)}) -> ${id(field(member, 'property'))}`;
        }
        replacements.push({ ...match, text: replacement });
      }
      replacements.sort((a, b) => b.from - a.from);
      let rune = origin.rune,
        end = rune.length;
      for (const replacement of replacements) {
        if (replacement.to > end)
          throw new OutOfSubset('Overlapping Rune origins cannot be edited safely.', expression);
        rune = rune.slice(0, replacement.from) + replacement.text + rune.slice(replacement.to);
        end = replacement.from;
      }
      return parse(rune);
    }
    return parse(reader.read(expression));
  } catch (error) {
    if (error instanceof OutOfSubset)
      return refusal(
        'out-of-subset',
        error.message,
        error.node.startIndex,
        error.node.endIndex - error.node.startIndex
      );
    throw error;
  } finally {
    for (const tree of trees) tree.delete();
    parser.delete();
  }
}
