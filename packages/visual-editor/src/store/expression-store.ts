// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * expression-store — Zustand store for expression builder state.
 *
 * Scoped to a single expression being edited. Uses zundo temporal
 * middleware for undo/redo of tree mutations.
 *
 * @module
 */

import type { ExpressionScopeEntry } from '@rune-langium/core';
import { createStore, type StoreApi } from 'zustand';
import { temporal } from 'zundo';
import type { ExpressionNode } from '../schemas/expression-node-schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FunctionScopeEntry {
  declarationId?: string;
  kind?: ExpressionScopeEntry['kind'];
  argumentCount?: number;
  name: string;
  typeName?: string;
  cardinality?: string;
}

export interface FunctionScope {
  inputs: FunctionScopeEntry[];
  output: FunctionScopeEntry | null;
  aliases: FunctionScopeEntry[];
  attributes?: FunctionScopeEntry[];
  references?: FunctionScopeEntry[];
}

export interface ExpressionBuilderState {
  /** The expression tree being edited. */
  tree: ExpressionNode;

  /** Current editor mode. */
  mode: 'builder' | 'text';

  /** Currently selected node ID (null = none). */
  selectedNodeId: string | null;

  /** Whether the operator palette is open. */
  paletteOpen: boolean;

  /** Node ID the palette is anchored to. */
  paletteAnchorId: string | null;

  /** Function scope for reference resolution. */
  scope: FunctionScope;

  /** Clipboard (deep clone of a sub-tree). */
  clipboard: ExpressionNode | null;

  // ---- Actions ----

  /** Replace a node by ID with a new node. */
  replaceNode: (nodeId: string, newNode: ExpressionNode) => void;

  /** Remove a node (replace with Placeholder). */
  removeNode: (nodeId: string) => void;

  /** Update a literal node's value. */
  updateLiteral: (nodeId: string, value: unknown) => void;

  /** Select a node. */
  selectNode: (nodeId: string | null) => void;

  /** Set editor mode. */
  setMode: (mode: 'builder' | 'text') => void;

  /** Open operator palette on a node. */
  openPalette: (nodeId: string) => void;

  /** Close operator palette. */
  closePalette: () => void;

  /** Replace entire tree. */
  setTree: (tree: ExpressionNode) => void;

  /** Copy a node to clipboard. */
  copyNode: (nodeId: string) => void;

  /** Paste clipboard at target (replaces target). */
  pasteNode: (targetId: string) => void;
}

// ---------------------------------------------------------------------------
// Tree traversal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone an ExpressionNode tree, replacing any node matching
 * the target ID with the replacement node.
 */
export function replaceInTree(tree: ExpressionNode, targetId: string, replacement: ExpressionNode): ExpressionNode {
  if (tree.id === targetId) return replacement;
  return mapChildren(tree, (child) => replaceInTree(child, targetId, replacement));
}

/**
 * Deep-clone an ExpressionNode tree, updating a literal node's value.
 */
function updateLiteralInTree(tree: ExpressionNode, targetId: string, value: unknown): ExpressionNode {
  if (tree.id === targetId) {
    return { ...tree, value };
  }
  return mapChildren(tree, (child) => updateLiteralInTree(child, targetId, value));
}

/**
 * Find a node by ID in the tree.
 */
