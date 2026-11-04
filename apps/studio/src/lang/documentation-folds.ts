// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { codeFolding, foldEffect, unfoldEffect } from '@codemirror/language';
import type { SourceRegion } from '@rune-langium/core';
import { runeDocumentationRanges } from './rune-dsl.js';

export const setRuneDocumentationHidden = StateEffect.define<boolean>();
const setOwnedFolds = StateEffect.define<SourceRegion[]>();
const documentationState = StateField.define<{ hidden: boolean; ranges: SourceRegion[] }>({
  create: () => ({ hidden: false, ranges: [] }),
  update(value, transaction) {
    let { hidden, ranges } = value;
    for (const effect of transaction.effects) {
      if (effect.is(setRuneDocumentationHidden)) hidden = effect.value;
      if (effect.is(setOwnedFolds)) ranges = effect.value;
    }
    return hidden === value.hidden && ranges === value.ranges ? value : { hidden, ranges };
  }
});

/** Reconcile only this toggle's folds in the same transaction as an edit; visible source incurs no scan. */
export const runeDocumentationFolding: Extension = [
  codeFolding(),
  documentationState,
  EditorState.transactionExtender.of((transaction) => {
    const previous = transaction.startState.field(documentationState);
    let hidden = previous.hidden;
    for (const effect of transaction.effects) if (effect.is(setRuneDocumentationHidden)) hidden = effect.value;
    if (hidden === previous.hidden && !(hidden && transaction.docChanged)) return null;
    const ranges = hidden ? runeDocumentationRanges(transaction.newDoc.toString()) : [];
    const effects = previous.ranges.flatMap((range) => {
      const mapped = foldEffect.of(range).map(transaction.changes);
      return mapped ? [unfoldEffect.of(mapped.value)] : [];
    });
    return { effects: [...effects, ...ranges.map((range) => foldEffect.of(range)), setOwnedFolds.of(ranges)] };
  })
];
