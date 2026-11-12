// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import {
  isRosettaSymbolReference,
  getSourceComments,
  parseExpression,
  type FunctionComposition,
  type SourceRegion
} from '@rune-langium/core';
import { withInstrumentation } from './instrumentation/core.js';
import type { DocumentBinding, DocumentEdit } from './expression-document.js';
import { minimalDocumentChange } from '../lang/document-extensions.js';

/** Core's parser decides when a display name needs Rune's identifier escape. */
export const compositionReference = withInstrumentation(
  function compositionReference(name: string): string {
    const parsed = parseExpression(name);
    return !parsed.hasErrors && isRosettaSymbolReference(parsed.value) && !parsed.value.explicitArguments
      ? name
      : `^${name}`;
  },
  { op: 'compositionReference', capture: 0 }
);

/** Compose independent exact edits against one capture; no writes happen during preparation. */
export const compositionCandidate = withInstrumentation(
  function compositionCandidate(binding: DocumentBinding, edits: readonly DocumentEdit[]): string {
    let text = binding.source;
    let end = text.length;
    for (const edit of [...edits].sort((a, b) => b.region.from - a.region.from)) {
      if (
        edit.binding !== binding ||
        edit.region.to > end ||
        binding.source.slice(edit.region.from, edit.region.to) !== edit.expectedText
      )
        throw new Error('The binding coordinates changed. Reopen this node.');
      text = text.slice(0, edit.region.from) + edit.replacement + text.slice(edit.region.to);
      end = edit.region.from;
    }
    return text;
  },
  { op: 'compositionCandidate', capture: 0 }
);

/** Stable topological ordering of original source blocks; comments and untouched bytes travel intact. */
export const reorderCompositionVariables = withInstrumentation(
  function reorderCompositionVariables(source: string, composition: FunctionComposition): string {
    const unsupported = composition.reasons.find((reason) => reason.code !== 'forward-reference');
    if (unsupported) throw new Error(unsupported.message);
    const variables = composition.steps.filter((step) => step.id.startsWith('alias:'));
    const remaining = [...variables];
    const ids = new Set(variables.map((step) => step.id));
    const emitted = new Set<string>();
    const ordered: typeof variables = [];
    while (remaining.length) {
      const index = remaining.findIndex((step) =>
        step.dependencies.every((dependency) => !ids.has(dependency) || emitted.has(dependency))
      );
      if (index < 0) throw new Error('This binding would create a variable cycle.');
      const [step] = remaining.splice(index, 1);
      ordered.push(step!);
      emitted.add(step!.id);
    }
    if (ordered.every((step, index) => step === variables[index])) return source;
    const region = composition.variablesRegion;
    if (!region || ordered.some((step) => !step.sourceBlock))
      throw new Error('Open Source to reorder these variables safely.');
    return (
      source.slice(0, region.from) +
      ordered.map((step) => source.slice(step.sourceBlock!.from, step.sourceBlock!.to)).join('') +
      source.slice(region.to)
    );
  },
  { op: 'reorderCompositionVariables', capture: 0 }
);

export const compositionSourceEdit = withInstrumentation(
  function compositionSourceEdit(binding: DocumentBinding, source: string): DocumentEdit {
    const change = minimalDocumentChange(binding.source, source);
    return {
      binding,
      region: { from: change.from, to: change.to },
      expectedText: binding.source.slice(change.from, change.to),
      replacement: change.insert
    };
  },
  { op: 'compositionSourceEdit', capture: 0 }
);

/** Dependencies are supplied by Core, including local scopes; bindings never infer them from spelling. */
export const compositionBindingCycle = withInstrumentation(
  function compositionBindingCycle(composition: FunctionComposition, consumer: string, producer: string): boolean {
    const pending = [producer],
      seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === consumer) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(composition.steps.find((step) => step.id === id)?.dependencies ?? []));
    }
    return false;
  },
  { op: 'compositionBindingCycle', capture: 0 }
);

/** Replace only argument bytes, retaining the authored call spelling and surrounding trivia. */
export const compositionArgumentsText = withInstrumentation(
  function compositionArgumentsText(
    binding: DocumentBinding,
    region: SourceRegion,
    arguments_: readonly { region: SourceRegion; value: string }[]
  ): string {
    let text = binding.source.slice(region.from, region.to);
    let end = region.to;
    for (const argument of [...arguments_].sort((a, b) => b.region.from - a.region.from)) {
      if (argument.region.from < region.from || argument.region.to > end)
        throw new Error('Argument coordinates changed. Reopen this step.');
      text =
        text.slice(0, argument.region.from - region.from) +
        argument.value +
        text.slice(argument.region.to - region.from);
      end = argument.region.from;
    }
    return text;
  },
  { op: 'compositionArgumentsText', capture: 0 }
);

/** All composer mutations are exact edits against one captured source revision. */
export const compositionExpressionEdit = withInstrumentation(
  function compositionExpressionEdit(binding: DocumentBinding, region: SourceRegion, expression: string): DocumentEdit {
    if (!expression.trim() || parseExpression(expression).hasErrors)
      throw new Error('Enter a complete Rune expression.');
    const comments = getSourceComments(binding.source.slice(region.from, region.to)).map((comment) => comment.text);
    if (
      comments.length &&
      JSON.stringify(comments) !== JSON.stringify(getSourceComments(expression).map((comment) => comment.text))
    )
      throw new Error('Keep the expression’s comments, or edit this expression in Source.');
    const newline = binding.source.includes('\r\n') ? '\r\n' : '\n';
    return {
      binding,
      region,
      expectedText: binding.source.slice(region.from, region.to),
      replacement: expression.replace(/\r?\n/g, newline)
    };
  },
  { op: 'compositionExpressionEdit', capture: 0 }
);

export const compositionAliasEdit = withInstrumentation(
  function compositionAliasEdit(
    binding: DocumentBinding,
    composition: FunctionComposition,
    name: string,
    expression: string
  ): DocumentEdit {
    if (!composition.supported || composition.insertion === undefined)
      throw new Error('This body must be edited in Source.');
    const identifier = parseExpression(name);
    if (!/^[A-Za-z_]\w*$/.test(name) || identifier.hasErrors || identifier.value.$type !== 'RosettaSymbolReference')
      throw new Error('Enter a Rune identifier for the step.');
    if (composition.steps.some((step) => step.name === name))
      throw new Error('This name is already used in the function.');
    const from = composition.insertion;
    const line = binding.source.lastIndexOf('\n', from - 1) + 1;
    const before = binding.source.slice(line, from);
    const indent = /^\s*$/.test(before) ? before : '    ';
    const edit = compositionExpressionEdit(binding, { from, to: from }, expression);
    const newline = binding.source.includes('\r\n') ? '\r\n' : '\n';
    return {
      ...edit,
      replacement: `${before.trim() ? newline + indent : ''}alias ${name}: ${edit.replacement}${newline}${indent}`
    };
  },
  { op: 'compositionAliasEdit', capture: 0 }
);
