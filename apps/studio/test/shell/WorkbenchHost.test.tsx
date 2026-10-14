// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentType } from 'react';

class FakeApi {
  panels: Array<{ api: { component: string } }> = [];
  private layoutChangeListener: (() => void) | null = null;
  clear = vi.fn(() => {
    this.panels = [];
  });
  fromJSON = vi.fn((json: { component?: string }) => {
    if (json.component) this.panels = [{ api: { component: json.component } }];
  });
  toJSON = vi.fn(() => ({ component: 'editor' }));
  emitLayoutChange = () => this.layoutChangeListener?.();
  onDidLayoutChange = vi.fn((listener: () => void) => {
    this.layoutChangeListener = listener;
    return {
      dispose: () => {
        if (this.layoutChangeListener === listener) this.layoutChangeListener = null;
        disposeListener();
      }
    };
  });
}

const disposeListener = vi.fn();
let api: FakeApi;

vi.mock('dockview-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dockview-react')>()),
  DockviewReact(props: { components: Record<string, ComponentType>; onReady(event: { api: FakeApi }): void }) {
    api = new FakeApi();
    props.onReady({ api });
    return (
      <div data-testid="dockview-react-mock">
        {Object.entries(props.components).map(([name, Panel]) => (
          <Panel key={name} />
        ))}
      </div>
    );
  }
}));

import { resetWorkbench, WorkbenchHost } from '../../src/shell/WorkbenchHost.js';
import type { WorkbenchDefinition } from '../../src/shell/workbench-types.js';

function EditorPanel() {
  return <div data-testid="editor-panel">editor</div>;
}

function StatefulPanel({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {label}: {count}
    </button>
  );
}

function definition(buildDefault = vi.fn()): WorkbenchDefinition {
  return {
    id: 'prototype',
    panels: { editor: EditorPanel },
    titles: { editor: 'Editor' },
    buildDefault
  };
}

afterEach(() => {
  disposeListener.mockClear();
});

describe('WorkbenchHost', () => {
  it('mounts stable domain panels through the definition context', () => {
    render(
      <WorkbenchHost
        definition={definition()}
        initialNativeLayout={{ component: 'editor' }}
        onNativeLayoutChange={vi.fn()}
      />
    );
    expect(screen.getByTestId('editor-panel')).toHaveTextContent('editor');
  });

  it('preserves panel state when a renderer callback changes', () => {
    const firstDefinition: WorkbenchDefinition = {
      ...definition(),
      panels: { editor: () => <StatefulPanel label="first" /> }
    };
    const { rerender } = render(<WorkbenchHost definition={firstDefinition} onNativeLayoutChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'first: 0' }));
    expect(screen.getByRole('button', { name: 'first: 1' })).toBeInTheDocument();

    const secondDefinition: WorkbenchDefinition = {
      ...definition(),
      panels: { editor: () => <StatefulPanel label="second" /> }
    };
    rerender(<WorkbenchHost definition={secondDefinition} onNativeLayoutChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'second: 1' })).toBeInTheDocument();
  });

  it('rejects unknown and empty restored layouts, then rebuilds only this host', () => {
    const buildDefault = vi.fn();
    render(
      <WorkbenchHost
        definition={definition(buildDefault)}
        initialNativeLayout={{ component: 'unknown' }}
        onNativeLayoutChange={vi.fn()}
      />
    );
    expect(api.clear).toHaveBeenCalledOnce();
    expect(buildDefault).toHaveBeenCalledOnce();
  });

  it('rebuilds when a native layout restores no panels', () => {
    const buildDefault = vi.fn();
    render(
      <WorkbenchHost definition={definition(buildDefault)} initialNativeLayout={{}} onNativeLayoutChange={vi.fn()} />
    );
    expect(api.clear).toHaveBeenCalledOnce();
    expect(buildDefault).toHaveBeenCalledOnce();
  });

  it('disposes the layout listener on unmount', () => {
    const { unmount } = render(<WorkbenchHost definition={definition()} onNativeLayoutChange={vi.fn()} />);
    unmount();
    expect(disposeListener).toHaveBeenCalled();
  });

  it('routes a native serialization failure to the host error callback', () => {
    const onNativeLayoutError = vi.fn();
    render(
      <WorkbenchHost
        definition={definition()}
        initialNativeLayout={{ component: 'editor' }}
        onNativeLayoutChange={vi.fn()}
        onNativeLayoutError={onNativeLayoutError}
      />
    );
    api.toJSON.mockImplementationOnce(() => {
      throw new Error('serialization failed');
    });

    api.emitLayoutChange();

    expect(onNativeLayoutError).toHaveBeenCalledWith(expect.objectContaining({ message: 'serialization failed' }));
  });

  it('resets one concrete host without touching another host API or definition', () => {
    const firstApi = new FakeApi();
    const secondApi = new FakeApi();
    secondApi.panels = [{ api: { component: 'editor' } }];
    const firstDefault = vi.fn();
    const secondDefault = vi.fn();

    resetWorkbench(firstApi as never, definition(firstDefault), 960);

    expect(firstApi.clear).toHaveBeenCalledOnce();
    expect(firstDefault).toHaveBeenCalledWith(firstApi, 960);
    expect(secondApi.panels).toEqual([{ api: { component: 'editor' } }]);
    expect(secondApi.clear).not.toHaveBeenCalled();
    expect(secondDefault).not.toHaveBeenCalled();
  });
});
