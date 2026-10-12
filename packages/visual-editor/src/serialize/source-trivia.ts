// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { isRosettaExpression, type SourceComment } from '@rune-langium/core';
import type { DehydratedNode } from '@rune-langium/codegen/rosetta';
import { SCHEMA_BY_TYPE } from '../schemas/schema-by-type.js';

interface Range {
  offset: number;
  end: number;
}
interface Boundary {
  key: string;
  node: DehydratedNode;
  range: Range;
  parent?: Boundary;
}
interface Owned {
  comment: SourceComment;
  owner: Boundary;
  position: 'leading' | 'trailing' | 'inside';
}
export interface SourceTriviaIndex {
  withOwnedTrivia(node: DehydratedNode, rendered: string, reused: boolean): string;
  ignoreReplacedExpression(node: DehydratedNode): void;
  omittedGapRanges(): readonly Range[];
}

function rangeOf(value: unknown): Range | undefined {
  const range = (value as { $cstRange?: Range } | undefined)?.$cstRange;
  return range && Number.isFinite(range.offset) && Number.isFinite(range.end) && range.end > range.offset
    ? range
    : undefined;
}
function keyOf(node: DehydratedNode, range: Range): string {
  return `${node.$type}:${range.offset}:${range.end}`;
}
function visitNodes(nodes: readonly DehydratedNode[], visit: (node: DehydratedNode, range: Range) => void) {
  const seen = new WeakSet<object>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const object = value as Record<string, unknown>;
    const range = rangeOf(object);
    if (range && typeof object.$type === 'string') visit(object as DehydratedNode, range);
    Object.values(object).forEach(walk);
  };
  nodes.forEach(walk);
}

