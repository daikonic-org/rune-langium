// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { FunctionComposition } from '@rune-langium/core';
import { FunctionComposer, type FunctionComposerProps } from '../../src/components/compose/FunctionComposer.js';
import { ExpressionDocument } from '../../src/services/expression-document.js';

const describe = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/workspace.js', async (original) => ({
  ...(await original<typeof import('../../src/services/workspace.js')>()),
  requestFunctionComposition: describe
}));
vi.mock('../../src/components/editing/ExpressionWorkspace.js', () => ({
  ExpressionWorkspace: () => <div>Source body</div>
}));

it.each([true, false])(
  'retains source-only diagnostics through a source handoff with Compose active=%s',
  async (active) => {
    const source = 'namespace example\nfunc Inspect:\n set result: 1\n set result: 2\n';
    const file = {
      path: 'model/inspect.rosetta',
      name: 'inspect.rosetta',
      content: source,
      dirty: false,
      readOnly: true
    };
    const facts: FunctionComposition = {
      optedIn: true,
      supported: false,
      steps: [],
      reasons: [
        {
          message: 'Multiple output assignments stay in Source.',
          region: { from: source.indexOf(' set result: 2'), to: source.length }
        }
      ]
    };
    describe.mockResolvedValue(facts);
    const props: FunctionComposerProps = {
      workspaceKey: 'handoff',
      active: true,
      inspector: null,
      onNavigate: vi.fn(),
      onSave: vi.fn(async () => {}),
      saveLabel: 'Saved',
      editor: {
        nodeId: 'example.Inspect#RosettaFunction',
        file,
        parseCurrent: true,
        documents: new ExpressionDocument({
          getGeneration: () => 1,
          getFile: () => undefined,
          onContentChange: vi.fn()
        }),
        dependencySnapshot: [file],
        onContentChange: vi.fn(),
        onOpenSource: vi.fn()
      }
    };
    const { rerender } = render(<FunctionComposer {...props} />);
    const diagnostic = 'Line 4: Multiple output assignments stay in Source.';
    await screen.findByText(diagnostic);
    rerender(
      <FunctionComposer
        {...props}
        active={active}
        editor={{ ...props.editor!, file: undefined, parseCurrent: false }}
      />
    );
    expect(screen.getByText(diagnostic)).toBeVisible();
    rerender(<FunctionComposer {...props} />);
    expect(screen.getByTestId('function-composer')).toBeVisible();
  }
);
