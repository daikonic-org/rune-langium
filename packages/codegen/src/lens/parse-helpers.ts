// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { Node } from 'web-tree-sitter';
import type { LensResult, RefusalReason } from './language-lens.js';

export class OutOfSubset extends Error {
  constructor(
    message: string,
    public readonly node: Node
  ) {
    super(message);
  }
}

export function refusal(kind: RefusalReason['kind'], message: string, offset: number, length: number): LensResult {
  return { ok: false, reason: { kind, message, offset, length } };
}

export function child(node: Node, i: number): Node {
  const c = node.child(i);
  if (!c) throw new OutOfSubset('malformed expression', node);
  return c;
}

export function field(node: Node, name: string): Node {
  const c = node.childForFieldName(name);
  if (!c) throw new OutOfSubset(`malformed '${node.type}' (missing ${name})`, node);
  return c;
}
