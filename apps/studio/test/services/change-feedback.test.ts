// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChangeFeedbackBoundary,
  compareFeedbackItems,
  feedbackFingerprint,
  type FeedbackItem
} from '../../src/services/change-feedback.js';

const item = (key: string, value = key): FeedbackItem => ({
  key,
  group: 'attributes',
  value,
  selector: `[data-key="${key}"]`
});
const row = (key: string) => `<div data-key="${key}"><input id="${key}" value="${key}"></div>`;

describe('effect-based presentation feedback', () => {
  let root: HTMLDivElement;
  let boundary: ChangeFeedbackBoundary;
  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.append(root);
    boundary = new ChangeFeedbackBoundary();
  });
  afterEach(() => {
    boundary.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it('ignores parser positions while retaining reference and authored metadata changes', () => {
    expect(feedbackFingerprint({ name: 'a', $cstRange: [1, 2], type: { $refText: 'string' } })).toBe(
      feedbackFingerprint({ name: 'a', $cstRange: [8, 20], type: { $refText: 'string' } })
    );
    expect(feedbackFingerprint({ type: { $refText: 'number' } })).not.toBe(
      feedbackFingerprint({ type: { $refText: 'string' } })
    );
  });

  it('fingerprints hydrated integer literals using the canonical Rune serialization policy', () => {
    const before = { value: { kind: 'int', value: 1n }, $cstRange: [1n, 2n] };
    const moved = { value: { kind: 'int', value: 1 }, $cstRange: [8, 20] };
    expect(feedbackFingerprint(before)).toBe(feedbackFingerprint(moved));
    expect(feedbackFingerprint({ value: { kind: 'int', value: 2n } })).not.toBe(feedbackFingerprint(before));
  });

  it('keeps existing siblings quiet when inserting or removing a field', () => {
    expect(compareFeedbackItems([item('a'), item('b')], [item('x'), item('a'), item('b')])).toEqual([
      { kind: 'add', after: item('x') }
    ]);
    expect(compareFeedbackItems([item('a'), item('b')], [item('b')])).toEqual([{ kind: 'remove', before: item('a') }]);
    expect(compareFeedbackItems([item('a')], [item('renamed')])[0]?.kind).toBe('change');
  });

  it('is quiet on mount and navigation, and highlights an externally changed value', () => {
    root.innerHTML = row('a');
    boundary.update(root, 'one', [item('a')]);
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    boundary.update(root, 'one', [item('a', 'updated')]);
    expect(root.querySelector('[data-change-feedback="change"]')).not.toBeNull();
    boundary.update(root, 'two', [item('a', 'other declaration')]);
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
  });

  it('suppresses originating edits even when commit happens after blur', () => {
    root.innerHTML = row('a');
    boundary.update(root, 'one', [item('a')]);
    const input = root.querySelector('input')!;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
    boundary.update(root, 'one', [item('a', 'committed')]);
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    boundary.update(root, 'one', [item('a', 'external')]);
    expect(root.querySelector('[data-change-feedback="change"]')).not.toBeNull();
    input.focus();
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('animates additions and keeps removed controls inert, hidden and temporary', () => {
    root.innerHTML = row('a');
    boundary.update(root, 'one', [item('a')]);
    root.insertAdjacentHTML('beforeend', row('b'));
    boundary.update(root, 'one', [item('a'), item('b')]);
    expect(root.querySelector('[data-key="b"]')?.getAttribute('data-change-feedback')).toBe('add');
    root.querySelector('[data-key="a"]')!.remove();
    boundary.update(root, 'one', [item('b')]);
    const ghost = root.querySelector<HTMLElement>('[data-change-feedback-ghost]')!;
    expect(ghost.inert).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelector('[id]')).toBeNull();
    vi.advanceTimersByTime(340);
    expect(root.querySelector('[data-change-feedback-ghost]')).toBeNull();
    expect(root.querySelector('[data-key="b"] input')).not.toBeNull();
  });

  it('keeps button-triggered additions and removals quiet in their originating surface', () => {
    root.innerHTML = row('a') + '<button>Add or remove</button>';
    boundary.update(root, 'one', [item('a')]);
    root.querySelector('button')!.click();
    root.insertAdjacentHTML('beforeend', row('b'));
    boundary.update(root, 'one', [item('a'), item('b')]);
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    root.querySelector('button')!.click();
    root.querySelector('[data-key="b"]')!.remove();
    boundary.update(root, 'one', [item('a')]);
    expect(root.querySelector('[data-change-feedback-ghost]')).toBeNull();
  });

  it.each(['input', 'button'] as const)(
    'replaces a local gesture with a later external %s edit even when local items did not change',
    (gesture) => {
      root.innerHTML = row('a');
      boundary.update(root, 'one', [item('a')]);
      const input = root.querySelector('input')!;
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      const external = document.createElement(gesture);
      document.body.append(external);
      if (gesture === 'button') external.click();
      else external.dispatchEvent(new Event('input', { bubbles: true }));
      boundary.update(root, 'one', [item('a', 'source change')]);
      expect(root.querySelector('[data-change-feedback="change"]')).not.toBeNull();
      external.remove();
    }
  );

  it('restarts rapid updates, then disposes every pending effect', () => {
    root.innerHTML = row('a');
    boundary.update(root, 'one', [item('a')]);
    boundary.update(root, 'one', [item('a', 'first')]);
    vi.advanceTimersByTime(400);
    boundary.update(root, 'one', [item('a', 'second')]);
    vi.advanceTimersByTime(500);
    expect(root.querySelector('[data-change-feedback]')).not.toBeNull();
    boundary.dispose();
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for accepted values and does not cue background hydration on the same revision', () => {
    root.innerHTML = row('a');
    const initialItems = [item('a')];
    const original = { sources: new Map([['a.rosetta', 'original']]) };
    boundary.update(root, 'one', initialItems, true, original);
    boundary.update(root, 'one', [item('a', 'hydrated description')], true, { sources: new Map(original.sources) });
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    const hydrated = [item('a', 'hydrated description')];
    boundary.update(root, 'one', hydrated, true, original);
    const changed = { sources: new Map([['a.rosetta', 'edited']]) };
    boundary.update(root, 'one', hydrated, true, changed);
    boundary.update(root, 'one', [item('a', 'accepted edit')], true, changed);
    expect(root.querySelector('[data-change-feedback="change"]')).not.toBeNull();
  });

  it('cues every rendered instance while expansion alone stays quiet', () => {
    root.innerHTML = row('a') + row('a');
    boundary.update(root, 'one', [item('a')]);
    boundary.update(root, 'one', [item('a', 'accepted')]);
    expect(root.querySelectorAll('[data-change-feedback="change"]')).toHaveLength(2);
    vi.advanceTimersByTime(900);
    root.insertAdjacentHTML('beforeend', row('a'));
    boundary.update(root, 'one', [item('a', 'accepted')]);
    expect(root.querySelector('[data-change-feedback]')).toBeNull();
    root.replaceChildren();
    boundary.update(root, 'one', []);
    expect(root.querySelectorAll('[data-change-feedback-ghost]')).toHaveLength(3);
  });

  it('does not duplicate nested removal snapshots', () => {
    root.innerHTML = `<div data-key="parent">${row('a')}</div>`;
    boundary.update(root, 'one', [item('parent'), item('a')]);
    root.replaceChildren();
    boundary.update(root, 'one', []);
    expect(root.querySelectorAll('[data-change-feedback-ghost]')).toHaveLength(1);
  });
});
