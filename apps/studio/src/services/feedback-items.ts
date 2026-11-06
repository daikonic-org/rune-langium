// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';

import type { AnyGraphNode, TypeGraphNode } from '@rune-langium/visual-editor';
import type { PreviewField } from '@rune-langium/codegen/export';
import { feedbackFingerprint, feedbackSelector, type FeedbackItem } from './change-feedback.js';

const memberGroups = new Set(['attributes', 'inputs', 'output', 'enumValues', 'choiceOptions']);

function memberName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ('name' in value && typeof value.name === 'string') return value.name;
  if (
    'typeCall' in value &&
    value.typeCall &&
    typeof value.typeCall === 'object' &&
    'type' in value.typeCall &&
    value.typeCall.type &&
    typeof value.typeCall.type === 'object' &&
    '$refText' in value.typeCall.type &&
    typeof value.typeCall.type.$refText === 'string'
  ) {
    return value.typeCall.type.$refText;
  }
  return undefined;
}

export const inspectorFeedbackItems = withInstrumentation(
  function inspectorFeedbackItems(node: AnyGraphNode | null): FeedbackItem[] {
    if (!node) return [];
    const items: FeedbackItem[] = [
      {
        key: 'declaration',
        group: 'declaration',
        selector: '[data-slot="type-header"]',
        value: feedbackFingerprint(Object.fromEntries(Object.entries(node).filter(([key]) => !memberGroups.has(key))))
      }
    ];
    for (const [group, value] of Object.entries(node)) {
      if (!memberGroups.has(group)) continue;
      const members: unknown[] = Array.isArray(value) ? value : [value];
      for (const [ordinal, member] of members.entries()) {
        const name = memberName(member);
        if (name === undefined) continue;
        const key = `${group}:${name}`;
        items.push({
          key,
          group,
          ordinal,
          value: feedbackFingerprint(member),
          selector: feedbackSelector(
            'data-feedback-key',
            group === 'attributes' || group === 'inputs' || group === 'output' ? key : name
          )
        });
      }
    }
    return items;
  },
  {
    op: 'inspectorFeedbackItems',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

export const previewFeedbackItems = withInstrumentation(
  function previewFeedbackItems(fields: readonly PreviewField[]): FeedbackItem[] {
    return fields.flatMap((field) => [
      {
        key: field.path,
        group: field.path.includes('.') ? field.path.slice(0, field.path.lastIndexOf('.')) : '',
        value: feedbackFingerprint({ ...field, children: undefined }),
        selector: feedbackSelector('data-field-path', field.path)
      },
      ...previewFeedbackItems('children' in field ? (field.children ?? []) : [])
    ]);
  },
  {
    op: 'previewFeedbackItems',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

/** Canvas geometry/selection is intentionally absent: only authored node values can cue a card. */
export const diagramFeedbackItems = withInstrumentation(
  function diagramFeedbackItems(nodes: readonly TypeGraphNode[], mode: 'graph' | 'structure'): FeedbackItem[] {
    return nodes
      .filter((node) => !node.meta?.isReadOnly && !node.meta?.deferred)
      .flatMap((node) => {
        const base =
          mode === 'graph'
            ? `${feedbackSelector('data-id', node.id)} .rune-node`
            : feedbackSelector('data-feedback-node', node.id);
        if (mode === 'graph')
          return [
            { key: node.id, group: `nodes:${node.data.$type}`, selector: base, value: feedbackFingerprint(node.data) }
          ];
        return inspectorFeedbackItems(node.data).map((item) => {
          const labels: Record<string, string> = { inputs: 'Inputs', output: 'Output', choiceOptions: 'Options' };
          const list =
            item.group === 'enumValues'
              ? ' > .rune-structure-enum'
              : item.group === 'attributes'
                ? ' > .rune-structure-members:not([aria-label])'
                : ` > .rune-structure-members${feedbackSelector('aria-label', labels[item.group] ?? '')}`;
          return {
            ...item,
            key: `${node.id}:${item.key}`,
            group: `${node.id}:${item.group}`,
            selector: item.group === 'declaration' ? base : `${base}${list} > li:nth-child(${(item.ordinal ?? 0) + 1})`
          };
        });
      });
  },
  {
    op: 'diagramFeedbackItems',
    sanitize: () => ({}),
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
