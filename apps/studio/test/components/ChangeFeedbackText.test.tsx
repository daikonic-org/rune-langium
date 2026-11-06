// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeFeedbackText } from '../../src/components/ChangeFeedbackText.js';

describe('payload change feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps exact JSON text while showing localized edits and visual-only removals', () => {
    const { container, rerender } = render(
      <pre>
        <ChangeFeedbackText text={'{"amount":100}'} scope="Quote" />
      </pre>
    );
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
    rerender(
      <pre>
        <ChangeFeedbackText text={'{"amount":200}'} scope="Quote" />
      </pre>
    );
    expect(container.textContent).toBe('{"amount":200}');
    expect(container.querySelector('[data-change-feedback="change"]')?.textContent).toBe('2');
    rerender(
      <pre>
        <ChangeFeedbackText text={'{}'} scope="Quote" />
      </pre>
    );
    expect(container.textContent).toBe('{}');
    expect(container.querySelector('[data-removed-text]')?.getAttribute('data-removed-text')).toBe('"amount":200');
    act(() => vi.advanceTimersByTime(340));
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
  });
  it('is quiet across scope changes and while the payload viewer has focus', () => {
    const { container, rerender } = render(
      <pre tabIndex={0}>
        <ChangeFeedbackText text="one" scope="one" />
      </pre>
    );
    rerender(
      <pre tabIndex={0}>
        <ChangeFeedbackText text="two" scope="two" />
      </pre>
    );
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
    container.querySelector('pre')!.focus();
    rerender(
      <pre tabIndex={0}>
        <ChangeFeedbackText text="updated" scope="two" />
      </pre>
    );
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
  });

  it('ignores background hydration, waits for readiness, and cues accepted value revisions', () => {
    const sources = new Map([['quote.rosetta', 'original']]);
    const { container, rerender } = render(<ChangeFeedbackText text="initial" scope="Quote" revision={{ sources }} />);
    rerender(<ChangeFeedbackText text="hydrated" scope="Quote" revision={{ sources }} />);
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
    const values = {};
    rerender(<ChangeFeedbackText text="accepted" scope="Quote" revision={{ sources, values }} ready={false} />);
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
    rerender(<ChangeFeedbackText text="accepted" scope="Quote" revision={{ sources, values }} />);
    expect(container.querySelector('[data-change-feedback="change"]')).not.toBeNull();
    // Unrelated renders must not cancel the cleanup of an active cue.
    rerender(<ChangeFeedbackText text="accepted" scope="Quote" revision={{ sources, values }} />);
    act(() => vi.advanceTimersByTime(900));
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
  });

  it('consumes accepted revisions even when JSON is unchanged before later hydration', () => {
    const initial = { sources: new Map([['quote.rosetta', 'initial']]) };
    const accepted = { sources: new Map([['quote.rosetta', 'documentation edit']]) };
    const { container, rerender } = render(<ChangeFeedbackText text="same JSON" scope="Quote" revision={initial} />);
    rerender(<ChangeFeedbackText text="same JSON" scope="Quote" revision={accepted} />);
    rerender(<ChangeFeedbackText text="hydrated JSON" scope="Quote" revision={accepted} />);
    expect(container.querySelector('[data-change-feedback]')).toBeNull();
  });
});
