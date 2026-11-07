// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { changeFeedbackDecorations, showChangeFeedback } from '../../src/lang/change-feedback.js';

describe('CodeMirror target-only change feedback', () => {
  const initial = () => EditorState.create({ doc: 'amount number', extensions: changeFeedbackDecorations });
  it('does not cue typing; an accepted external replacement marks only its range', () => {
    const typing = initial().update({ changes: { from: 0, to: 6, insert: 'price' } }).state;
    expect(typing.field(changeFeedbackDecorations).size).toBe(0);
    const external = initial().update({
      changes: { from: 0, to: 6, insert: 'price' },
      annotations: showChangeFeedback.of(true)
    }).state;
    const cursor = external.field(changeFeedbackDecorations).iter();
    expect([cursor.from, cursor.to]).toEqual([0, 5]);
    expect(cursor.value?.spec.attributes['data-change-feedback']).toBe('change');
    expect(external.update({ changes: { from: 5, insert: 's' } }).state.field(changeFeedbackDecorations).size).toBe(0);
  });
  it('marks insertion green and represents deletion as an inert visual widget outside the document', () => {
    const added = initial().update({
      changes: { from: 13, insert: '\n  currency string' },
      annotations: showChangeFeedback.of(true)
    }).state;
    expect(added.field(changeFeedbackDecorations).iter().value?.spec.attributes['data-change-feedback']).toBe('add');
    const removed = initial().update({ changes: { from: 0, to: 7 }, annotations: showChangeFeedback.of(true) }).state;
    expect(removed.doc.toString()).toBe('number');
    const widget = removed.field(changeFeedbackDecorations).iter().value?.spec.widget;
    const ghost = widget.toDOM();
    expect(ghost.textContent).toBe('amount ');
    expect(ghost.inert).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
  });
});
