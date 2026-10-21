// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Edit-time validator for the visual editor (T076).
 *
 * Provides lightweight validation functions that can be called before
 * applying edit commands to prevent invalid operations.
 *
 * These wrap / complement the core RuneDslValidator rules:
 * - S-01: No duplicate attributes / type names
 * - S-02: Circular inheritance detection
 * - S-04: Cardinality bounds
 * - S-05: No duplicate enum value names within an enum
 * - S-06: Empty type/enum/choice name
 * - S-07: Invalid name characters per Rune DSL identifier rules
 */

import { parseExpression } from '@rune-langium/core';
import type { TypeGraphNode, TypeGraphEdge, ValidationError } from '../types.js';
import { buildInheritanceMap } from '../utils/inheritance.js';

// ---------------------------------------------------------------------------
// Circular inheritance detection (S-02)
// ---------------------------------------------------------------------------

function reachesAncestor(childId: string, parentId: string, parentMap: ReadonlyMap<string, string>): boolean {
  const visited = new Set<string>();
  let current: string | undefined = parentId;
  while (current) {
    if (current === childId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    current = parentMap.get(current);
  }
  return false;
}

/**
 * Detect whether setting `childId extends parentId` would create a cycle.
 *
 * Walks the inheritance chain from parentId upward; if it reaches childId,
 * a cycle exists.
 */
export function detectCircularInheritance(childId: string, parentId: string, edges: TypeGraphEdge[]): boolean {
  if (childId === parentId) return true;
  return reachesAncestor(childId, parentId, buildInheritanceMap(edges));
}

// ---------------------------------------------------------------------------
// Duplicate name detection (S-01)
// ---------------------------------------------------------------------------

/**
 * Check if a name already exists in the given namespace.
 *
 * When `nodeId` is provided, checks for duplicate attribute names within
 * that node instead of type names.
 */
export function detectDuplicateName(name: string, namespace: string, nodes: TypeGraphNode[], nodeId?: string): boolean {
  if (nodeId) {
    // Check for duplicate attribute within a node
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    const d = node.data;
    const members = ((d as any).attributes ??
      (d as any).enumValues ??
      (d as any).inputs ??
      (d as any).features ??
      []) as { name?: string }[];
    return members.some((m) => m.name === name);
  }

  // Check for duplicate type name in the namespace
  return nodes.some((n) => n.data.name === name && n.meta.namespace === namespace);
}

// ---------------------------------------------------------------------------
// Cardinality validation (S-04)
// ---------------------------------------------------------------------------

/**
 * Validate a cardinality string.
 *
 * Returns null if valid, or an error message string if invalid.
 * Accepts formats: "inf..sup", "(inf..sup)", "inf..*", "(inf..*)"
 */
export function validateCardinality(input: string): string | null {
  if (!input || !input.trim()) {
    return 'Cardinality cannot be empty';
  }

  const cleaned = input.replace(/[()]/g, '').trim();
  const match = cleaned.match(/^(\d+)\.\.(\*|\d+)$/);
  if (!match) {
    return `Invalid cardinality format: "${input}". Expected "inf..sup" or "inf..*"`;
  }

  const inf = parseInt(match[1]!, 10);

  if (inf < 0) {
    return `Lower bound cannot be negative: ${inf}`;
  }

  if (match[2] !== '*') {
    const sup = parseInt(match[2]!, 10);
    if (sup < 0) {
      return `Upper bound cannot be negative: ${sup}`;
    }
    if (inf > sup) {
      return `Lower bound (${inf}) cannot exceed upper bound (${sup})`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Duplicate enum value detection (S-05)
// ---------------------------------------------------------------------------

/**
 * Check if an enum value name already exists within the specified enum node.
 */
export function detectDuplicateEnumValue(valueName: string, nodeId: string, nodes: TypeGraphNode[]): boolean {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const d = node.data;
  if (d.$type !== 'RosettaEnumeration') return false;
  const vals = ((d as any).enumValues ?? []) as { name?: string }[];
  return vals.some((v) => v.name === valueName);
}

// ---------------------------------------------------------------------------
// Empty name detection (S-06)
// ---------------------------------------------------------------------------

/**
 * Validate that a name is non-empty after trimming whitespace.
 *
 * Returns null if valid, or an error message string if invalid.
 */
export function validateNotEmpty(name: string, context = 'Name'): string | null {
  if (!name || !name.trim()) {
    return `${context} cannot be empty`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Invalid identifier characters (S-07)
// ---------------------------------------------------------------------------

/**
 * Valid Rune DSL identifier pattern.
 *
 * Identifiers must start with a letter or underscore and contain
 * only letters, digits, and underscores.
 */
const RUNE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate that a name conforms to Rune DSL identifier rules.
 *
 * Returns null if valid, or an error message string if invalid.
 */
export function validateIdentifier(name: string): string | null {
  if (!name || !name.trim()) {
    return 'Name cannot be empty';
  }
  if (!RUNE_IDENTIFIER_PATTERN.test(name)) {
    return `Invalid identifier: "${name}". Must start with a letter or underscore and contain only letters, digits, and underscores.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expression parse-validation (placeholder)
// ---------------------------------------------------------------------------

/**
 * Result of validating a Rune DSL expression.
 */
export interface ExpressionValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate expression syntax with the canonical Rune parser, without linking workspace symbols.
 *
 * @param expression - The expression text to validate.
 * @returns Validation result with error message if invalid.
 */
export function validateExpression(expression: string): ExpressionValidationResult {
  if (!expression || !expression.trim()) {
    return { valid: false, error: 'Expression cannot be empty' };
  }

  const parsed = parseExpression(expression);
  return parsed.hasErrors
    ? {
        valid: false,
        error: parsed.lexerErrors[0]?.message ?? parsed.parserErrors[0]?.message ?? 'Invalid Rune expression'
      }
    : { valid: true };
}

// ---------------------------------------------------------------------------
// Aggregate validation
// ---------------------------------------------------------------------------

/**
 * Run all validations on the current graph state and return errors.
 */
export function validateGraph(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for duplicate type names within each namespace
  const namespaceNames = new Map<string, Map<string, string[]>>();
  for (const node of nodes) {
    const ns = node.meta.namespace;
    if (!namespaceNames.has(ns)) {
      namespaceNames.set(ns, new Map());
    }
    const names = namespaceNames.get(ns)!;
    const name = node.data.name;
    if (!names.has(name)) {
      names.set(name, []);
    }
    names.get(name)!.push(node.id);
  }

  for (const [_ns, names] of namespaceNames) {
    for (const [name, ids] of names) {
      if (ids.length > 1) {
        for (const id of ids) {
          errors.push({
            nodeId: id,
            severity: 'error',
            message: `Duplicate type name: "${name}"`,
            ruleId: 'S-01'
          });
        }
      }
    }
  }

  // Check for circular inheritance
  const parentMap = buildInheritanceMap(edges);

  for (const [childId, parentId] of parentMap) {
    if (reachesAncestor(childId, parentId, parentMap)) {
      errors.push({
        nodeId: childId,
        severity: 'error',
        message: 'Circular inheritance detected',
        ruleId: 'S-02'
      });
    }
  }

  // Check for duplicate attribute names within each type
  for (const node of nodes) {
    const d = node.data;
    const members = ((d as any).attributes ?? (d as any).inputs ?? (d as any).features ?? []) as {
      name?: string;
    }[];
    const attrNames = new Set<string>();
    for (const member of members) {
      if (member.name && attrNames.has(member.name)) {
        errors.push({
          nodeId: node.id,
          severity: 'error',
          message: `Duplicate attribute name: "${member.name}"`,
          ruleId: 'S-01'
        });
      }
      if (member.name) attrNames.add(member.name);
    }
  }

  // S-05: Check for duplicate enum value names within each enum
  for (const node of nodes) {
    const d = node.data;
    if (d.$type !== 'RosettaEnumeration') continue;
    const vals = ((d as any).enumValues ?? []) as { name?: string }[];
    const valueNames = new Set<string>();
    for (const val of vals) {
      if (val.name && valueNames.has(val.name)) {
        errors.push({
          nodeId: node.id,
          severity: 'error',
          message: `Duplicate enum value: "${val.name}"`,
          ruleId: 'S-05'
        });
      }
      if (val.name) valueNames.add(val.name);
    }
  }

  // S-06: Check for empty type names
  for (const node of nodes) {
    if (!node.data.name || !node.data.name.trim()) {
      errors.push({
        nodeId: node.id,
        severity: 'error',
        message: 'Type name cannot be empty',
        ruleId: 'S-06'
      });
    }
  }

  // S-07: Check for invalid name characters
  for (const node of nodes) {
    if (node.data.name && node.data.name.trim()) {
      const identError = validateIdentifier(node.data.name);
      if (identError) {
        errors.push({
          nodeId: node.id,
          severity: 'error',
          message: identError,
          ruleId: 'S-07'
        });
      }
    }
  }

  return errors;
}
