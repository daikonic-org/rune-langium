// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { RosettaCardinality } from '../generated/ast.js';

export type CardinalityBounds = Pick<RosettaCardinality, 'inf' | 'sup' | 'unbounded'>;

/**
 * Whether the cardinality allows zero occurrences (inf == 0).
 */
export function isOptional(card: RosettaCardinality): boolean {
  return card.inf === 0;
}

/**
 * Whether the cardinality forces exactly one (inf == 1 && sup == 1).
 */
export function isSingular(card: RosettaCardinality): boolean {
  return card.inf === 1 && card.sup === 1 && !card.unbounded;
}

/**
 * Whether the cardinality allows more than one instance (sup > 1 or unbounded).
 */
export function isPlural(card: RosettaCardinality): boolean {
  return card.unbounded || (card.sup !== undefined && card.sup > 1);
}

/**
 * Whether the cardinality is required (inf >= 1).
 */
export function isRequired(card: RosettaCardinality): boolean {
  return card.inf >= 1;
}

/**
 * Produce a human-readable constraint string like "(1..1)", "(0..*)", etc.
 */
export function toConstraintString(card: CardinalityBounds): string {
  const sup = card.unbounded ? '*' : String(card.sup ?? card.inf);
  return `(${card.inf}..${sup})`;
}

export function cardinalityFits(source: CardinalityBounds, target: CardinalityBounds): boolean {
  return (
    source.inf >= target.inf &&
    (target.unbounded || (!source.unbounded && (source.sup ?? source.inf) <= (target.sup ?? target.inf)))
  );
}