function findNode(tree: ExpressionNode, nodeId: string): ExpressionNode | null {
  if (tree.id === nodeId) return tree;
  const children = getChildren(tree);
  for (const child of children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

/**
 * Deep-clone a tree, assigning new IDs to every node.
 */
function deepCloneWithNewIds(tree: ExpressionNode): ExpressionNode {
  const newId = crypto.randomUUID();
  const cloned = mapChildren({ ...tree, id: newId }, (child) => deepCloneWithNewIds(child));
  return cloned;
}

/** Check if a value is an ExpressionNode (has $type). */
function isExprNode(v: unknown): v is ExpressionNode {
  return v != null && typeof v === 'object' && '$type' in v;
}

/** Get a field from a record via bracket access. */
function field(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

/** Expression child field names for single-value children. */
const CHILD_FIELDS = ['left', 'right', 'argument', 'if', 'ifthen', 'elsethen', 'receiver'] as const;

/** Expression child field names for array children. */
const ARRAY_CHILD_FIELDS = ['elements', 'rawArgs'] as const;

/**
 * Get direct child expression nodes.
 */
function getChildren(node: ExpressionNode): ExpressionNode[] {
  const children: ExpressionNode[] = [];
  const n = node as Record<string, unknown>;

  for (const key of CHILD_FIELDS) {
    const v = field(n, key);
    if (isExprNode(v)) children.push(v);
  }

  // Lambda: function.body
  const func = field(n, 'function') as Record<string, unknown> | undefined;
  if (func) {
    const body = field(func, 'body');
    if (isExprNode(body)) children.push(body);
  }

  // Switch: cases[].expression
  const cases = field(n, 'cases');
  if (Array.isArray(cases)) {
    for (const c of cases as Record<string, unknown>[]) {
      const expr = field(c, 'expression');
      if (isExprNode(expr)) children.push(expr);
    }
  }

  // Constructor: values[].value
  const values = field(n, 'values');
  if (Array.isArray(values)) {
    for (const v of values as Record<string, unknown>[]) {
      const val = field(v, 'value');
      if (isExprNode(val)) children.push(val);
    }
  }

  // Array children (elements, rawArgs)
  for (const key of ARRAY_CHILD_FIELDS) {
    const arr = field(n, key);
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (isExprNode(e)) children.push(e);
      }
    }
  }

  return children;
}

/**
 * Map all child expression nodes, returning a new node only if at least
 * one child changed (preserves object identity otherwise).
 */
function mapChildren(node: ExpressionNode, fn: (child: ExpressionNode) => ExpressionNode): ExpressionNode {
  let changed = false;
  const orig = node as Record<string, unknown>;
  const n = {} as Record<string, unknown>;

  // Copy all fields first
  for (const key in orig) {
    n[key] = orig[key];
  }

  // Single-value children
  for (const key of CHILD_FIELDS) {
    const v = field(orig, key);
    if (isExprNode(v)) {
      const mapped = fn(v);
      if (mapped !== v) {
        n[key] = mapped;
        changed = true;
      }
    }
  }

  // Lambda function.body
  const func = field(orig, 'function');
  if (func && typeof func === 'object') {
    const funcRec = func as Record<string, unknown>;
    const body = field(funcRec, 'body');
    if (isExprNode(body)) {
      const mappedBody = fn(body);
      if (mappedBody !== body) {
        n['function'] = { ...funcRec, body: mappedBody };
        changed = true;
      }
    }
  }

  // Switch cases
  const cases = field(orig, 'cases');
  if (Array.isArray(cases)) {
    let casesChanged = false;
    const newCases = (cases as Record<string, unknown>[]).map((c) => {
      const expr = field(c, 'expression');
      if (isExprNode(expr)) {
        const mapped = fn(expr);
        if (mapped !== expr) {
          casesChanged = true;
          return { ...c, expression: mapped };
        }
      }
      return c;
    });
    if (casesChanged) {
      n['cases'] = newCases;
      changed = true;
    }
  }

  // Constructor values
  const values = field(orig, 'values');
  if (Array.isArray(values)) {
    let valuesChanged = false;
    const newValues = (values as Record<string, unknown>[]).map((v) => {
      const val = field(v, 'value');
      if (isExprNode(val)) {
        const mapped = fn(val);
        if (mapped !== val) {
          valuesChanged = true;
          return { ...v, value: mapped };
        }
      }
      return v;
    });
    if (valuesChanged) {
      n['values'] = newValues;
      changed = true;
    }
  }

  // Array children (elements, rawArgs)
  for (const key of ARRAY_CHILD_FIELDS) {
    const arr = field(orig, key);
    if (Array.isArray(arr)) {
      let arrChanged = false;
      const newArr = (arr as unknown[]).map((e) => {
        if (isExprNode(e)) {
          const mapped = fn(e);
          if (mapped !== e) {
            arrChanged = true;
            return mapped;
          }
        }
        return e;
      });
      if (arrChanged) {
        n[key] = newArr;
        changed = true;
      }
    }
  }

  return changed ? n : node;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

/**
 * Create an expression builder store instance.
 * Each expression editor gets its own store.
 */
export function createExpressionStore(
  initialTree: ExpressionNode,
  scope: FunctionScope,
  initialMode: 'builder' | 'text' = 'builder'
): StoreApi<ExpressionBuilderState> {
  return createStore<ExpressionBuilderState>()(
    temporal(
      (set, get) => ({
        tree: initialTree,
        mode: initialMode,
        selectedNodeId: null,
        paletteOpen: false,
        paletteAnchorId: null,
        scope,
        clipboard: null,

        replaceNode: (nodeId, newNode) => {
          const tree = get().tree;
          const newTree = replaceInTree(tree, nodeId, newNode);
          // Only update if tree actually changed (node was found)
          if (newTree !== tree) {
            set({ tree: newTree, paletteOpen: false, paletteAnchorId: null });
          }
        },

        removeNode: (nodeId) => {
          const placeholder: ExpressionNode = {
            $type: 'Placeholder',
            id: crypto.randomUUID()
          };
          const tree = get().tree;
          set({ tree: replaceInTree(tree, nodeId, placeholder) });
        },

        updateLiteral: (nodeId, value) => {
          set({ tree: updateLiteralInTree(get().tree, nodeId, value) });
        },

        selectNode: (nodeId) => {
          set({ selectedNodeId: nodeId });
        },

        setMode: (mode) => {
          set({ mode });
        },

        openPalette: (nodeId) => {
          set({ paletteOpen: true, paletteAnchorId: nodeId, selectedNodeId: nodeId });
        },

        closePalette: () => {
          set({ paletteOpen: false, paletteAnchorId: null });
        },

        setTree: (tree) => {
          set({ tree });
        },

        copyNode: (nodeId) => {
          const node = findNode(get().tree, nodeId);
          if (node) {
            set({ clipboard: structuredClone(node) });
          }
        },

        pasteNode: (targetId) => {
          const { clipboard, tree } = get();
          if (!clipboard) return;
          const cloned = deepCloneWithNewIds(clipboard);
          set({ tree: replaceInTree(tree, targetId, cloned) });
        }
      }),
      {
        // Only track tree changes for undo/redo (not UI state)
        partialize: (state) => ({ tree: state.tree }),
        equality: (previous, current) => previous.tree === current.tree,
        limit: 50
      }
    )
  );
}
