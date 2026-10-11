// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Smoke test for RuneTypeGraph component rendering.
 *
 * Models are loaded into the zustand editor store (source of truth).
 * The graph component subscribes to the store — no `models` prop.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import type { RuneTypeGraphRef } from '../../src/types.js';
import { render } from '@testing-library/react';
import { act } from '@testing-library/react';
import { parse } from '@rune-langium/core';
import { RuneTypeGraph } from '../../src/components/RuneTypeGraph.js';
import { shouldReplaceLayoutPositions } from '../../src/components/layout-sync.js';
import { useEditorStore } from '../../src/store/editor-store.js';
import { SIMPLE_INHERITANCE_SOURCE, COMBINED_MODEL_SOURCE } from '../helpers/fixture-loader.js';

function loadModels(models: unknown) {
  act(() => {
    useEditorStore.getState().loadModels(models);
  });
}

describe('RuneTypeGraph', () => {
  it('replaces local positions when Dagre output changes', () => {
    const previous = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 100, y: 100 } }
    ];
    const same = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 100, y: 100 } }
    ];
    const moved = [
      { id: 'a', position: { x: 20, y: 0 } },
      { id: 'b', position: { x: 100, y: 100 } }
    ];

    expect(shouldReplaceLayoutPositions(previous, same)).toBe(false);
    expect(shouldReplaceLayoutPositions(previous, moved)).toBe(true);
  });

  it('renders without crashing with a simple model', async () => {
    const result = await parse(SIMPLE_INHERITANCE_SOURCE);
    loadModels(result.value);
    const { container } = render(<RuneTypeGraph />);

    expect(container.querySelector('.rune-type-graph')).toBeTruthy();
  });

  it('renders without crashing with a combined model', async () => {
    const result = await parse(COMBINED_MODEL_SOURCE);
    loadModels(result.value);
    const { container } = render(<RuneTypeGraph />);

    expect(container.querySelector('.rune-type-graph')).toBeTruthy();
  });

  it('renders with custom config', async () => {
    const result = await parse(SIMPLE_INHERITANCE_SOURCE);
    loadModels(result.value);
    const { container } = render(
      <RuneTypeGraph
        config={{
          layout: { direction: 'LR' },
          showMinimap: true,
          showControls: true,
          readOnly: true
        }}
      />
    );

    expect(container.querySelector('.rune-type-graph')).toBeTruthy();
  });

  it('accepts multiple models loaded into store', async () => {
    const result1 = await parse(SIMPLE_INHERITANCE_SOURCE);
    const result2 = await parse(COMBINED_MODEL_SOURCE);
    loadModels([result1.value, result2.value]);
    const { container } = render(<RuneTypeGraph />);

    expect(container.querySelector('.rune-type-graph')).toBeTruthy();
  });
});

it('emphasizes only imperative graph arrivals, restarts them, and preserves keyboard focus', async () => {
  const result = await parse(SIMPLE_INHERITANCE_SOURCE);
  loadModels(result.value);
  vi.useFakeTimers();
  try {
    const ref = createRef<RuneTypeGraphRef>();
    const { container, unmount } = render(
      <>
        <button>Keep focus</button>
        <RuneTypeGraph ref={ref} />
      </>
    );
    const button = container.querySelector('button')!;
    button.focus();
    const nodeId = ref.current!.getNodes()[0]!.id;
    act(() => ref.current!.focusNode(nodeId));
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toHaveAttribute('data-id', nodeId);
    expect(document.activeElement).toBe(button);
    act(() => vi.advanceTimersByTime(800));
    act(() => ref.current!.focusNode(nodeId));
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
    act(() => ref.current!.fitView());
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

it('waits for a programmatic target to load and cancels superseded arrivals', async () => {
  const result = await parse(SIMPLE_INHERITANCE_SOURCE);
  loadModels(result.value);
  const targetId = useEditorStore.getState().nodes[0]!.id;
  loadModels([]);
  vi.useFakeTimers();
  try {
    const { container, rerender, unmount } = render(
      <RuneTypeGraph navigationTarget={{ nodeId: targetId, revision: 1 }} />
    );
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
    loadModels(result.value);
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toHaveAttribute('data-id', targetId);
    act(() => vi.advanceTimersByTime(1100));
    rerender(<RuneTypeGraph navigationTarget={{ nodeId: targetId, revision: 2 }} />);
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toHaveAttribute('data-id', targetId);
    rerender(<RuneTypeGraph navigationTarget={{ nodeId: 'missing.Target', revision: 3 }} />);
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