/** Ownership comes from lexical offsets and baseline ranges, never current array positions. */
export function createSourceTriviaIndex(
  source: string,
  baselineNodes: readonly DehydratedNode[],
  comments: readonly SourceComment[],
  currentNodes: readonly DehydratedNode[] = baselineNodes
): SourceTriviaIndex {
  const boundaries = new Map<string, Boundary>();
  const expressions: Range[] = [];
  const present = new Set<string>();
  visitNodes(currentNodes, (node, range) => present.add(keyOf(node, range)));
  visitNodes(baselineNodes, (node, range) => {
    if (SCHEMA_BY_TYPE[node.$type]) {
      const key = keyOf(node, range);
      if (!boundaries.has(key)) boundaries.set(key, { key, node, range });
    }
    if (isRosettaExpression(node)) expressions.push(range);
  });
  const all = [...boundaries.values()];
  const contains = (outer: Range, inner: Range) => outer.offset <= inner.offset && outer.end >= inner.end;
  const ordered = [...all].sort(
    (left, right) => left.range.offset - right.range.offset || right.range.end - left.range.end
  );
  const stack: Boundary[] = [];
  const childrenByParent = new Map<Boundary, Boundary[]>();
  for (const boundary of ordered) {
    while (stack.length && !contains(stack[stack.length - 1]!.range, boundary.range)) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && (parent.range.offset !== boundary.range.offset || parent.range.end !== boundary.range.end)) {
      boundary.parent = parent;
      (childrenByParent.get(parent) ?? childrenByParent.set(parent, []).get(parent)!).push(boundary);
    }
    stack.push(boundary);
  }
  const emitted = new Set<number>();
  const generatedRoots = new Set<string>();
  const owned: Owned[] = [];
  const indent = (offset: number) => {
    const before = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
    return before.trim() === '' ? before.length : undefined;
  };
  const gap = (from: number, to: number) => {
    let cursor = from;
    let clean = '';
    let anchored = '';
    for (const comment of comments) {
      if (comment.offset < from || comment.end > to) continue;
      const text = source.slice(cursor, comment.offset);
      clean += text;
      anchored += `${text}comment`;
      cursor = comment.end;
    }
    clean += source.slice(cursor, to);
    anchored += source.slice(cursor, to);
    return { trivia: clean.trim() === '', lineBreak: clean.includes('\n'), blank: /\n[\t ]*\r?\n/.test(anchored) };
  };
  for (const comment of comments) {
    const container = all
      .filter((boundary) => contains(boundary.range, comment))
      .sort((left, right) => left.range.end - left.range.offset - (right.range.end - right.range.offset))[0];
    if (!container) {
      // A last member's same-line tail lies beyond the declaration's last visible token.
      const roots = all
        .filter((boundary) => !boundary.parent && boundary.range.end <= comment.offset)
        .sort((left, right) => right.range.end - left.range.end);
      const root = roots[0];
      const trailing = root ? gap(root.range.end, comment.offset) : undefined;
      if (root && trailing?.trivia && !trailing.lineBreak) {
        const children = childrenByParent.get(root) ?? [];
        const owner = children.filter((child) => child.range.end === root.range.end)[0] ?? root;
        owned.push({ comment, owner, position: 'trailing' });
      }
      continue; // Other top-level gaps remain byte-identical.
    }
    const children = childrenByParent.get(container) ?? [];
    const precedingChildren = children.filter((child) => child.range.end <= comment.offset);
    const previous = precedingChildren[precedingChildren.length - 1];
    const next = children.find((child) => child.range.offset >= comment.end);
    const preceding = previous ? gap(previous.range.end, comment.offset) : undefined;
    const following = next ? gap(comment.end, next.range.offset) : undefined;
    if (
      previous &&
      preceding?.trivia &&
      !preceding.blank &&
      (!preceding.lineBreak ||
        (indent(comment.offset) !== undefined && indent(comment.offset)! > (indent(previous.range.offset) ?? 0)))
    )
      owned.push({ comment, owner: previous, position: 'trailing' });
    else if (
      next &&
      following?.trivia &&
      !following.blank &&
      indent(comment.offset) !== undefined &&
      indent(comment.offset) === indent(next.range.offset)
    )
      owned.push({ comment, owner: next, position: 'leading' });
    else owned.push({ comment, owner: container, position: 'inside' });
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const rootOf = (owner: Boundary) => {
    let root = owner;
    while (root.parent) root = root.parent;
    return root;
  };
  return {
    omittedGapRanges() {
      return owned
        .filter((item) => {
          const root = rootOf(item.owner);
          return (
            item.comment.offset >= root.range.end &&
            (emitted.has(item.comment.offset) ||
              !present.has(root.key) ||
              (!present.has(item.owner.key) && generatedRoots.has(root.key)))
          );
        })
        .map((item) => ({ offset: rootOf(item.owner).range.end, end: item.comment.end }));
    },
    ignoreReplacedExpression(node) {
      const range = rangeOf(node);
      if (!range) return;
      const original = expressions
        .filter((expression) => contains(range, expression))
        .sort((left, right) => right.end - right.offset - (left.end - left.offset))[0];
      if (original) for (const comment of comments) if (contains(original, comment)) emitted.add(comment.offset);
    },
    withOwnedTrivia(node, rendered, reused) {
      const range = rangeOf(node);
      if (!range) return rendered;
      const key = keyOf(node, range);
      if (!reused && !boundaries.get(key)?.parent) generatedRoots.add(key);
      if (reused) for (const comment of comments) if (contains(range, comment)) emitted.add(comment.offset);
      const pending = owned.filter(
        (item) =>
          !emitted.has(item.comment.offset) &&
          present.has(item.owner.key) &&
          (item.owner.key === key || (!reused && contains(range, item.owner.range)))
      );
      const before: string[] = [];
      const after: string[] = [];
      for (const item of pending) {
        emitted.add(item.comment.offset);
        (item.position === 'trailing' ? after : before).push(item.comment.text);
      }
      const prefix = before.length ? `${before.join(newline)}${newline}` : '';
      // Multiple line comments must each begin on a new line; the first remains an inline tail.
      const suffix = after.length ? ` ${after.join(newline)}` : '';
      return `${prefix}${rendered}${suffix}`;
    }
  };
}
